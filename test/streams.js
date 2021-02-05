'use strict'
const assert = require('assert')
const stream = require('stream')
const request = require('../lib/node')
const createMockServer = require('./mock/http')
let server = null

before('serverSetup', done => {
  server = createMockServer(done)
})

after(() => {
  server.close()
})

describe('node (streaming)', function () {
  it('returns a Readable stream', done => {
    server.setHandler((req, res) => {
      res.send(200, 'hotel california')
    })
    let readable = request.withStream({url: server.origin})
    let hasData = false
    assert(readable instanceof stream.Readable)
    readable.on('data', chunk => {
      hasData = true
      assert.equal(chunk.toString(), 'hotel california')
    })
    readable.on('end', () => {
      assert(hasData)
      done()
    })
  })
  it('returns a Writable stream', done => {
    server.setHandler((req, res) => {
      assert.equal(req.body.toString(), 'birds are weird')
      res.send(204)
      done()
    })
    let writable = request.withStream({method: 'POST', url: server.origin})
    assert(writable instanceof stream.Writable)
    writable.write('birds')
    writable.end(' are weird')
    writable.resume()
  })
  it.skip('can be cancelled', done => {
    server.setHandler(() => {
      // never respond
    })
    let req = request.withStream({url: server.origin})
    .on('error', err => {
      // node's built-in http.ClientRequest will emit 'abort' followed by 'error' (socket hang up)
      assert(err)
      done()
    })
    setTimeout(() => {
      req.abort()
    }, 10)
  })
  it('emits a "response" event', done => {
    server.setHandler((req, res) => {
      res.send(204, null, {foo: 'like a brick'})
    })
    request.withStream({url: server.origin})
    .on('response', res => {
      assert.equal(res.statusCode, 204)
      assert.equal(res.headers.foo, 'like a brick')
      done()
    })
    .resume()
  })
  it('emits an "error" event on non-2xx status codes', done => {
    server.setHandler((req, res) => {
      res.send(400, 'too much noise', {
        'content-type': 'application/vnd.test+text'
      })
    })
    request.withStream({
      url: server.origin,
      parseError: 'text'
    })
    .on('error', (err, res) => {
      assert.equal(res.headers['content-type'], 'application/vnd.test+text')
      assert(Buffer.isBuffer(res.body))
      assert.equal(res.body.toString(), 'too much noise')
      done()
    })
  })
})
