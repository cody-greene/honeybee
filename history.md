# honeybee change log
## 2021-09-06 v2.0.3
- add "props" argument to RequestError

## 2021-08-18 v2.0.2
- refactor: include typescript def in release pkg
- fix: 304 not modified is no longer and error - wow

## 2021-02-04 v2.0.0
- BREAKING: `AuthorizationAgent#refresh()` is passed an Error object
- BREAKING: rename exported class, `Error -> RequestError`
- BREAKING: does not attempt to strip null/false values from JSON requests
- add `withCallback(Options, cb)`
- switch to a slightly more permissive license (yes, better than MIT even)
- no more warnings about npm version
- add flow type definition
- add typescript definition
## 2017-04-26 v1.1.0
- avoid retries on 502/504 status codes
## 2017-01-19 v1.0.0
- add `.withStream()`
- instead of providing only the response body, the `done` callback now provides headers too: `(err, {statusCode, headers, body}) => ...`
- `res = {headers, body, statusCode}` is now provided as the second argument even when there's an error, e.g. `honeybee({url}, (err, res) => ...)
- rejected Promises now have `headers` and `body` attached to the Error object when possible
