
export interface HoneybeeRequest {
  headers: HeaderMap
}
export interface HoneybeeResponse<T=any> {
  status: number
  headers: HeaderMap
  /** Server only. The values of any Set-Cookie headers */
  cookies?: string[]
  body: T
}
export interface QueryParams {
  [key:string]: undefined|string|number|Array<string|number>
}

export class ResponseError<T=any> extends Error {
  status: number
  headers: HeaderMap
  body: T

  constructor(message: string, res: HoneybeeResponse<T>) {
    super(message)
    this.name = 'ResponseError'
    this.status = res.status
    this.headers = res.headers
    this.body = res.body
  }
}

export class TimeoutError extends Error {
  constructor() {
    super('Request timed out')
    this.name = 'TimeoutError'
  }
}
export class NetError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'NetError'
    this.code = code
  }
}

export interface ProgressCallback {
  (pct: number, bytesWritten: number, bytesExpected: number): void
}

const SINGLE_HEADERS = [
  'age',
  'authorization',
  'content-length',
  'content-type',
  'etag',
  'expires',
  'from',
  'host',
  'if-modified-since',
  'if-unmodified-since',
  'last-modified',
  'location',
  'max-forwards',
  'proxy-authorization',
  'referer',
  'retry-after',
  'server',
  'user-agent'
]

/**
 * Map but with case-insensitive keys
 *
 * @link https://developer.mozilla.org/en-US/docs/Web/API/Headers
 * The Headers API exists, but is not fully supported by firefox android.
 */
export class HeaderMap extends Map<string, string> {
  delete(key: string): boolean {
    return super.delete(key.toLowerCase())
  }
  get(key: string): string | undefined {
    return super.get(key.toLowerCase())
  }
  has(key: string): boolean {
    return super.has(key.toLowerCase())
  }
  set(key: string, value: string|number): this {
    return super.set(key.toLowerCase(), String(value))
  }
  /** Set value only if key is not already set */
  attempt(key: string, value: string|number): this {
    if (this.has(key)) {
      return this
    }
    return this.set(key, value)
  }
  /**
   * Duplicates in raw headers are handled in the following ways, depending on the header name:
   * Duplicates of age, authorization, content-length, content-type, etag,
   * expires, from, host, if-modified-since, if-unmodified-since,
   * last-modified, location, max-forwards, proxy-authorization, referer,
   * retry-after, server, or user-agent are discarded.
   *
   * set-cookie is always an array. Duplicates are added to the array.
   *
   * For duplicate cookie headers, the values are joined together with '; '.
   *
   * For all other headers, the values are joined together with ', '.
   */
  append(key: string, value: string|number): this {
    const lk = key.toLowerCase()
    if (SINGLE_HEADERS.includes(lk)) {
      return super.set(lk, String(value))
    }
    const prev = super.get(lk)
    const sep = lk === 'cookie' ? '; ' : ', '
    return prev == null ? super.set(lk, String(value))
      : super.set(lk, prev + sep + value)
  }
}

/** @internal */
export function mergeDefaults(defaults: Record<string, any>, opt: Record<string, any>): Record<string, any> {
  let result: Record<string, any> = Object.create(defaults)
  Object.keys(opt).forEach(key => {
    if (typeof (opt[key]) != 'undefined')
      result[key] = opt[key]
  })
  return result as any
}

/** @internal */
export function setQueryParams(dest: URLSearchParams|FormData, src: URLSearchParams|QueryParams): void {
  if (src instanceof URLSearchParams) {
    src.forEach((key, val) => {
      dest.append(val, key)
    })
  } else for (let [key, val] of Object.entries(src)) {
    if (Array.isArray(val)) {
      // WARNING: shallow
      val.forEach(v => dest.append(key, v as string))
    } else if (val != null) {
      dest.append(key, val as string)
    }
  }
}

/** @internal */
export function serializeJSON(req: HoneybeeRequest, body: object): string {
  if (!req.headers.has('Content-Type')) {
    req.headers.set('Content-Type', 'application/json')
  }
  return JSON.stringify(body)
}

/** @internal */
export function serializeForm(req: HoneybeeRequest, body: QueryParams): URLSearchParams {
  if (!req.headers.has('Content-Type')) {
    req.headers.set('Content-Type','application/x-www-form-urlencoded')
  }
  const params = new URLSearchParams()
  setQueryParams(params, body)
  return params
}

/**
 * Calculate exponential backoff/retry delay.
 * Where attempts >= 1, exp > 1
 * @example expBackoff(100, 500, 0, attempts)
 *   ---------------------------------
 *    attempts | possible delay
 *   ----------+----------------------
 *        1    | 100, 200
 *        2    | 100, 200, 300, 400
 *        3+   | 100, 200, 300, 400, 500
 *   ---------------------------------
 * Attempts required before max delay is possible = Math.ceil(Math.log(high/step) / Math.log(exp))
 * @internal
 */
export function expBackoff(step: number, high: number, jitter: number, attempts: number, exp?: number): number {
  exp = exp || 2
  const slots = Math.ceil(Math.min(high/step, Math.pow(exp, attempts)))
  const selected = 1 + Math.floor(slots * Math.random())
  const delay = selected * step + Math.floor(Math.random() * jitter * 2) - jitter
  return Math.max(0, Math.min(delay, high))
}
