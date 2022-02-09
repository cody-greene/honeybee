import it from 'tape'
import * as MockXHR from 'mock-xmlhttprequest'
import request from '../src/dom'
import {ResponseError, TimeoutError, NetError} from '../src/common'

declare module 'mock-xmlhttprequest' {
  export class MockXhr {
    /* The parameter of xhr.send() */
    body: any
    url: string
    requestHeaders: {
      getHash(): Record<string, undefined|string>
    }
  }
}

const ORIGIN = 'https://example.com'
// @ts-ignore Set origin for requests to relative urls
global.window = {location: {origin: ORIGIN}}

function useMockServer(test: it.Test, ...other: Parameters<typeof MockXHR.newServer>) {
  const server = MockXHR.newServer(...other).install()
  test.teardown(() => server.remove())
  server.setDefaultHandler((xhr) => {
    const requests = server.getRequestLog()
    const cur = requests[requests.length - 1]
    test.comment('404 ->' + cur.method + ' ' + cur.url)
    xhr.respond(404)
  })
  return server
}

/** Actual Blob class does not exist in node. So fake it! */
class FakeBlob {}

// If any one test fails then don't bother with the rest
it.onFailure(() => process.exit(1))

it('accepts JSON content by default', async (assert) => {
  const server = useMockServer(assert)
  const expectedContent = {color: 'red'}

  server.addHandler('GET', ORIGIN + '/foo', [
    // handle 1st request
    (xhr) => {
      const headers = xhr.requestHeaders.getHash()
      assert.equal(headers['content-type'], undefined,
        'does not send Content-Type header')
      assert.equal(headers.accept, 'application/json',
        'sends default Accept header')
      xhr.respond(200, {}, JSON.stringify(expectedContent))
    },
    // handle 2nd request
    (xhr) => {
      const headers = xhr.requestHeaders.getHash()
      assert.equal(headers.accept, 'application/custom',
        'sends custom Accept header')
      xhr.respond(200, {}, JSON.stringify(expectedContent))
    }
  ])

  const res1 = await request('/foo')
  assert.pass('works with a relative url')
  assert.deepEqual(res1.body, expectedContent,
    'response body is an object')

  const res2 = await request({url: '/foo', headers: {Accept: 'application/custom'}})
  assert.deepEqual(res2.body, expectedContent,
    'response body is still an object')

  assert.plan(6)
})

it('accepts custom content', async (assert) => {
  const server = useMockServer(assert)
  server.addHandler('GET', ORIGIN+'/foo', [
    (xhr) => {
      const headers = xhr.requestHeaders.getHash()
      assert.equal(headers.accept, 'application/custom',
        'sends custom Accept header')
      xhr.respond(200, {}, new FakeBlob())
    }
  ])

  const expectedBody = new Uint8Array()
  const res1 = await request({
    url: '/foo',
    headers: {Accept: 'application/custom'},
    responseType: (req, body) => {
      assert.ok(body instanceof FakeBlob, 'invokes callback with Blob')
      return expectedBody
    }
  })

  assert.is(res1.body, expectedBody,
    'response body is set to result of callback (sync)')

  const res2 = await request({
    url: '/foo',
    headers: {Accept: 'application/custom'},
    responseType: (req, body) => {
      assert.ok(body instanceof FakeBlob, 'invokes callback with Blob')
      return Promise.resolve(expectedBody)
    }
  })

  assert.is(res2.body, expectedBody,
    'response body is set to result of callback (async)')

  assert.plan(6)
})

it('sends json content', async (assert) => {
  const expectedBody = {color: 'red', type: 'widget'}
  const server = useMockServer(assert)
  server.addHandler('POST', ORIGIN+'/', [
    (xhr) => {
      const headers = xhr.requestHeaders.getHash()
      assert.equal(headers['content-type'], 'application/vnd.api+json',
        'sends Content-Type header')
      assert.ok(typeof xhr.body == 'string')
      assert.equal(xhr.body, JSON.stringify(expectedBody),
        'content is stringified')
      xhr.respond(204)
    },
    (xhr) => {
      const headers = xhr.requestHeaders.getHash()
      assert.equal(headers['content-type'], 'application/json',
        'sends default Content-Type header')
      xhr.respond(204)
    },
  ])

  await request({
    method: 'POST',
    url: ORIGIN,
    headers: {'Content-Type': 'application/vnd.api+json'},
    body: expectedBody,
  })

  await request({
    method: 'POST',
    url: ORIGIN,
    body: expectedBody,
  })

  assert.plan(4)
})

it('sends urlencoded content', async (assert) => {
  const server = useMockServer(assert)
  server.addHandler('POST', ORIGIN+'/', [
    (xhr) => {
      const headers = xhr.requestHeaders.getHash()
      assert.equal(headers['content-type'], 'application/x-www-form-urlencoded',
        'sends Content-Type header')
      assert.ok(xhr.body instanceof URLSearchParams,
        'sends content as URLSearchParams')
      assert.equal(xhr.body.toString(), 'id=123&colors=red&colors=blue')
      xhr.respond(204)
    }
  ])

  await request({
    method: 'POST',
    url: ORIGIN,
    requestType: 'form',
    body: {id: 123, colors: ['red', 'blue']}
  })

  assert.plan(3)
})

