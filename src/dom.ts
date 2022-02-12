import {
  HeaderMap,
  HoneybeeRequest,
  HoneybeeResponse,
  NetError,
  ProgressCallback,
  QueryParams,
  ResponseError,
  TimeoutError,
  expBackoff,
  mergeDefaults,
  serializeForm,
  serializeJSON,
  setQueryParams,
} from './common'

export type {
  HoneybeeRequest,
  HoneybeeResponse,
  Options,
  ProgressCallback,
  QueryParams,
}
export {
  HeaderMap,
  NetError,
  ResponseError,
  TimeoutError,
  request as default
}

interface Options<RequestBody=any, ResponseBody=any> {
  url: string,
  method?: string,
  /**
   * Simple arrays are encoded like this: "colors=red&colors=blue". For more
   * advanced encoding, like nested objects, pass the query string as part of `url`
   */
  query?: QueryParams|URLSearchParams,
  headers?: Record<string, string>,
  body?: RequestBody,
  /** Send & receive cookies & Authorization header with cross-site requests */
  credentials?: boolean,
  /**
   * Transform the request body.
   *
   * If a function, then it should return something that XMLHttpRequest can use
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
  requestType?: 'json' | 'form' | ((req: HoneybeeRequest, body: RequestBody) => XMLHttpRequestBodyInit|undefined|null),
  /**
   * (default: json)
   * If a function, then it should return a transformed response body.
   * If 'json', then the Accept request header will be set to 'application/json' and the response body will be an object, or null.
   * Otherwise the response body will be a Blob.
   */
  responseType?: XMLHttpRequestResponseType | ((res: HoneybeeResponse, body: Blob) => ResponseBody|Promise<ResponseBody>),

  /**
   * (default: 2) Number of connection attempts before giving up. Will respect the
   * Retry-After response header, if found, otherwise a randomized exponentially
   * increasing delay is used.
   */
  maxAttempts?: number,
  /** (default: 1000) Initial retry delay in milliseconds */
  retryDelayStep?: number,
  /** (default: 4000) Maximum retry delay between attempts */
  retryDelayMax?: number,
  /** (default: 100) */
  retryDelayJitter?: number,
  /** (default: 30000) Maximum value of the Retry-After response header, in milliseconds */
  retryAfterMax?: number,
  /** Milliseconds a request can take before automatically being terminated */
  timeout?: number,

  /**
   * browser-only. When uploading large files, this will be called periodically with pct as a
   * whole number between [0, 100]
   */
  onUploadProgress?: ProgressCallback,
  /**
   * When downloading large files, this will be called periodically with pct as a
   * whole number between [0, 100]
   */
  onDownloadProgress?: ProgressCallback,
}

const OPT_DEFAULTS = {
  retryAfterMax: 30e3,
  retryDelayJitter: 100,
  retryDelayMax: 1000,
  retryDelayStep: 200,
  maxAttempts: 2,
  //responseType: 'json',
  timeout: 0,
}
type MergedOptions = typeof OPT_DEFAULTS & Omit<Options, 'headers'> & {headers: HeaderMap}

function request<T=any, R=any>(options: string|Options<T, R>): Promise<HoneybeeResponse<R>> {
  const opt: MergedOptions = mergeDefaults(OPT_DEFAULTS, typeof options == 'string' ? {url: options} : options) as any
  opt.headers = new HeaderMap(opt.headers && Object.entries(opt.headers))
  const req: HoneybeeRequest = {headers: opt.headers}

  // serialize the request body
  if (opt.body != null) {
    if (typeof opt.requestType == 'function') {
      opt.body = opt.requestType(req, opt.body)
    } else if (opt.requestType == null) {
      // Alternatively check if instanceof Blob | ArrayBufferView | ArrayBuffer | FormData | URLSearchParams | string
      if (Object.getPrototypeOf(opt.body) === Object.prototype) {
        opt.body = serializeJSON(req, opt.body)
      }
    } else switch (opt.requestType) {
      case 'json': opt.body = serializeJSON(req, opt.body); break
      case 'form': opt.body = serializeForm(req, opt.body); break
    }
    // otherwise the Content-Type is set automatically by XMLHttpRequest, or though options.headers
  }

  if (opt.responseType === 'json' || opt.responseType == null) {
    opt.headers.attempt('Accept', 'application/json')
  }

  const url = new URL(opt.url, window.location.origin)
  if (opt.query) {
    setQueryParams(url.searchParams, opt.query)
  }

  return perform(url.toString(), opt, 1)
}

function perform(url: string, opt: MergedOptions, attempts: number): Promise<HoneybeeResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.onload = () => {
      const rawHeaders = xhr.getAllResponseHeaders()
      const res: HoneybeeResponse<unknown> = {
        status: xhr.status,
        get headers() {
          // @ts-ignore self-replacing getter
          delete this.headers
          // @ts-ignore
          return this.headers = parseHeaders(rawHeaders)
        },
        body: null
      }
      const resolveOrReject = (body: unknown) => {
        res.body = body
        if (res.status >= 200 && res.status < 300) {
          resolve(res)
        } else {
          reject(new ResponseError(xhr.statusText, res))
        }
      }
      if (xhr.status === 204) {
        resolve(res)
      } else if (xhr.status === 429 && attempts < opt.maxAttempts) {
        // Respect the Retry-After response header, but don't let it get too crazy
        const retryAfter = parseInt(res.headers.get('Retry-After')!)
        const delay = retryAfter > 0 ? Math.min(retryAfter * 1000, opt.retryAfterMax)
          // Or just use a random-ish delay
          : expBackoff(opt.retryDelayStep, opt.retryDelayMax, opt.retryDelayJitter, attempts, 2)
        setTimeout(() => resolve(perform(url, opt, attempts + 1)), delay)
      } else if (typeof opt.responseType == 'function') {
        Promise.resolve(opt.responseType(res, xhr.response)).then(resolveOrReject, reject)
      } else {
        resolveOrReject(xhr.response)
      }
    }
    xhr.onerror = () => {
      reject(new NetError('Unknown network error'))
    }
    const onUploadProgress = opt.onUploadProgress
    if (onUploadProgress && xhr.upload) {
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable)
          onUploadProgress(Math.floor(evt.loaded / evt.total * 100), evt.loaded, evt.total)
      }
    }
    const onDownloadProgress = opt.onDownloadProgress
    if (onDownloadProgress) {
      xhr.onprogress = (evt) => {
        if (evt.lengthComputable)
          onDownloadProgress(Math.floor(evt.loaded / evt.total * 100), evt.loaded, evt.total)
      }
    }
    xhr.ontimeout = () => {
      reject(new TimeoutError())
    }
    xhr.open(opt.method || 'GET', url)
    xhr.responseType = typeof opt.responseType == 'function' ? 'blob'
      : opt.responseType == null ? 'json'
      : opt.responseType
    xhr.withCredentials = Boolean(opt.credentials)
    xhr.timeout = opt.timeout
    for (const [key, val] of opt.headers) {
      xhr.setRequestHeader(key, val)
    }
    xhr.send(opt.body)
  })
}

/**
 * {'lowercased-header': 'string value'}
 * - In the event of duplicate headers the values will be joined with ", "
 * - "Access-Control-Expose-Headers" may affect what is available here
 */
function parseHeaders(raw: string): HeaderMap {
  //const raw = xhr.getAllResponseHeaders()
  const rx = /([^:]+):(.+)/g
  const headers = new HeaderMap()
  let match, key, val
  while (match = rx.exec(raw)) {
    key = match[1].trim()
    val = match[2].trim()
    headers.append(key, val)
  }
  return headers
}
