/**
 * Fast alternative to cloneDeep, only for strict JSON objects
 * @param {object} src
 * @return {object}
 */
function cloneJSON(src){ return JSON.parse(JSON.stringify(src)) }

/** WARNING: falsy array elements will be converted to null */
function mostlyTruthy(_, val){ if (val || val === 0) return val }

/**
 * @param {array} haystack
 * @param {any} needle
 * @return {boolean}
 */
function contains(haystack, needle){ return haystack.indexOf(needle) !== -1 }

/**
 * v8 will deoptimize blocks containing try-catch
 * Use this helper to avoid deopts on larger funcs
 */
function parseJSON(str) {
  try { return JSON.parse(str) }
  catch (x){ return null }
}

/**
 * Use this wrapper to omit useless (falsy) values, greatly reducing size.
 */
function toJSON(obj) {
  return obj ? JSON.stringify(obj, mostlyTruthy) : null
}

/**
 * @param {Buffer) buf
 * @returns {string} Url-safe base64 encoding
 */
function toSafe64(buf) {
  return buf.toString('base64')
    .replace(/\//g, '_')
    .replace(/\+/g, '-')
    .replace(/=+$/, '')
}

module.exports = {
  cloneJSON,
  contains,
  mostlyTruthy,
  parseJSON,
  toJSON,
  toSafe64,
}
