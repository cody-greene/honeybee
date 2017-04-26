'use strict' /* eslint-env node, es6 */
const stream = require('stream')
const http = require('http')
const https = require('https')
const parseUrl = require('url').parse
const zlib = require('zlib')
const util = require('./helpers')

// Beware uncaught exceptions on idle sockets
// @see https://github.com/nodejs/node/pull/4482
// Fixed in node-v4.4.0
const AGENT_OPTIONS = {
  keepAlive: true,
  keepAliveMsecs: 60e3,
  maxSockets: Infinity,
  maxFreeSockets: 256,
}
const BASIC_AGENT = new http.Agent(AGENT_OPTIONS)
const SECURE_AGENT = new https.Agent(AGENT_OPTIONS)
const VERSION = require('../package.json').version
const USER_AGENT = `honeybee/${VERSION} (github.com/cody-greene/honeybee)`

// Use GET instead of the original method (POST/PUT/etc)
const WEIRD_REDIRECT_CODES = [302, 303]
const REDIRECT_CODES = [301, 302, 303, 307, 308]
const RETRY_CODES = [
  429, // Too Many Requests
  503, // Service Unavailable
]

/**
 * See readme.md for options
 * TODO agent.destroy() when shutting down, so the upstream servers can clean up
 */
function request(opt, done, _boundOptions) {
  opt = util.merge({
    method: 'GET',
    low: 200,
    high: 1000,
    total: 5,
    serialize: 'json',
    parseResponse: 'json',
    parseError: 'json',
    maxRedirects: 5,
    timeout: 60e3,
  }, _boundOptions, opt)
  const url = parseUrl(opt.url)
  var _abort, maxTimer, retryTimer
  let canRefresh = opt.auth && opt.auth.refresh
  let isAborted = false
  let attempts = 0
  opt.protocol = url.protocol
  opt.hostname = url.hostname
  opt.port = url.port
  opt.path = url.pathname + util.stringifyQuery(opt.query, true)
  opt.headers = util.mergeHeaders({
    'accept-encoding': 'gzip',
    accept: util.CONTENT_TYPES.json,
    'user-agent': USER_AGENT
  }, _boundOptions && _boundOptions.headers, opt.headers)
  if (opt.auth) opt.headers.authorization = opt.auth.toHeader()
  if (opt.body) {
    util.getSerializer(opt.serialize)(opt)
    opt.headers['content-length'] = Buffer.byteLength(opt.body)
  }
  if (opt.timeout) maxTimer = setTimeout(function () {
    done(new util.Error(0, 'connection reset by client'))
    abort()
  }, opt.timeout)
  if (opt.gzip) compress(opt, retry) // FIXME abort during compression
  else retry()
  function retry() {
    attempts += 1
    if (canRefresh && !opt.headers.authorization) refresh()
    else _abort = perform(opt, 0, util.once(next))
  }
  function next(err, res) {
    if (isAborted) {}
    else if (err && err.statusCode === 401 && canRefresh) refresh()
    else if (
      err && attempts < opt.total
      && (err.code === 'ECONNRESET' || util.contains(RETRY_CODES, err.statusCode))
    ) {
      // Exponential backoff/retry on local timeout or specific response codes
      retryTimer = setTimeout(retry, util.getDelay(opt.low, opt.high, attempts))
    }
    else {
      clearTimeout(maxTimer)
      done(err, res)
    }
  }
  function refresh() {
    _abort = opt.auth.refresh(opt, onRefresh)
    if (_abort && typeof _abort.then == 'function') _abort.then(onRefresh, next)
  }
  function onRefresh(err) {
    // auth.refresh() may return a promise that doesn't support .cancel()
    if (isAborted) return

    // Only try to refresh our auth token ONE TIME
    canRefresh = false
    opt.headers.authorization = opt.auth.toHeader()
    if (err) next(err)
    else retry()
  }
  function abort() {
    isAborted = true
    clearTimeout(retryTimer)
    clearTimeout(maxTimer)
    if (typeof _abort == 'function') _abort()
    else if (_abort && typeof _abort.cancel == 'function') _abort.cancel()
  }
  return abort
}

