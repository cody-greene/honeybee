# honeybee change log
## 2017-04-26 v1.1.0
- avoid retries on 502/504 status codes
## 2017-01-19 v1.0.0
- add `.withStream()`
- instead of providing only the response body, the `done` callback now provides headers too: `(err, {statusCode, headers, body}) => ...`
- `res = {headers, body, statusCode}` is now provided as the second argument even when there's an error, e.g. `honeybee({url}, (err, res) => ...)
- rejected Promises now have `headers` and `body` attached to the Error object when possible
