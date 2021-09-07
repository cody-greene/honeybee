'use strict'/* eslint-env browser, commonjs */

var STATUS_CODES = require('./status-codes.json')
var CONTENT_TYPES = {
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
}

/**
 * @param {array} haystack
 * @param {any} needle
 * @return {boolean}
 */
function contains(haystack, needle){ return haystack.indexOf(needle) !== -1 }

/**
 * v8 will deoptimize blocks containing try-catch
 * Use this helper to avoid deopts on larger funcs
 */
function parseJSON(str) {
  try { return JSON.parse(str) }
  catch (x){ return null }
}

/**
 * Ensure a callback is only invoked one time
 */
function once(fn) {
  var wasCalled = false
  return function () {
    if (!wasCalled) {
      wasCalled = true
      fn.apply(this, arguments)
    }
  }
}

/**
 * Object.assign() implementation
 * @param {object} target
 * @param {object} ...sources
 */
var merge = forEachAndEvery(function (target, src, key) {
  if (typeof src[key] != 'undefined') target[key] = src[key]
})

/**
 * @example ({'x-my-hEaDeR': 'value'}, {Accept: 'text/plain'})
 *          => {'x-my-header': 'value', accept: 'text/plain'}
 * @param {object} target
 * @param {object} ...source
 * @return {object}
 */
var mergeHeaders = forEachAndEvery(function (target, src, key) {
  target[key.toLowerCase()] = src[key]
})

/** @private */
function forEachAndEvery(action) {
  return function (target) {
    for (var index = 1; index < arguments.length; index++) {
      var src = arguments[index]
      if (src != null) for (var key in src) if (src.hasOwnProperty(key)) {
        action(target, src, key)
      }
    }
    return target
  }
}

/**
 * Unlike require('querystring').stringify, keys with empty values will be omitted
 * This also means we're not pulling in all of the "querystring" module with browserify
 * @param {object} params
 * @return {string}
 * @example {foo: 1, bar: [2,3], baz: false} => foo=1&bar=2&bar=3
 */
function stringifyQuery(params, qmark) {
  var res = params && Object.keys(params)
    .map(function (key) {
      var ks = encodeURIComponent(key) + '='
      var val = params[key]
      if (Array.isArray(val)) {
        return val.map(function (item) {
          return ks + stringifyPrimitive(item)
        }).join('&')
      }
      val = stringifyPrimitive(val)
      return val ? ks + val : null
    })
    .filter(Boolean)
    .join('&')
  return res ? qmark
    ? '?' + res
    : res
    : ''
}

function stringifyPrimitive(val) {
  switch (typeof val) {
  case 'string': return encodeURIComponent(val)
  case 'boolean': return val ? 'true' : ''
  case 'number': return isFinite(val) ? val.toString() : ''
  default: return ''
  }
}

/**
 * Calculate exponential backoff/retry delay
 * @example getDelay(100, 400, ...)
 *   ---------------------------------
 *    attempts | possible delay
 *   ----------+----------------------
 *        1    | 0, 100
 *        2    | 0, 100, 200
 *        3+   | 0, 100, 200, 300, 400
 *   ---------------------------------
 * @param {number} low
 * @param {number} high
 * @param {number} attempts
 * @return {number} x = 0 | low <= x <= high
 */
function getDelay(low, high, attempts) {
  var slots = Math.pow(2, attempts)
  var selected = Math.floor(slots * Math.random())
  return Math.min(selected * low, high)
}

/**
 * @param {number} statusCode 404, 429, etc
 * @param {string?} message
 * @param {object?} opts Additional props to merge
 */
class RequestError extends Error {
  constructor(statusCode, message, props) {
    super(message || STATUS_CODES[this.statusCode])
    this.name = 'RequestError'
    this.statusCode = statusCode || 500
    merge(this, props)
  }
}

/**
 * May provide one or both
 * @param {function?} Promise Wrap the callback API with a promise implementation
 * @param {object?} defaults Bind some default options, e.g. parseError
 */
function requestWithBindings(request) {
  return function (Promise, defaults) {
    if (typeof Promise == 'function') return function requestWithPromise(opt) {
      return new Promise(function executor(resolve, reject, onCancel) {
        var cancel = request(opt, function (err, res) {
          if (err) {
            if (res) {
              // Promises can't take multiple value so attach these to the error obj
              err.headers = res.headers
              err.body = res.body
            }
            reject(err)
          }
          else resolve(res)
        }, defaults)
        if (onCancel) onCancel(cancel)
      })
    }

    defaults = Promise || defaults
    return function requestWithDefaults(opt, done) {
      return request(opt, done, defaults)
    }
  }
}

/**
 * Default response handlers
 */
function parseJSONResponse(req, res) {
  res.body = parseJSON(res.body.toString()) || {}
}
function getParser(par) {
  switch (par) {
  case 'json': return parseJSONResponse
  case 'raw': return Function.prototype
  default: return par
  }
}
function parseJSONError(req, res) {
  var payload = parseJSON(res.body.toString())
  return new RequestError(res.statusCode, payload && payload.message)
}
function parseTextError(req, res) {
  return new RequestError(res.statusCode, res.body.toString())
}
function getErrorParser(par) {
  switch (par) {
  case 'json': return parseJSONError
  case 'text': return parseTextError
  default: return par
  }
}

/**
 * Default request serializers
 */
function serializeJSON(req) {
  req.headers['content-type'] = CONTENT_TYPES.json
  // May already be stringified
  if (typeof req.body != 'string') {
    req.body = (req.body === null || req.body === undefined)
      ? null : JSON.stringify(req.body)
  }
}
function serializeForm(req) {
  req.headers['content-type'] = CONTENT_TYPES.form
  req.body = stringifyQuery(req.body)
}
function getSerializer(ser) {
  switch (ser) {
  case 'json': return serializeJSON
  case 'form': return serializeForm
  case 'noop': return Function.prototype
  default: return ser
  }
}

module.exports = {
  once: once,
  withBindings: requestWithBindings,
  getErrorParser: getErrorParser,
  getParser: getParser,
  getSerializer: getSerializer,
  parseJSONResponse: parseJSONResponse,
  parseJSONError: parseJSONError,
  RequestError: RequestError,
  contains: contains,
  getDelay: getDelay,
  merge: merge,
  mergeHeaders: mergeHeaders,
  parseJSON: parseJSON,
  stringifyQuery: stringifyQuery,
  CONTENT_TYPES: CONTENT_TYPES,
}

Object.defineProperty(module.exports, '__esModule', {value: true})