function perform(opt, redirectAttempts, done) {
  let emitter = agnosticRequest(opt).on('error', done)
  let _cancel = () => emitter.abort() // replaced when redirected
  emitter.on('response', function (responseEmitter) {
    let res = {
      statusCode: responseEmitter.statusCode,
      headers: responseEmitter.headers,
      body: null
    }
    let onError = (err) => done(err, res)
    responseEmitter.on('error', onError)
    responseEmitter.resume() // Make sure we drain any data even if unused
    if (res.statusCode === 204) return done(null, res) // No content
    if (util.contains(WEIRD_REDIRECT_CODES, res.statusCode)) {
      // Regardless of the original HTTP verb, these redirects should use GET
      // (by design or de facto implementation)
      // Use delete, since headers[] = null still sends "header: null"
      // and headers[] = undefined will cause setHeaders() to throw
      opt.method = 'GET'
      opt.body = null
      delete opt.headers['content-type']
      delete opt.headers['content-length']
      delete opt.headers['content-encoding']
    }
    if (util.contains(REDIRECT_CODES, res.statusCode)) {
      if (redirectAttempts >= opt.maxRedirects)
        return done(new util.Error(res.statusCode, 'too many redirects', res), res)
      const url = parseUrl(res.headers.location)
      if (url.hostname) {
        opt.protocol = url.protocol
        opt.hostname = url.hostname
        opt.port = url.port
      }
      opt.path = url.path
      _cancel = perform(opt, redirectAttempts + 1, done)
      return
    }
    if (util.contains(['gzip', 'deflate'], res.headers['content-encoding'])) {
      responseEmitter = responseEmitter.pipe(zlib.createUnzip()).on('error', onError)
    }
    collect(responseEmitter, function (responseBuffer) {
      res.body = responseBuffer
      if (res.statusCode >= 200 && res.statusCode < 300) {
        let err = util.getParser(opt.parseResponse)(opt, res)
        if (err) done(err, res)
        else done(null, res)
      }
      else {
        done(util.getErrorParser(opt.parseError)(opt, res), res)
      }
    })
  })

  emitter.end(opt.body)
  return () => _cancel()
}

/**
 * @param {EventEmitter} stream
 * @param {function} done(Buffer)
 */
function collect(stream, done) {
  let chunks = []
  stream.on('data', function (ch){ chunks.push(ch) })
  stream.on('end', function () {
    done(Buffer.concat(chunks))
  })
}

/**
 * Gzip the request body (if it's large enough)
 */
function compress(req, done) {
  req.headers['content-encoding'] = 'gzip'
  zlib.gzip(req.body, function (err, buf) {
    if (err) done(err)
    else {
      req.body = buf
      req.headers['content-length'] = buf.length
      done()
    }
  })
}

/**
 * http/https each have distinct methods and require distinct agents
 * This helper abstracts these concerns by using "opt.protocol"
 */
function agnosticRequest(opt) {
  if (opt.protocol === 'https:') {
    opt.agent = opt.conn || SECURE_AGENT
    return https.request(opt)
  }
  opt.agent = opt.conn || BASIC_AGENT
  return http.request(opt)
}

class DuplexProxyStream extends stream.Duplex {
  constructor() {
    super()
    this._proxyState = {
      dest: null,
      src: null,
      finished: false,
    }
    this.onError = err => this.emit('error', err)
    this.on('finish', () => {
      this._proxyState.finished = true
      if (this._proxyState.dest) this._proxyState.dest.end()
    })
  }
  attachWriteable(dest) {
    this._proxyState.dest = dest
    dest.on('finish', () => this.end())
    if (this._proxyState.finished) dest.end()
  }
  attachReadable(src) {
    this._proxyState.src = src
    src.on('data', chunk => {
      if (!this.push(chunk)) src.pause()
    })
    src.on('end', () => this.push(null))
    if (this.isPaused()) src.pause()
  }
  _write(chunk, enc, next) {
    let dest = this._proxyState.dest
    if (!dest) {
      next(new Error('writeable stream is not attached; did you mean to POST/PUT/PATCH instead?'))
    }
    else {
      dest.write(chunk, enc, next)
    }
  }
  _read() {
    if (this._proxyState.src) this._proxyState.src.resume()
  }
}

function isWritable(method) {
  return method === 'POST' || method === 'PUT' || method === 'PATCH'
}

