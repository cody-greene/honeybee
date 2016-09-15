'use strict'
const assert = require('assert')
const zlib = require('zlib')
const request = require('../lib/node')
const createMockServer = require('./mock/http')
const commonTests = require('./common')
let server = null

before('serverSetup', done => {
  server = createMockServer(done)
  describe('node (common)', () => commonTests(server, request))
})

describe('node (unique)', function () {
  it('supports gzipped responses', function (done) {
    const expected = {status: 'gzipped!'}
    const buf = zlib.gzipSync(new Buffer(JSON.stringify(expected)))
    server.setHandler(function (req, res) {
      res.send(200, buf, {
        'content-type': 'application/json',
        'content-encoding': 'gzip'
      })
    })
    request({url: server.origin}, function (err, res) {
      assert.ifError(err)
      assert.deepStrictEqual(res, expected)
      done()
    })
  })

  it('gzips the request body', function (done) {
    let expected = {message: 'Honey, I shrunk the kids!'}
    let expectedString = JSON.stringify(expected)
    server.setHandler(function (req, res) {
      assert.equal(req.headers['content-encoding'], 'gzip')
      assert.equal(req.headers['content-length'], 59)
      req.body = zlib.gunzipSync(req.body).toString('utf8')
      assert.equal(req.body, expectedString)
      res.send(204)
    })
    request({
      method: 'POST',
      url: server.origin,
      gzip: true,
      body: expected
    }, done)
  })

  it('stops the request if it takes too long', function (done) {
    server.setHandler(function (req, res) {
      setTimeout(()=> res.send(204), 25)
    })
    request({
      url: server.origin,
      timeout: 10
    }, function (err) {
      assert(err)
      done()
    })
  })

  it('includes an authorization header', function (done) {
    const token = '12345'
    server.setHandler(function (req, res) {
      assert.equal(req.headers.authorization, `Bearer ${token}`)
      res.send(204)
    })
    request({
      url: server.origin,
      auth: {toHeader: () => 'Bearer ' + token}
    }, function (err) {
      assert.ifError(err)
      done()
    })
  })

  it('should refresh the access token', function (done) {
    const expectedToken = '67890'
    let activeToken = '12345'
    let hits = 0
    server.setHandler(function (req, res) {
      hits += 1
      res.send(req.headers.authorization === expectedToken ? 204 : 401)
    })
    request({
      url: server.origin,
      auth: {
        toHeader(){ return activeToken },
        refresh: (httpOptions, next) => process.nextTick(() => {
          activeToken = expectedToken
          next()
        })
      }
    }, function (err) {
      assert.ifError(err)
      assert.equal(hits, 2)
      done()
    })
  })

  it.only('AuthAgent#refresh() may return a promise', function (done) {
    const expectedToken = '67890'
    let activeToken = '12345'
    let hits = 0
    server.setHandler(function (req, res) {
      hits += 1
      res.send(req.headers.authorization === expectedToken ? 204 : 401)
    })
    request({
      url: server.origin,
      auth: {
        toHeader(){ return activeToken },
        refresh: () => {
          activeToken = expectedToken
          return Promise.resolve()
        },
      }
    }, function (err) {
      assert.ifError(err)
      assert.equal(hits, 2)
      done()
    })
  })

  it('follows 302 redirects', function (done) {
    let hits = 0
    server.setHandler(function (req, res) {
      hits += 1
      if (hits === 1 && req.url === '/old') res.send(302, null, {location: '/new'})
      else if (hits === 2 && req.url === '/new') res.send(204)
      else res.send(404)
    })
    request({url: server.origin + '/old'}, done)
  })

  it('follows no more than N redirects', function (done) {
    const N = 3
    let count = 0
    server.setHandler(function (req, res) {
      if (count <= N) res.send(302, null, {location: '/loop'})
      else res.send(204)
      count += 1
    })
    request({
      url: server.origin,
      maxRedirects: N
    }, function (err) {
      assert.equal(err.statusCode, 302)
      assert.equal(count - 1, N) // First request doesn't count as a redirect
      done()
    })
  })

  /**
   * This test requires a secondary https server with a self-signed certificate
   * - the amount of code required to build a cert is overkill for this one test
   */
  it.skip('allows redirects from http to https', function (done) {
    server.setHandler(function (req, res) {
      if (req.protocol === 'http:') {
        res.send(308, null, {location: server.secureOrigin})
      }
      else {
        res.send(204)
      }
    })
    request({
      rejectUnauthorized: false,
      url: server.origin
    }, done)
  })

  it('should retry no more than T total milliseconds', function (done) {
    const T = 25
    let tstart = Date.now()
    server.setHandler(function (req, res) {
      res.send(429)
    })
    request({
      url: server.origin,
      timeout: T,
      high: 10,
      total: Infinity
    }, function (err) {
      assert(err)
      let elapsed = Date.now() - tstart
      // Give some leeway for the elapsed time
      assert(elapsed <= T*1.5, `${elapsed}ms elapsed`)
      done()
    })
  })
})
