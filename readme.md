Minimal dependency http(s) library for node & modern browsers with:
- exponential backoff/retry (on status code: 429, 503)
- custom error parsing, define how to extract a message
- [callback API](#callback-api)
- [support for native Promises](#native-promises)
- [support for other Promise implementations](#bound-promise)
- support for streams
- cancellation
- JSON by default
- less than `7kb` (minified) when bundled for the browser
- browser support: IE9+, with browserify/webpack
- node support: v4.4+

#### Callback API
```javascript
const request = require('honeybee')
let cancel = request({url}, function (err, res) {
  if (err) console.warn(err.statusCode, res.headers, err.stack)
  else console.log(res.body)
})

// Immediately abort the XHR or the node http request
// The callback will not be invoked
cancel()
```

#### Native Promises
```javascript
import {withPromise as request} from 'honeybee'
request({url})
  .then(res => console.log(res.body))
  .catch(err => console.warn(err.statusCode, err.headers, err.stack))
```
Note how headers are attached to the error object.

#### Bound Promise
```javascript
const Promise = require('bluebird')
const request = require('honeybee').withBindings(Promise)
request({url})
  .then(res => console.log(res.body))
  .catch(err => console.warn(err.statusCode, err.stack))
  .cancel()
```

#### Bound Defaults
```javascript
// or withBindings(Promise, defaults)
const request = require('honeybee').withBindings({
  low: 500,
  high: 2000,
  total: 3,
  parseError: parseMyErrorFormat
})
request({url})
```

#### Common options
* `{string} opt.url`
* `{string} opt.method` GET, PUT, PATCH, POST, DELETE
* `{object} opt.headers` default values:
  - `accept-encoding: 'gzip'`
  - `accept: 'application/json'`
  - `user-agent: 'honeybee/${VERSION} (github.com/cody-greene/honeybee)'`
* `{object} opt.body` Will be processed by `opt.serialize`
* `{object} opt.query` Will be serialized as the url query string
* `{number} opt.low` (default: 200) Initial retry delay in milliseconds
* `{number} opt.high` (default: 1000) Maximum retry delay between attempts
* `{number} opt.total` (default: 5) Number of connection attempts before giving up
* `{function|string} opt.serialize(req)` Should convert `req.body` to a string or Buffer for transport and set `req.headers['content-type']` as appropriate
  - "json" => "application/json" (default)
  - "form" => "application/x-www-form-urlencoded"
  - "noop"
* `{function|string} opt.parseResponse(req, res) => Error|any` Called with 2xx response codes. Should replace `res.body` or return an Error
  - "json" => Object (default)
  - "raw" => Buffer (node) or string (browser)
* `{function|string} opt.parseError(req, res) => Error` Called with non-2xx response codes. Should extract a useful message from the response body and return an Error
  - "json"
  - "text"

#### Browser-only options
* `{bool} opt.withCredentials` Enable cross-origin cookies
* `{function} opt.onProgress(percent)` 0-49: upload, 50-99: download

#### Node-only options
* [`{AuthorizationAgent} opt.auth`](#authorizationagent)
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
   * @param {object} req Current request options, including headers
   * @param {function} done(err)
   * @return {function|Promise} abort()
   */
   refresh(opt, done) {}

  /**
   * @return {string|null} The "Authorization" header
   * @example => "Bearer 718b3f..."
   */
   toHeader() {}
}
```

#### Examples
```javascript
const request = require('honeybee')

// Get a Google OAuth2 access token
request({
  method: 'POST',
  uri: 'https://www.googleapis.com/oauth2/v3/token',
  serialize: 'form',
  body: {
    refresh_token: '...',
    client_id: process.env.GOOG_OAUTH_CLIENT_ID,
    client_secret: process.env.GOOG_OAUTH_CLIENT_SECRET,
    grant_type: 'refresh_token'
  },
  parseError: (req, res) => {
    // Every API is different so we need to to some extra work
    // to get a useful Error out of the response
    var payload = request.parseJSON(res.body)
    var message  = payload && payload.error ? payload.error.message
      ? payload.error.message
      : payload.error
      : 'invalid JSON response'
    return new request.Error(res.statusCode, message)
  }
}, (err, res) => {
  // The response is JSON encoded and may be handled by the default parser
  if (err) console.warn(err.statusCode + ' ' + err.message)
  else console.log('Authorization: Bearer ' + res.body.access_token)
})

// Pipe to or from a request stream!
fs.createReadStream('avatar.png')
  .on('error', console.log)
  .pipe(request.withStream({
    method: 'PUT',
    url: 'https://api.example.com/files',
    headers: {
      authorization: 'Bearer 123456',
      'content-type': 'image/png',
    }
  }))
  .on('response', res => {
    console.log(res.headers)
  })
  .on('error', (err, res) => {
    console.log(res.statusCode + ' ' + err.message)
    console.log(res.body.toString('utf8'))
  })
  .pipe(process.stdout)
```

### Using the streaming API (node only)
- Several options are disabled/irrelevant
  - cancellation
  - body
  - low/high/total
  - OAuth refresh on `401` response code
  - serialize
  - parseResponse
  - gzip
- `307` & `308` redirects are not supported since that would require holding the entire request body in memory
- In the event of a non-2xx statusCode the response body will be fully buffered and pass through `parseError`. The result will be the first argument to `.on('error', (err, res) => ...)`
- The stream is writable only with `POST`/`PUT`/`PATCH` requests.
- As usual, if `X.pipe(Y)` and `X` emits an error then `Y` is not closed automatically. It is necessary to manually close each stream in order to prevent memory leaks.

#### Standalone module
Create a standalone UMD bundle (which exports to `window.honeybee` as a last resort):
```
$ tag=$(git describe --abbrev=0 --match 'v[0-9]*' --tags)
$ git checkout $tag
$ browserify -s honeybee . | uglifyjs -cm >honeybee-$tag.min.js
```