function performStream(opt, redirectAttempts, proxyStream) {
  let reqStream = agnosticRequest(opt)
  if (redirectAttempts === 0 && isWritable(opt.method)) {
    proxyStream.attachWriteable(reqStream)
  }
  reqStream.on('error', proxyStream.onError)
  reqStream.on('response', function (resStream) {
    let res = {
      statusCode: resStream.statusCode,
      headers: resStream.headers,
      body: null
    }
    resStream.on('error', proxyStream.onError)
    resStream.resume() // Make sure we drain any data even if unused
    proxyStream.emit('response', res)
    if (res.statusCode === 204) return
    if (util.contains(WEIRD_REDIRECT_CODES, res.statusCode)) {
      // Regardless of the original HTTP verb, these redirects should use GET
      // (by design or de facto implementation)
      // Use delete, since headers[] = null still sends "header: null"
      // and headers[] = undefined will cause setHeaders() to throw
      opt.method = 'GET'
      opt.body = null
      delete opt.headers['content-type']
      delete opt.headers['content-length']
      delete opt.headers['content-encoding']
    }
    if (util.contains(REDIRECT_CODES, res.statusCode)) {
      if (redirectAttempts >= opt.maxRedirects) {
        proxyStream.emit('error', new util.Error(res.statusCode, 'too many redirects'))
        return
      }
      if (isWritable(opt.method)) {
        proxyStream.emit('error', new util.Error(res.statusCode, `stream redirected (${res.statusCode}) but unable to follow (${opt.method}) since the data was not buffered – try the non-streaming api`))
        return
      }
      const url = parseUrl(res.headers.location)
      if (url.hostname) {
        opt.protocol = url.protocol
        opt.hostname = url.hostname
        opt.port = url.port
      }
      opt.path = url.path
      performStream(opt, redirectAttempts + 1, proxyStream)
      return
    }
    if (util.contains(['gzip', 'deflate'], res.headers['content-encoding'])) {
      resStream = resStream.pipe(zlib.createUnzip()).on('error', proxyStream.onError)
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      proxyStream.attachReadable(resStream)
    }
    else collect(resStream, buf => {
      res.body = buf
      let err = util.getErrorParser(opt.parseError)(opt, res)
      proxyStream.emit('error', err, res)
    })
  })
  if (!isWritable(opt.method)) reqStream.end()
  return proxyStream
}

function requestWithStream(opt, _boundOptions) {
  opt = util.merge({
    method: 'GET',
    serialize: 'noop',
    parseResponse: 'json',
    parseError: 'json',
    maxRedirects: 5
  }, _boundOptions, opt)
  let url = parseUrl(opt.url)
  let canRefresh = opt.auth && opt.auth.refresh
  let proxyStream = new DuplexProxyStream()
  opt.hostname = url.hostname
  opt.port = url.port
  opt.path = url.pathname + util.stringifyQuery(opt.query, true)
  opt.headers = util.mergeHeaders({
    'accept-encoding': 'gzip',
    accept: util.CONTENT_TYPES.json,
    'user-agent': USER_AGENT
  }, _boundOptions && _boundOptions.headers, opt.headers)
  if (opt.auth) opt.headers.authorization = opt.auth.toHeader()
  if (canRefresh && !opt.headers.authorization) {
    let prom = opt.auth.refresh(opt, onRefreshStream)
    if (prom && typeof prom.then == 'function') {
      // Yep, it's a Promise
      prom.then(onRefreshStream, proxyStream.onError)
    }
  }
  else {
    performStream(opt, 0, proxyStream)
  }

  function onRefreshStream(err) {
    opt.headers.authorization = opt.auth.toHeader()
    if (err) proxyStream.onError(err)
    else performStream(opt, 0, proxyStream)
  }

  return proxyStream
}

module.exports = util.merge(request, util, {
  BASIC_AGENT, SECURE_AGENT,
  default: request,
  withStream: requestWithStream,
  withStreamBindings: util.withBindings(requestWithStream),
  withBindings: util.withBindings(request),
  withPromise: (typeof Promise === 'undefined')
    ? function (){ throw new Error('native Promise API not found') }
    : util.withBindings(request)(Promise) // eslint-disable-line no-undef
})
Object.defineProperty(module.exports, '__esModule', {value: true})
