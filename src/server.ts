import stream from 'stream'
import http from 'http'
import https from 'https'
import {
  HeaderMap,
  HoneybeeRequest,
  HoneybeeResponse,
  NetError,
  QueryParams,
  ResponseError,
  TimeoutError,
  expBackoff,
  mergeDefaults,
  serializeForm,
  serializeJSON,
  setQueryParams,
} from './common'

const PKG = require('../package.json')
const USER_AGENT_HEADER = `${PKG.name}/${PKG.version} (nodejs)`

/* Should use GET instead of the original method (POST/PUT/etc) */
const WEIRD_REDIRECT_CODES = [301, 302, 303]
const REDIRECT_CODES = [...WEIRD_REDIRECT_CODES, 307, 308]

export interface Options<RequestBody=any, ResponseBody=any> {
  url: string
  method?: string
  /**
   * Simple arrays are encoded like this: "colors=red&colors=blue". For more
   * advanced encoding, like nested objects, pass the query string as part of `url`
   */
  query?: QueryParams|URLSearchParams
  headers?: Record<string, string>
  body?: RequestBody
  /** Send & receive cookies & Authorization header with cross-site requests */
  credentials?: boolean
  /**
   * Transform the request body.
   *
   * If a function, then it should return something that http.request can use
   * for transport and call `req.headers.set('Content-Type', '...')` as
   * appropriate.
   *
   * "form" => "application/x-www-form-urlencoded"
   * Uses URLSearchParams. Simple arrays are encoded like this:
   * "colors=red&colors=blue". For nested object serialization, define a custom
   * function.
   *
   * "json" => "application/json"
   * If undefined, will attempt to choose the the most appropriate type,
   * preferring 'json' for plain objects.
   */
  requestType?: 'json' | 'form' | ((req: HoneybeeRequest, body: RequestBody) => Buffer|string|undefined|null)
  /**
   * (default: json)
   * If a function, then it should return a transformed response body.
   * If 'json', then the Accept request header will be set to
   * 'application/json' and the response body will be an object, or null.
   * Otherwise the response body will be a Buffer.
   */
  responseType?: 'json' | 'buffer' | ((res: HoneybeeResponse, body: Buffer) => ResponseBody|Promise<ResponseBody>)

  /**
   * (default: 2) Number of connection attempts before giving up. Will respect the
   * Retry-After response header, if found, otherwise a randomized exponentially
   * increasing delay is used.
   */
  maxAttempts?: number
  /** (default: 1000) Initial retry delay in milliseconds */
  retryDelayStep?: number
  /** (default: 4000) Maximum retry delay between attempts */
  retryDelayMax?: number
  /** (default: 100) */
  retryDelayJitter?: number
  /** (default: 30000) Maximum value of the Retry-After response header, in milliseconds */
  retryAfterMax?: number
  /** Milliseconds a request can take before automatically being terminated */
  timeout?: number

  /** (default=5) server-only */
  maxRedirects?: number
  /**
   * server-only. Configure your own connection agent, e.g. for keepAlive connections
   * @link https://nodejs.org/api/http.html#http_class_http_agent
   */
  agent?: http.Agent | https.Agent
}

export class RedirectError extends Error {
  headers: HeaderMap

  constructor(message: string, res: HoneybeeResponse) {
    super(message)
    this.headers = res.headers
  }
}

const OPT_DEFAULTS = {
  retryAfterMax: 30e3,
  retryDelayJitter: 100,
  retryDelayMax: 1000,
  retryDelayStep: 200,
  maxAttempts: 2,
  timeout: 0,

  maxRedirects: 5,
}
type MergedOptions = typeof OPT_DEFAULTS & Omit<Options, 'headers'> & {headers: HeaderMap}

export default function request<T=any, R=any>(options: string|Options<T, R>): Promise<HoneybeeResponse<R>> {
  const opt: MergedOptions = mergeDefaults(OPT_DEFAULTS, typeof options == 'string' ? {url: options} : options) as any
  opt.headers = new HeaderMap(opt.headers && Object.entries(opt.headers))
  const req: HoneybeeRequest = {headers: opt.headers}

  // serialize the request body
  if (opt.body != null) {
    if (typeof opt.requestType == 'function') {
      const value = opt.body = opt.requestType(req, opt.body)
      opt.headers.set('Content-Length', value ? String(Buffer.byteLength(value)) : '0')
    } else if (opt.requestType == null) {
      if (Object.getPrototypeOf(opt.body) === Object.prototype) {
        const value = opt.body = serializeJSON(req, opt.body)
        opt.headers.set('Content-Length', String(Buffer.byteLength(value)))
      } else if (Buffer.isBuffer(opt.body)) {
        opt.headers.set('Content-Length', String(opt.body.byteLength))
      }
    } else if (opt.requestType === 'json') {
      const value = opt.body = serializeJSON(req, opt.body)
      opt.headers.set('Content-Length', String(Buffer.byteLength(value)))
    } else if (opt.requestType === 'form') {
      const value = opt.body = serializeForm(req, opt.body).toString()
      opt.headers.set('Content-Length', String(Buffer.byteLength(value)))
    } else if (typeof opt.body == 'string') {
      opt.headers.attempt('Content-Type', 'text/plain')
      opt.headers.set('Content-Length', String(Buffer.byteLength(opt.body)))
    } else if (Buffer.isBuffer(opt.body)) {
      opt.headers.attempt('Content-Type', 'application/octet-stream')
      opt.headers.set('Content-Length', String(Buffer.byteLength(opt.body)))
    } else {
      throw new TypeError('invalid request body')
    }
  }

  if (opt.responseType === 'json' || opt.responseType == null) {
    opt.headers.attempt('Accept', 'application/json')
  }
  opt.headers.attempt('User-Agent', USER_AGENT_HEADER)

  const url = new URL(opt.url)
  if (opt.query) {
    setQueryParams(url.searchParams, opt.query)
  }

  return perform(url, opt, 1, 0)
}