it('sends custom content', async (assert) => {
  const myContent = {id: 123, name: 'widget'}
  const myContentString = 'jsonp_cb(' + JSON.stringify(myContent) + ');'

  const server = useMockServer(assert)
  server.addHandler('POST', ORIGIN+'/', [
    (xhr) => {
      const headers = xhr.requestHeaders.getHash()
      assert.equal(headers['content-type'], 'application/javascript',
        'sends custom Content-Type header')
      assert.equal(xhr.body, myContentString,
        'sends body from callback as-is')
      xhr.respond(204)
    }
  ])

  await request({
    method: 'POST',
    url: ORIGIN,
    body: myContent,
    requestType(req, body) {
      req.headers.set('Content-Type', 'application/javascript')
      assert.pass('can set Content-Type in callback')
      assert.equal(body, myContent,
        'callback body is as provided to request options')
      return myContentString
    }
  })

  assert.plan(4)
})

it('sends query string params', async (assert) => {
  const server = useMockServer(assert)
  server.addHandler('GET', ORIGIN+'/pizza?toppings=olive&extraCheese=true&toppings=pineapple&size=large', [
    (xhr) => {
      assert.pass('query params object merged into original url params')
      xhr.respond(204)
    }
  ])

  await request({
    method: 'GET',
    url: ORIGIN + '/pizza?toppings=olive&extraCheese=true',
    // can use a plain object
    query: {toppings: 'pineapple', size: 'large'}
  })

  await request({
    method: 'GET',
    url: ORIGIN + '/pizza?toppings=olive&extraCheese=true',
    // or a URLSearchParams instance
    query: new URLSearchParams({toppings: 'pineapple', size: 'large'})
  })

  assert.plan(2)
})

it('sends custom headers', async (assert) => {
  const server = useMockServer(assert)
  server.addHandler('GET', ORIGIN+'/', [
    (xhr) => {
      const headers = xhr.requestHeaders.getHash()
      assert.equal(headers['x-request-id'], '123',
        'sends custom header')
      assert.equal(headers.whatever, 'Bearer xxxx',
        'sends other header')
      xhr.respond(204)
    }
  ])
  await request({
    url: ORIGIN,
    headers: {
      'X-Request-Id': '123',
      'Whatever': 'Bearer xxxx'
    }
  })

  assert.plan(2)
})

it('rejects with nice errors', async (assert) => {
  const server = useMockServer(assert)
  const expectedBody = {message: 'bad news bears', code: 'EXXX'}
  server.addHandler('GET', ORIGIN+'/bad', [
    (xhr) => {
      xhr.respond(400, {'Content-Type': 'application/json'}, JSON.stringify(expectedBody))
    },
    (xhr) => {
      xhr.respond(400, {'Content-Type': 'application/json'}, '***BAD JSON***')
    },
    () => {
      // this should timeout
    },
    (xhr) => {
      xhr.setNetworkError()
    },
  ])

  try {
    await request(ORIGIN + '/bad')
  } catch (err) {
    assert.ok(err instanceof ResponseError,
      'err is ResponseError')
    assert.equal(err.status, 400,
      'got correct status code')
    assert.equal(err.message, 'Bad Request',
      'error msg based on status text')
    assert.equal(err.headers.get('Content-Type'), 'application/json',
      'got reponse headers')
    assert.deepEqual(err.body, expectedBody,
      'got json response body')
  }

  try {
    await request(ORIGIN+'/bad')
  } catch (err) {
    assert.ok(err instanceof ResponseError,
      'err is ResponseError')
    assert.deepEqual(err.body, null,
      'invalid response data is nullified')
  }

  try {
    await request({url: ORIGIN+'/bad', timeout: 10})
  } catch (err) {
    assert.ok(err instanceof TimeoutError,
      'err is a TimeoutError')
  }

  try {
    await request(ORIGIN+'/bad')
  } catch (err) {
    assert.ok(err instanceof NetError,
      'err is a NetError')
  }

  assert.plan(9)
})

it('retries on 429 status (with Retry-After)', async (assert) => {
  const server = useMockServer(assert)
  let count = 0
  let ts = 0
  server.addHandler('GET', ORIGIN+'/busy', [
    (xhr) => {
      count = count + 1
      if (count === 1) {
        xhr.respond(429, {'Retry-After': '1'})
      } else if (count === 2) {
        assert.ok(Date.now() - ts >= 1000,
          'waited before retrying (Retry-After)')
        xhr.respond(429)
      } else if (count === 3) {
        assert.ok(Date.now() - ts >= 20,
          'waited before retrying (backoff)')
        xhr.respond(429)
      } else {
        assert.fail('should never reach here; too many requests')
      }
      ts = Date.now()
    },
  ])

  try {
    await request({
      url: ORIGIN+'/busy',
      maxAttempts: 3,
      // remove randomness
      retryDelayMax: 20,
      retryDelayStep: 20,
      retryDelayJitter: 0
    })
  } catch (err) {
    assert.ok(err instanceof ResponseError,
      'err is ReponseError')
    assert.equal(err.status, 429, 'returns correct status code')
  }

  assert.plan(4)
})

it.skip('supports onDownloadProgress', async (assert) => {})

it('supports onUploadProgress', async (assert) => {
  const server = useMockServer(assert)
  const reqBody = new Uint8Array(16) // 16 bytes
  server.addHandler('POST', ORIGIN+'/upload', (xhr) => {
    xhr.uploadProgress(8)
    //xhr.downloadProgress(bytesSent, bytesTotal)
    xhr.respond(200)
  })

  let count = 0
  await request({
    method: 'POST',
    url: ORIGIN+'/upload',
    body: reqBody,
    onUploadProgress(pct) {
      count = count + 1
      if (count === 1) {
        assert.equal(pct, 50, 'got callback')
      } else {
        assert.equal(pct, 100, 'got callback')
      }
    }
  })

  assert.plan(2)
})
