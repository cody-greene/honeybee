/* eslint-env mocha, node, es6 */
'use strict'
const assert = require('assert')
const request = require('../lib/browser')
const server = require('./mock/xhr')
const commonTests = require('./common')

describe('browser (common)', () => commonTests(server, request))

describe('browser (unique)', function () {
  it.skip('captures network errors')

  it.skip('supports progress events')
})
