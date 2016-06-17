'use strict'
/* eslint-env node, es6 */
const http = require('http')
const https = require('https')
const parseUrl = require('url').parse
const stringifyQuery = require('querystring').stringify
const zlib = require('zlib')

const ServiceError = require('./service-error')
const helpers = require('./helpers')

const GZIP_MIN_BYTES = 1500
const CONTENT_TYPES = {
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
}

// Beware uncaught exceptions on idle sockets
// @see https://github.com/nodejs/node/pull/4482
// Landed in node-v4.4.0
const AGENT_OPTIONS = {
  keepAlive: true,
  keepAliveMsecs: 60e3,
  maxSockets: Infinity,
  maxFreeSockets: 256,
}
const basicAgent = new http.Agent(AGENT_OPTIONS)
const secureAgent = new https.Agent(AGENT_OPTIONS)

const REDIRECT_CODES = [301, 302, 303, 307, 308]

// Use GET instead of the original method (POST/PUT/etc)
const WEIRD_REDIRECT_CODES = [301, 302, 303]

const RETRY_CODES = [
  429, // Too Many Requests
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]

/**
 * Perform a http(s) request to a JSON-API, includes gzip-encoding & timeout support
 * Will attempt exponential backoff/retry on timeouts, 429 & 5xx errors
 * @param {string} opt.uri
 * @param {string} opt.method GET, PUT, POST, DELETE
 * @param {function} done(err, res)
 * TODO custom headers object e.g. {'X-Request-Id': ...}
 * @param {string?} opt.accept (default: json) Custom "Accept" header
 *        If defined, then response data will be a raw Buffer
 * @param {string?} opt.type (default: json) One of CONTENT_TYPES
 * @param {object?} opt.auth An object matching the AuthorizationAgent interface
 * @param {object?} opt.body Will be JSON encoded
 * @param {object?} opt.query Will be serialized as the url query string
 * @param {number?} opt.timeout (default: 90e3) Total time before giving up
 * @param {number?} opt.maxRedirects (default: 5)
 * @param {number?} opt.retry.low (default: 500) Initial delay in milliseconds
 * @param {number?} opt.retry.high (default: 10e3) Maximum delay between attempts
 * @param {number?} opt.retry.total (default: 10) Number of attempts before giving up
 * @return {function} Use this to abort the request at any point
 *
 * class AuthorizationAgent {
 *   // @return {function} abort()
 *   refresh(httpOptions, done) {...}
 *
 *   // @return {string} Authorization header or null
 *   // @example "Bearer 123556xxx"
 *   toHeader() {...}
 * }
 */
