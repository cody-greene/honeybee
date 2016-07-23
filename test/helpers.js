'use strict'
const util = require('../lib/helpers')
const assert = require('assert')

describe('helpers.stringifyQuery', function () {
  it('supports primitive types', function () {
    let actual = util.stringifyQuery({type: 'apples', count: 420, bbq: true, veggies: false})
    // note how veggies is omitted entirely
    assert.equal(actual, 'type=apples&count=420&bbq=true')
  })
  it('supports top-level arrays', function () {
    let actual = util.stringifyQuery({foo: ['x'], bar: ['y', 'z']})
    assert.equal(actual, 'foo=x&bar=y&bar=z')
  })
})

describe('helpers.merge', function () {
  it('joins multiple sets', function () {
    let actual = util.merge({foo: true}, {bar: true}, {baz: true})
    assert.deepEqual(actual, {
      foo: true,
      bar: true,
      baz: true
    })
  })
})

describe('helpers.mergeHeaders', function () {
  it('returns lowercase headers names', function () {
    let actual = util.mergeHeaders({}, {
      'x-my-hEaDeR': true,
      'Accept': true,
      'content-type': true
    })
    assert.deepEqual(actual, {
      'x-my-header': true,
      'accept': true,
      'content-type': true
    })
  })
})

describe('helpers.once', function () {
  it('ensures a callback just runs once', function () {
    let attempts = 0
    let fn = util.once(() => attempts++)
    fn(); fn()
    assert.equal(attempts, 1)
  })
})
