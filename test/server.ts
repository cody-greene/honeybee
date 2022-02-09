import nock from 'nock'
import it from 'tape'
import request, {RedirectError} from '../src/server'
import {ResponseError, TimeoutError, NetError} from '../src/common'

const ORIGIN = 'https://example.com'

// If any one test fails then don't bother with the rest
it.onFailure(() => process.exit(1))

function useNock(test: it.Test) {
  const nscope = nock(ORIGIN)
  test.teardown(() => { nscope.done() })
  return nscope
}

it('accepts JSON content by default', async (assert) => {
  const expectedContent = {color: 'red'}

  useNock(assert)
    .get('/foo').reply(function (url, body, cb) {
      const headers = this.req.headers
      assert.equal(headers['content-type'], undefined,
        'does not send Content-Type header')
      assert.equal(headers.accept, 'application/json',
        'sends default Accept header')
      cb(null, [200, JSON.stringify(expectedContent), {}])
    })
    .get('/foo').reply(function (url, body, cb) {
      const headers = this.req.headers
      assert.equal(headers.accept, 'application/custom',
        'sends custom Accept header')
      cb(null, [200, JSON.stringify(expectedContent), {}])
    })

  const res1 = await request(ORIGIN+'/foo')
  assert.pass('works with a relative url')
  assert.deepEqual(res1.body, expectedContent,
    'response body is an object')

  const res2 = await request({url: ORIGIN+'/foo', headers: {Accept: 'application/custom'}})
  assert.deepEqual(res2.body, expectedContent,
    'response body is still an object')

  assert.plan(6)
})

it('accepts custom content', async (assert) => {
  useNock(assert)
    .get('/foo').times(2).reply(function (url, body, cb) {
      const headers = this.req.headers
      assert.equal(headers.accept, 'application/custom',
        'sends custom Accept header')
      cb(null, [200, Buffer.alloc(8), {}])
    })

  const expectedBody = new Uint8Array()
  const res1 = await request({
    url: ORIGIN+'/foo',
    headers: {Accept: 'application/custom'},
    responseType: (req, body) => {
      assert.ok(body instanceof Buffer, 'invokes callback with Blob')
      return expectedBody
    }
  })

  assert.is(res1.body, expectedBody,
    'response body is set to result of callback (sync)')

  const res2 = await request({
    url: ORIGIN+'/foo',
    headers: {Accept: 'application/custom'},
    responseType: (req, body) => {
      assert.ok(body instanceof Buffer, 'invokes callback with Blob')
      return Promise.resolve(expectedBody)
    }
  })

  assert.is(res2.body, expectedBody,
    'response body is set to result of callback (async)')

  assert.plan(6)
})

it('sends json content', async (assert) => {
  const expectedBody = {color: 'red', type: 'widget'}

  useNock(assert)
    .post('/').reply(function (url, body) {
      const headers = this.req.headers
      assert.equal(headers['content-type'], 'application/vnd.api+json',
        'sends custom Content-Type header')
      assert.equal(typeof body, 'string')
      assert.equal(body, JSON.stringify(expectedBody),
        'content is stringified')
      return [204]
    })
    .post('/').reply(function () {
      const headers = this.req.headers
      assert.equal(headers['content-type'], 'application/json',
        'sends default Content-Type header')
      return [204]
    })

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
  useNock(assert)
    .post('/').reply(function (uri, body) {
      const headers = this.req.headers
      assert.equal(headers['content-type'], 'application/x-www-form-urlencoded',
        'sends Content-Type header')
      assert.equal(typeof body, 'string',
        'sends content as URLSearchParams')
      assert.equal(body, 'id=123&colors=red&colors=blue')
      return [204]
    })

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

  useNock(assert)
    .post('/').reply(function (url, body) {
      const headers = this.req.headers
      assert.equal(headers['content-type'], 'application/javascript',
        'sends custom Content-Type header')
      assert.equal(body, myContentString,
        'sends body from callback as-is')
      return [204]
    })

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
  useNock(assert)
    .get('/pizza?toppings=olive&extraCheese=true&toppings=pineapple&size=large').times(2).reply(function () {
      assert.pass('query params object merged into original url params')
      return [204]
    })

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
  useNock(assert)
    .get('/').reply(function () {
      const headers = this.req.headers
      assert.equal(headers['x-request-id'], '123',
        'sends custom header')
      assert.equal(headers.whatever, 'Bearer xxxx',
        'sends other header')
      return [204]
    })

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
  const expectedBody = {message: 'bad news bears', code: 'EXXX'}
  useNock(assert)
    .get('/bad').reply(function () {
      return [400, JSON.stringify(expectedBody), {'Content-Type': 'application/json'}]
    })
    .get('/bad').reply(function () {
      return [400, '***BAD JSON***', {'Content-Type': 'application/json'}]
    })
    .get('/bad').delayConnection(500).reply(function () {
      // this should timeout (before connection)
      return [204]
    })
    .get('/bad').delay(500).reply(function () {
      // this should also timeout (while receiving a response)
      return [204]
    })
    .get('/bad').replyWithError('this should be a network error')

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
    await request({url: ORIGIN+'/bad', timeout: 100})
  } catch (err) {
    assert.ok(err instanceof TimeoutError,
      'err is a TimeoutError')
  }

  try {
    await request({url: ORIGIN+'/bad', timeout: 100})
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

  assert.plan(10)
})

it('retries on 429 status (with Retry-After)', async (assert) => {
  let count = 0
  let ts = 0
  useNock(assert)
    .get('/busy').times(3).reply(function () {
      count = count + 1
      if (count === 1) {
        return [429, null, {'Retry-After': 1}]
      } else if (count === 2) {
        assert.ok(Date.now() - ts >= 1000,
          'waited before retrying (Retry-After)')
        return [429]
      } else if (count === 3) {
        assert.ok(Date.now() - ts >= 20,
          'waited before retrying (backoff)')
        return [429]
      } else {
        assert.fail('should never reach here; too many requests')
      }
      ts = Date.now()
    })

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

it('supports maxRedirects', async (assert) => {
  useNock(assert)
    .get('/left').times(2).reply(function () {
      return [302, null, {Location: ORIGIN+'/right'}]
    })
    .get('/right').times(1).reply(function () {
      return [302, null, {Location: ORIGIN+'/left'}]
    })

  try {
    await request({url: ORIGIN+'/left', maxRedirects: 2})
  } catch (err) {
    assert.ok(err instanceof RedirectError,
      'err is RedirectError')
  }

  assert.plan(1)
})

it('handles relative redirects', async (assert) => {
  useNock(assert)
    .get('/left').reply(function () {
      return [307, null, {Location: '/left/right'}]
    })
    .get('/left/right').reply(function () {
      assert.pass('followed relative url (full path)')
      return [307, null, {Location: './center'}]
    })
    .get('/left/center').reply(function () {
      assert.pass('followed relative url')
      return [307, null, {Location: '../end'}]
    })
    .get('/end').reply(function () {
      assert.pass('followed relative url (double dot)')
      return [204]
    })

  await request({url: ORIGIN+'/left', maxRedirects: 3})

  assert.plan(3)
})

it('handles method altering redirects', async (assert) => {
  useNock(assert)
    .post('/left').reply(function () {
      return [303, null, {Location: '/right'}]
    })
    .get('/right').reply(function () {
      assert.pass('followed 303 redirect')
      return [204]
    })

  await request({method: 'post', url: ORIGIN+'/left'})

  assert.plan(1)
})

it.skip('supports onDownloadProgress', async (assert) => {})

it.skip('supports onUploadProgress', async (assert) => {})