function request(opt, done) {
  const type = opt.type || 'json'
  const timeout = opt.timeout || 90e3
  const uri = parseUrl(opt.uri)
  const query = stringifyQuery(opt.query) || uri.query
  const MAX_REDIRECTS = opt.maxRedirects || 5
  let body = serializeBody(type, opt.method, opt.body)
  let _abort
  let isAborted = false
  let isDone = false
  let didRefresh = false
  let timerMax
  let attempts = 0
  let redirectAttempts = 0

  // On by default, test for false explicitly
  const retry = opt.retry === false
    ? {total: 1}
    : opt.retry || {low: 500, high: 10e3, total: 10}

  let httpOptions = {
    headers: {
      Accept: opt.accept || CONTENT_TYPES.json,
      'Accept-Encoding': 'gzip'
    },
    protocol: uri.protocol, // Only used by agnosticRequest()
    method: opt.method,
    hostname: uri.hostname,
    port: uri.port,
    path: uri.pathname + (query ? '?'+query : '')
  }

  if (opt.auth) httpOptions.headers.Authorization = opt.auth.toHeader()
  if (body) {
    httpOptions.headers['Content-Type'] = CONTENT_TYPES[type] || type
    httpOptions.headers['Content-Length'] = Buffer.byteLength(body, 'utf8')
  }

  function handleResponse(res) {
    let chunks = []
    const statusCode = res.statusCode
    const headers = res.headers

    // No content
    res.resume() // Make sure we drain any data even if we don't use it
    if (statusCode === 204) return next()

    if (helpers.contains(WEIRD_REDIRECT_CODES, statusCode)) {
      // Regardless of the original HTTP verb, these redirects should use GET
      // (by design or de facto implementation)
      httpOptions.method = 'GET'
      httpOptions.headers['Content-Type'] = null
      httpOptions.headers['Content-Length'] = null
      body = null
    }

    if (helpers.contains(REDIRECT_CODES, statusCode)) {
      // General redirect handler
      if (++redirectAttempts >= MAX_REDIRECTS)
        return next(new ServiceError(500, 'too many redirects'))
      const uri = parseUrl(res.headers.location)
      httpOptions.protocol = uri.protocol
      httpOptions.hostname = uri.hostname
      httpOptions.port = uri.port
      httpOptions.path = uri.path
      return perform()
    }

    if (['gzip', 'deflate'].indexOf(res.headers['content-encoding']) !== -1)
      res = res.pipe(zlib.createUnzip())
    res.on('error', next)
    res.on('data', function (chunk){ chunks.push(chunk) })
    res.on('end', function parseResponse() {
      const raw = Buffer.concat(chunks)
      const content = opt.accept ? raw : helpers.parseJSON(raw.toString('utf8'))
      // Attempt to renew authorization
      if (statusCode === 401 && !didRefresh && canRefresh()) _abort = opt.auth.refresh(httpOptions, onRefresh)
      // Or just error out
      else if (statusCode < 200 || statusCode >= 300)
        next(parseError(content, statusCode))
      // Or success!
      else next(null, content, headers)
    })
  }

  function canRefresh(){ return opt.auth && opt.auth.refresh }

  function onRefresh(err) {
    // Only try to refresh our auth token ONE TIME
    httpOptions.headers.Authorization = opt.auth.toHeader()
    didRefresh = true
    if (err) next(err)
    else perform()
  }

  function next(err, res, headers) {
    if (!isAborted && err
      && (err.code === 'ECONNRESET' || helpers.contains(RETRY_CODES, err.status))
      && ++attempts < retry.total
    ) {
      // Exponential backoff/retry on local timeout or specific response codes
      const delay = Math.floor(Math.pow(2, attempts) * Math.random()) * retry.low
      setTimeout(perform, Math.min(delay, retry.high))
    }
    else if (!isDone) {
      isDone = true // ensure done() is only called once
      clearTimeout(timerMax)
      done(err, res, headers)
    }
  }

  function perform() {
    const req = agnosticRequest(httpOptions)
      .on('response', handleResponse)
      .on('error', next)
    _abort = function (){ req.abort() }
    req.end(body)
  }

  function abort() {
    isAborted = true
    clearTimeout(timerMax)
    _abort()
  }

  function start() {
    if (timeout) timerMax = setTimeout(abort, timeout)
    if (canRefresh() && !httpOptions.headers.Authorization) _abort = opt.auth.refresh(httpOptions, onRefresh)
    else perform()
  }

  // Compress the request body if it's large enough
  if (httpOptions.headers['Content-Length'] > GZIP_MIN_BYTES) {
    httpOptions.headers['Content-Encoding'] = 'gzip'
    zlib.gzip(body, function (err, buf) {
      if (err) {
        isDone = true
        done(err)
      }
      else {
        httpOptions.headers['Content-Length'] = buf.length
        body = buf
        start()
      }
    })
  }

  else start()
  return abort
}

/**
 * @param {object} payload
 * @param {number} statusCode
 * @return {Error}
 */
function parseError(payload, statusCode) {
  return new ServiceError(statusCode,
    payload && payload.bundle && payload.bundle.message,
    payload && payload.bundle && payload.bundle.name)
}

/**
 * @param {string} type
 * @param {string} method
 * @param {object?} content
 * @return {string}
 */
function serializeBody(type, method, content) {
  if (content) {
    // TODO unsupported content types
    if (type === 'json') {
      return method === 'PATCH' ? JSON.stringify(content) : helpers.toJSON(content)
    }
    if (type === 'form') return stringifyQuery(content)
    return content // passthrough custom content-types
  }
}

/**
 * http/https each have distinct methods and require distinct agents
 * This helper abstracts these concerns behind "opt.protocol"
 */
function agnosticRequest(opt) {
  if (opt.protocol === 'https:') {
    opt.agent = secureAgent
    return https.request(opt)
  }
  opt.agent = basicAgent
  return http.request(opt)
}

module.exports = request
module.exports.GZIP_MIN_BYTES = GZIP_MIN_BYTES
module.exports.basicAgent = basicAgent
module.exports.secureAgent = secureAgent
// TODO agent.destroy() when shutting down, so the upstream servers can clean up
