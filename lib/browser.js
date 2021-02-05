'use strict'/* eslint-env browser, commonjs */

var util = require('./helpers')
var RETRY_CODES = [
  429, // Too Many Requests
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]

/**
 * See readme.md for options
 * TODO @param {boolean?} opt.fresh If true, then ignore the browser cache (broken in IE, firefox <49)
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
  }, _boundOptions, opt)
  opt.url = opt.url + util.stringifyQuery(opt.query, true)
  opt.headers = util.mergeHeaders({
    accept: util.CONTENT_TYPES.json
  }, _boundOptions && _boundOptions.headers, opt.headers)
  var attempts = 0
  var cancelXHR, retryTimer
  // if (opt.fresh) opt.headers['cache-control'] = 'no-cache'
  if (opt.body) util.getSerializer(opt.serialize)(opt)
  retry()
  function retry() {
    attempts += 1
    cancelXHR = perform(opt, next)
  }
  function next(err, res) {
    // TODO retry on transient local connection errors? (err.statusCode == 1)
    if (err && attempts < opt.total && util.contains(RETRY_CODES, err.statusCode)) {
      retryTimer = setTimeout(retry, util.getDelay(opt.low, opt.high, attempts))
    }
    else done(err, res)
  }
  return function abortRequest() {
    // TODO make sure callback is never invoked?
    clearTimeout(retryTimer)
    cancelXHR()
  }
}

/**
 * Assumes options have already been processed
 * @param {function} done(err, res)
 * @return {function} cancel
 */
function perform(opt, done) {
  var xhr = new XMLHttpRequest()
  xhr.onload = function () {
    var res = {
      headers: parseHeaders(xhr.getAllResponseHeaders()),
      statusCode: xhr.status,
      body: xhr.responseText
    }
    if (res.statusCode === 204) done(null, res)
    else if (res.statusCode >= 200 && res.statusCode < 300) {
      var err = util.getParser(opt.parseResponse)(opt, res)
      if (err instanceof Error) done(err, res)
      else done(null, res)
    }
    else {
      done(util.getErrorParser(opt.parseError)(opt, res), res)
    }
  }
  xhr.onerror = function () {
    done(new util.Error(1, 'unknown network error'))
  }
  if (opt.onProgress) {
    if (xhr.upload) xhr.upload.progress = function (evt) {
      // upload progress [0-50]
      if (evt.lengthComputable) opt.onProgress(Math.floor(evt.loaded / evt.total * 50))
    }
    xhr.progress = function (evt) {
      // download progress [50-100]
      if (evt.lengthComputable) opt.onProgress(50 + Math.floor(evt.loaded / evt.total * 50))
    }
  }
  xhr.open(opt.method, opt.url)
  xhr.withCredentials = opt.withCredentials
  setHeaders(xhr, opt.headers)
  xhr.send(opt.body)
  return function () {
    xhr.abort()
  }
}

/**
 * Apply multiple request headers
 * @param {XMLHttpRequest}
 * @param {object} headers
 */
function setHeaders(xhr, headers) {
  for (var name in headers) if (headers.hasOwnProperty(name)) {
    xhr.setRequestHeader(name, headers[name])
  }
}

/**
 * @param {string} raw See xhr.getAllResponseHeaders()
 * @return {object} 'lowercased-header': 'string value'
 * - In the event of duplicate headers the value will be an array
 * - "Access-Control-Expose-Headers" may affect what is available here
 */
function parseHeaders(raw) {
  var rx = /([^:]+):(.*)/g
  var headers = {}
  var match, key, val
  while (match = rx.exec(raw)) {
    key = match[1].trim().toLowerCase()
    val = match[2].trim()
    if (headers.hasOwnProperty(key)) {
      if (typeof headers[key] !== 'string') headers[key].push(val)
      else headers[key] = [headers[key], val]
    }
    else headers[key] = val
  }
  return headers
}

module.exports = util.merge(request, util, {
  default: request,
  withCallback: request,
  withBindings: util.withBindings(request),
  withPromise: (typeof Promise === 'undefined')
    ? function (){ throw new Error('native Promise API not found') }
    : util.withBindings(request)(Promise) // eslint-disable-line no-undef
})
Object.defineProperty(module.exports, '__esModule', {value: true})
