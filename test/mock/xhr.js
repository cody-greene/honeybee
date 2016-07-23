'use strict'
const parseUrl = require('url').parse
let GLOBAL_REQUEST_HANDLER = null

/**
 * This module defines a mock implementation of global.XMLHttpRequest
 * Same API as mock/http.js
 */
module.exports = {
  origin: 'http://localhost',
  setHandler(cb) { GLOBAL_REQUEST_HANDLER = cb }
}

function MockXMLHttpRequest() {
  this.withCredentials = false
  this.upload = {}
  // TODO this.onerror()
  // TODO this.upload.progress({lengthComputable: true, loaded: 0, total: 0})
  // TODO this.progress({lengthComputable: true, loaded: 0, total: 0})
}

MockXMLHttpRequest.prototype.open = function (method, url) {
  this.req = Object.assign(parseUrl(url, true), {
    method, url,
    headers: {}
  })
  this.res = {
    send: (statusCode, body, headers) => {
      if (this.isCancelled) return
      this.res.headers = headers
      this.responseText = typeof body === 'string' ? body : ''
      this.status = statusCode
      process.nextTick(() => this.onload())
    }
  }
}

MockXMLHttpRequest.prototype.send = function (body) {
  this.req.body = body
  if (body) this.req.headers['content-length'] = Buffer.byteLength(body)
  process.nextTick(() => GLOBAL_REQUEST_HANDLER(this.req, this.res))
}

MockXMLHttpRequest.prototype.setRequestHeader = function (name, value) {
  // TODO merge duplicate headers
  this.req.headers[name.toLowerCase()] = value
}

MockXMLHttpRequest.prototype.getAllResponseHeaders = function () {
  let headers = this.res.headers
  let raw = ''
  for (let key in headers) if (headers.hasOwnProperty(key)) {
    raw += `${key}: ${headers[key]}\r\n`
  }
  return raw
}

MockXMLHttpRequest.prototype.abort = function () {
  this.isCancelled = true
  this.onabort()
}

global.XMLHttpRequest = MockXMLHttpRequest
