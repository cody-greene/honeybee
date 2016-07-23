'use strict'
const http = require('http')
const util = require('../../lib/helpers')

/**
 * Instead of mocking up http.request(), it's simpler to just create a server on a random port
 * Make sure to define a handler to intercept all requests before each test
 * Use "server.origin" for the base url of any tests
 * @example server.setHandler(function (req, res) {
 *   // res.send(204)
 *   // res.send(200, 'Hello, World!')
 *   // res.send(401, '{"message": "unauthorized"}', {'content-type': 'application/json'})
 *   // res.send(307, null, {location: '/other'})
 * })
 *
 * @param {object} req.headers
 * @param {string} req.body
 * @param {string} req.method GET, PUT, etc
 * @param {string} req.url /foo/bar/baz?var=1
 * req also includes the parsed url components: host, path, etc
 * @param {function} res.send(statusCode, headers, body)
 */
function createMockServer(done) {
  let testHandler = null
  let server = http.createServer()
  .on('error', done)
  .on('request', function (req, res) {
    res.setHeader('connection', 'close')
    res.send = function (statusCode, body, headers) {
      this.writeHead(statusCode, headers)
      this.end(body)
    }
    if (util.contains(['PUT', 'POST', 'PATCH'], req.method)) {
      let chunks = []
      req.on('data', ch => chunks.push(ch))
      req.on('end', () => {
        req.body = Buffer.concat(chunks)
        testHandler(req, res)
      })
    }
    else testHandler(req, res)
  })
  .listen(function () {
    this.origin = 'http://localhost:' + this.address().port
    done()
  })
  server.setHandler = (cb) => testHandler = cb
  return server
}

module.exports = createMockServer
