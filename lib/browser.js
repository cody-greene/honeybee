'use strict'
/* eslint-env browser */
var merge = require('lodash/merge')
import {toJSON, parseJSON} from '../util'
import STATUS_CODES from './status-codes.json'

const CONTENT_TYPES = {
  json: 'application/json'
}

/**
 * Perform a http(s) request to our backend.
 * Assume transparent cookie-based auth
 * Assume JSON responses with CORS support
 * The PATCH method allows null/false values in the request body
 * @param {string} opt.method GET, PUT, POST, DELETE
 * @param {string} opt.uri
 * @param {object?} opt.headers e.g. Content-Type, Request-Id
 * @param {object?} opt.body Encoded as one of CONTENT_TYPES
 * @param {object?} opt.query Will be serialized as the url query string
 * @param {boolean?} opt.fresh If true, then ignore the browser cache
 * @param {number?} opt.low (default: 200) Initial retry delay in milliseconds
 * @param {number?} opt.high (default: 1000) Maximum retry delay between attempts
 * @param {number?} opt.total (default: 5) Number of connection attempts before giving up
 * @return {Promise} .then() .catch() .cancel()
 */
const request = (opt) => new Promise(function (resolve, reject, onCancel) {
  opt = merge({
    method: 'GET',
    type: 'json',
    low: 200,
    high: 1000,
    total: 5
  }, opt)
  const req = {
    method: opt.method,
    body: opt.body,
    uri: opt.uri + stringifyQuery(opt.query),
    headers: merge({
      Accept: CONTENT_TYPES.json
    }, opt.headers)
  }
  let attempts = 0
  let xhr = null
  onCancel(function (){ xhr.abort() })
  if (opt.fresh) req.headers['Cache-Control'] = 'no-cache'
  serialize(req)

  function retry() {
    attempts += 1
    xhr = getJSON(req, next)
  }
  function next(err, res) {
    // TODO retry on transient local connection errors? (no status code)
    if (err && err.status === 429 && attempts < opt.total) {
      setTimeout(retry, getDelay(opt.low, opt.high, attempts))
    }
    else if (err) reject(err)
    else resolve(res)
  }

  retry()
})

/**
 * Stringify the request body and set the correct Content-Type
 * @param {object} req To be modified
 */
function serialize(req) {
  // Custom header, assume body is already serialized
  // FIXME should be truly case insensitive
  let type = req.headers['Content-Type'] || req.headers['content-type']
  if (!req.body || type) return

  // Default mode
  req.headers['Content-Type'] = CONTENT_TYPES.json
  // null values become significant in patch mode
  req.body = (req.method === 'PATCH') ? JSON.stringify(req.body) : toJSON(req.body)
}

/**
 * Assumes options have already been processed
 * @param {string} opt.uri
 * @param {string} opt.method
 * @param {string?} opt.body
 * @param {object?} opt.headers
 * @param {function} done(err, res)
 * @return {XMLHttpRequest} xhr.abort()
 */
function getJSON(opt, done) {
  const xhr = new XMLHttpRequest()
  xhr.onload = function () {
    const statusCode = xhr.status
    if (statusCode === 204) return done()
    const payload = parseJSON(xhr.responseText)
    if (!payload) done(new Error('invalid JSON response'))
    else if (statusCode >= 200 && statusCode < 300) done(null, payload)
    else done(parseError(payload, statusCode, STATUS_CODES[statusCode]))
  }
  xhr.onerror = function (){ done(new Error('connection error')) }
  xhr.open(opt.method, opt.uri)
  xhr.withCredentials = true // Enable cross-origin cookie
  setHeaders(xhr, opt.headers)
  xhr.send(opt.body)
  return xhr
}

/**
 * Apply multiple request headers
 * @param {XMLHttpRequest}
 * @param {object} headers
 */
function setHeaders(xhr, headers) {
  for (let name in headers) if (headers.hasOwnProperty(name)) {
    xhr.setRequestHeader(name, headers[name])
  }
}

/**
 * @param {object} payload
 * @param {number} statusCode
 * @param {string} statusText
 * @return {Error}
 */
function parseError(payload, statusCode, statusText) {
  let err = new Error(payload.error || statusText)
  err.name = 'APIError'
  err.status = statusCode
  return err
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
  let slots = Math.pow(2, attempts)
  let selected = Math.floor(slots * Math.random())
  return Math.min(selected * low, high)
}

/**
 * Unlike require('querystring').stringify, keys with empty values will be omitted
 * @param {object} params
 * @return {string}
 * @example {foo: 1, bar: [2,3], baz: false} => foo=1&bar=2&bar=3
 */
function stringifyQuery(params) {
  let res = params && Object.keys(params)
    .map(function (key) {
      let ks = encodeURIComponent(key) + '='
      let val = params[key]
      if (Array.isArray(val))
        return val.map(item => ks + stringifyPrimitive(item)).join('&')
      val = stringifyPrimitive(val)
      return val ? ks + val : null
    })
    .filter(Boolean)
    .join('&')
  return res ? '?'+res : ''
}

function stringifyPrimitive(val) {
  switch (typeof val) {
  case 'string': return encodeURIComponent(val)
  case 'boolean': return val ? 'true' : ''
  case 'number': return isFinite(val) ? val.toString() : ''
  default: return ''
  }
}

export {
  stringifyQuery,
  getJSON,
  request as default
}
