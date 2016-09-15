Minimal dependency http(s) library for node & modern browsers with:
- exponential backoff/retry
- configurable error parsing
- [callback API](#callback-api)
- [support for native Promises](#native-promises)
- [support for bound Promise](#bound-promise)
- cancellation
- JSON by default
- less than `7kb` (minified) when bundled for the browser

Browser support: IE9+, with browserify/webpack
Node support: v4.4+

#### Callback API
```javascript
const request = require('@cody-greene/request')
let cancel = request({url}, function (err, res) {
  if (err) console.warn(err.statusCode, err.stack)
  else console.log(res)
})

// Immediately abort the XHR or the node http request
// The callback will not be invoked
cancel()
```

#### Native Promises
```javascript
import {withPromise as request} from '@cody-greene/request'
request({url})
  .then(res => console.log(res))
  .catch(err => console.warn(err.statusCode, err.stack))
```

#### Bound Promise
```javascript
const Promise = require('bluebird')
const request = require('@cody-greene/request').withBindings(Promise)
request({url})
  .then(res => console.log(res))
  .catch(err => console.warn(err.statusCode, err.stack))
  .cancel()
```

#### Bound Defaults
```javascript
// or withBindings(Promise, defaults)
const myRequest = require('@cody-greene/request').withBindings({
  low: 500,
  high: 2000,
  total: 3,
  parseError: parseMyErrorFormat
})
myRequest({url})
```

#### Common options
* `{string} opt.url`
* `{string} opt.method` GET, PUT, PATCH, POST, DELETE
* `{object} opt.headers` e.g. Content-Type, Request-Id
* `{object} opt.body` Will be processed by `opt.serialize`
* `{object} opt.query` Will be serialized as the url query string
* `{number} opt.low` (default: 200) Initial retry delay in milliseconds
* `{number} opt.high` (default: 1000) Maximum retry delay between attempts
* `{number} opt.total` (default: 5) Number of connection attempts before giving up
* `{function|string} opt.serialize(req)` Should convert `req.body` to a string or Buffer for transport and set `req.headers['content-type']` as appropriate
  - "json" => "application/json" (default)
  - "form" => "application/x-www-form-urlencoded"
  - "noop"
* `{function|string} opt.parseResponse(req, res) => Error|any` res.body is a string (browser) or a Buffer (node). Called with 2xx response codes
  - "json" => Object (default)
  - "raw" => Buffer (node) or string (browser)
* `{function|string} opt.parseError(req, res) => Error` called with non-2xx response codes
  - "json"
  - "text"

#### Browser-only options
* `{bool} opt.withCredentials` Enable cross-origin cookies
* `{function} opt.onProgress(percent)` 0-50: upload, 50-100: download

#### Node-only options
* [`{AuthorizationAgent} opt.auth`](#AuthorizationAgent)
* `{number} opt.timeout` (default: 60e3) Total time before giving up
* `{number} opt.maxRedirects` (default: 5)
* `{bool} opt.gzip` Compress the request body
* [`{http.Agent} opt.conn`](https://nodejs.org/api/http.html#http_class_http_agent) Configure your own connection agent

#### AuthorizationAgent
```javascript
class AuthorizationAgent {
  /**
   * Called (once) in the event of a 401 statusCode
   * Use this to fetch a new access token for .toHeader()
   * Supports both the node-callback style as well as a Promise
   * @function refresh(opt, done)
   * @param {object} req Current request options, including headers
   * @param {function} done(err)
   * @return {function|Promise} abort()
   */

  /**
   * @function toHeader()
   * @return {string|null} The "Authorization" header
   * @example => "Bearer 718b3f..."
   */
}
```

#### Examples
```javascript
import request, {Error as RequestError, parseJSON} from '@cody-greene/request'

// Get a Google OAuth2 access token
request({
  method: 'POST',
  uri: 'https://www.googleapis.com/oauth2/v3/token',
  // Encode the request as
  serialize: 'form',
  body: {
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token'
  },
  parseError: function parseGoogError(req, res) {
    // Every API is different so we need to to some extra work
    // to get a useful Error out of the response
    var payload = parseJSON(res.body)
    var message  = payload && payload.error ? payload.error.message
      ? payload.error.message
      : payload.error
      : 'invalid JSON response'
    return new RequestError(res.statusCode, message, res.constructor)
  }
}, function (err, creds) {
  // The response is JSON encoded and may be handled by the default parser
  if (err) console.warn(err.stack)
  else console.log('Authorization: Bearer ' + creds.access_token)
})

// Custom serializer & response parser
request({
  method: 'POST',
  url: 'http://localhost',
  body: {foo: 1, bar: 2},
  headers: {
    'content-type': 'text/plain;charset=utf-8',
    'accept': 'text/plain;charset=utf-8'
  },
  serialize: (req) => { req.body }
  parseResponse: (res) => res.body,
  parseError: (res) => new RequestError(res.statusCode, res.body)
})
```

#### Standalone module
Create a standalone UMD bundle (which exports to `window.request` as a last resort):
```
$ browserify -s request . | uglifyjs -cm >request-v1.0.0.min.js
```