function perform(url: URL, opt: MergedOptions, attempts: number, redirectAttempts: number): Promise<HoneybeeResponse> {
  return new Promise((resolve, reject) => {
    const request = agnosticRequest(url, opt)
    request.on('error', (err: any) => {
      if (request.reusedSocket && err.code === 'ECONNRESET') {
        // Keep-Alive socket was probably killed by server
        resolve(perform(url, opt, attempts + 1, redirectAttempts))
      } else {
        reject(new NetError(err.message, err.code))
      }
    })
    if (opt.timeout > 0) request.setTimeout(opt.timeout, () => {
      request.abort()
      reject(new TimeoutError())
    })
    request.on('response', (response) => {
      const [headers, cookies] = parseHeaders(response.headers)
      const res: HoneybeeResponse<unknown> = {
        status: response.statusCode || 0,
        headers,
        cookies,
        body: null
      }
      const resolveOrReject = (body: unknown) => {
        res.body = body
        if (res.status >= 200 && res.status < 300) {
          resolve(res)
        } else {
          reject(new ResponseError(http.STATUS_CODES[res.status] || 'Unknown', res))
        }
      }
      response.on('error', (err: any) => reject(new NetError(err.message, err.code)))
      response.resume() // Make sure we drain any data even if unused
      if (res.status === 204)
        return resolve(res)
      if (WEIRD_REDIRECT_CODES.includes(res.status)) {
        // Regardless of the original HTTP verb, these redirects should use GET
        // (by design or de facto implementation)
        opt.method = 'GET'
        opt.body = null
        opt.headers.delete('Content-Type')
        opt.headers.delete('Content-Length')
        opt.headers.delete('Content-Encoding')
      }
      if (REDIRECT_CODES.includes(res.status)) {
        if (redirectAttempts >= opt.maxRedirects)
          return reject(new RedirectError('too many redirects', res))
        const target = new URL(res.headers.get('Location')!, url)
        return resolve(perform(target, opt, attempts, redirectAttempts + 1))
      }
      let chunks: Array<Buffer> = []
      response.on('data', (chunk) => { chunks.push(chunk) })
      response.on('end', ()=> {
        if (!response.complete) {
          return reject(new NetError('Connection ended prematurely'))
        }
        const buf = Buffer.concat(chunks)
        if (res.status === 429 && attempts < opt.maxAttempts) {
          // Respect the Retry-After response header, but don't let it get too crazy
          const retryAfter = parseInt(res.headers.get('Retry-After')!)
          const delay = retryAfter > 0 ? Math.min(retryAfter * 1000, opt.retryAfterMax)
            // Or just use a random-ish delay
            : expBackoff(opt.retryDelayStep, opt.retryDelayMax, opt.retryDelayJitter, attempts, 2)
          setTimeout(() => resolve(perform(url, opt, attempts + 1, redirectAttempts)), delay)
        } else if (typeof opt.responseType == 'function') {
          Promise.resolve(opt.responseType(res, buf)).then(resolveOrReject, reject)
        } else if (opt.responseType === 'json' || opt.responseType == null) {
          let obj = null
          try { obj = JSON.parse(buf.toString()) } catch (err) { /* ignored */ }
          resolveOrReject(obj)
        } else {
          resolveOrReject(buf)
        }
      })
    })

    // FIXME if `X.pipe(Y)` and `X` emits an error then `Y` is not closed
    // automatically. It is necessary to manually close each stream in order to
    // prevent memory leaks.
    //if (opt.body instanceof stream.Readable)
    //  opt.body.pipe(request) // TODO test this
    //else
    request.end(opt.body)
  })
}

/**
 * http/https each have distinct methods and require distinct agents
 * This helper abstracts these concerns by using "opt.protocol"
 */
function agnosticRequest(url: URL, opt: MergedOptions) {
  const secure = url.protocol === 'https:'
  return (secure ? https : http).request(url, {
    method: opt.method,
    headers: Object.fromEntries(opt.headers),
    agent: opt.agent,
  })
}

type Cookies = string[] | undefined

function parseHeaders(raw: http.IncomingHttpHeaders): [HeaderMap, Cookies] {
  const headers = new HeaderMap()
  let cookies: Cookies
  for (const [key, val] of Object.entries(raw)) {
    if (val != null) {
      if (Array.isArray(val)) {
        cookies = val
      } else {
        headers.set(key, val)
      }
    }
  }
  return [headers, cookies]
}

type ProgressCallback = (pct: number) => void

/**
 * A passthrough Stream, with a callback for monitoring bytes transferred
 */
class ProgressMonitor extends stream.Transform {
  private bytesExpected: number
  private bytesWritten: number
  private onProgress: ProgressCallback
  private prev: number
  constructor(bytesExpected: number, onProgress: ProgressCallback) {
    // If highWaterMark is left to default, then this will buffer data instead
    // of mirroring the downstream backpressure, leading to inaccurate updates.
    super({highWaterMark: 1})
    this.bytesExpected = bytesExpected
    this.bytesWritten = 0
    this.onProgress = onProgress
    this.prev = 0
  }
  _transform(chunk: Buffer, _enc: unknown, cb: stream.TransformCallback) {
    this.bytesWritten += chunk.byteLength
    const pct = Math.floor(this.bytesWritten / this.bytesExpected * 100)
    if (pct !== this.prev)
      this.onProgress(pct)
    this.prev = pct
    cb(null, chunk)
  }
}
