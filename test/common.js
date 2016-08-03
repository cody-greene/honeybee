'use strict'
const assert = require('assert')

module.exports = function declareWith(server, request) {
  it('supports "json" requests', function (done) {
    let expectedRequest = {id: 1, msg: 'hello world'}
    let expectedResponse = {id: 2, msg: 'hello clarice'}
    server.setHandler(function (req, res) {
      assert.equal(req.method, 'POST')
      assert.equal(req.headers['content-type'], 'application/json')
      assert.equal(req.headers['content-length'], Buffer.byteLength(JSON.stringify(expectedRequest)))
      assert.deepStrictEqual(req.body.toString(), JSON.stringify(expectedRequest))
      res.send(200, JSON.stringify(expectedResponse), {'content-type': 'application/json'})
    })
    request({
      method: 'POST',
      url: server.origin,
      body: expectedRequest
    }, function (err, res) {
      assert.ifError(err)
      assert.deepStrictEqual(res, expectedResponse, 'parsed response data')
      done()
    })
  })

  it('supports "json" error messages', function (done) {
    server.setHandler(function (req, res) {
      res.send(401, JSON.stringify({message: 'stop, theif!'}), {'content-type': 'application/json'})
    })
    request({url: server.origin}, function (err) {
      assert.equal(err.statusCode, 401)
      assert.equal(err.message, 'stop, theif!')
      done()
    })
  })

  it('supports "form-urlencoded" requests', function (done) {
    server.setHandler(function (req, res) {
      assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded')
      assert.equal(req.headers['content-length'], 24)
      assert.equal(req.body.toString(), 'lights=5&compliance=true')
      res.send(204)
    })
    request({
      method: 'POST',
      url: server.origin,
      serialize: 'form',
      body: {lights: 5, compliance: true}
    }, done)
  })

  it('does NOT retry when cancelled', function (done) {
    let first = true
    server.setHandler(function (req, res) {
      assert(first, 'recieved a single request')
      first = true
      setTimeout(() => res.send(204), 25)
    })
    const cancel = request({url: server.origin}, function () {
      done(new Error('should never get here; cancelled'))
    })
    assert.equal(typeof cancel, 'function')
    process.nextTick(cancel)
    done()
  })

  it('retries on 429 errors', function (done) {
    let counter = 0
    const expectedRetries = 2
    server.setHandler(function (req, res) {
      counter += 1
      if (counter >= expectedRetries) res.send(204)
      else res.send(429)
    })
    request({
      high: 1, // speed up the test
      url: server.origin
    }, function (err) {
      assert.ifError(err)
      assert.equal(counter, expectedRetries)
      done()
    })
  })

  it('retries no more than "opt.total" times', function (done) {
    let counter = 0
    const maxRetries = 3
    server.setHandler(function (req, res) {
      counter += 1
      res.send(429)
    })
    request({
      high: 1, // speed up the test
      total: maxRetries,
      url: server.origin
    }, function (err) {
      // unlike the basic retry test, this expects FAILURE
      assert.equal(err.statusCode, 429)
      assert.equal(counter, maxRetries)
      done()
    })
  })

  it('supports custom headers', function (done) {
    server.setHandler(function (req, res) {
      assert.equal(req.headers['content-length'], null)
      assert.equal(req.headers['request-id'], '2e2e2e', 'got user-defined header')
      assert.equal(req.headers['x-cursed-love'], 'Hexed Lust', 'header names are case insensitive')
      res.send(204)
    })
    request({
      url: server.origin,
      headers: {
        'request-id': '2e2e2e',
        'X-Cursed-lOvE': 'Hexed Lust'
      }
    }, done)
  })

  it('supports custom serializers', function (done) {
    server.setHandler(function (req, res) {
      assert.equal(req.headers['content-type'], 'text/plain;charset=utf-8')
      assert.equal(req.body.toString(), 'fedcba')
      res.send(204)
    })
    request({
      method: 'POST',
      url: server.origin,
      body: 'abcdef',
      serialize: function (req) {
        // TODO more req props
        req.headers['content-type'] = 'text/plain;charset=utf-8'
        req.body = req.body.split('').reverse().join('')
      }
    }, done)
  })

  it('supports custom response parsers', function (done) {
    server.setHandler(function (req, res) {
      res.send(200, 'electric feel', {'content-type': 'text/plain;charset=utf-8'})
    })
    request({
      url: server.origin,
      parseResponse: function (req, res) {
        // TODO return Error
        assert.equal(typeof req.headers, 'object')
        assert.equal(res.statusCode, 200)
        assert.equal(res.headers['content-type'], 'text/plain;charset=utf-8')
        assert.equal(res.body.toString(), 'electric feel')
        return 'oracular spectacular'
      }
    }, function (err, res) {
      assert.ifError(err)
      assert.equal(res, 'oracular spectacular')
      done()
    })
  })

  it('supports custom error parsers', function (done) {
    let expected = new Error('bad news bears')
    server.setHandler(function (req, res) {
      res.send(404, 'where is it?', {'content-type': 'text/plain;charset=utf-8'})
    })
    request({
      url: server.origin,
      parseError: function (req, res) {
        assert.equal(res.statusCode, 404)
        assert.equal(res.headers['content-type'], 'text/plain;charset=utf-8')
        assert.equal(res.body.toString(), 'where is it?')
        return expected
      }
    }, function (err) {
      assert.equal(err, expected)
      done()
    })
  })
}
