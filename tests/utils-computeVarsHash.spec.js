import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson, computeVarsHash } from '../lib/utils/computeVarsHash.js'

describe('canonicalJson()', () => {
  const cases = [
    { name: 'primitive string', input: 'abc', expected: '"abc"' },
    { name: 'primitive number', input: 42, expected: '42' },
    { name: 'primitive boolean', input: true, expected: 'true' },
    { name: 'null', input: null, expected: 'null' },
    { name: 'undefined coerces to null', input: undefined, expected: 'null' },
    { name: 'empty object', input: {}, expected: '{}' },
    { name: 'empty array', input: [], expected: '[]' },
    { name: 'array preserves order', input: [3, 1, 2], expected: '[3,1,2]' },
    { name: 'sorts top-level keys', input: { b: 1, a: 2 }, expected: '{"a":2,"b":1}' },
    { name: 'sorts nested keys', input: { x: { d: 1, c: 2 } }, expected: '{"x":{"c":2,"d":1}}' },
    { name: 'mixed nesting', input: { a: [{ z: 1, y: 2 }] }, expected: '{"a":[{"y":2,"z":1}]}' }
  ]
  for (const { name, input, expected } of cases) {
    it(name, () => assert.equal(canonicalJson(input), expected))
  }

  it('produces identical output for objects with different key insertion order', () => {
    const a = { _colors: { primary: 'red', secondary: 'blue' }, _font: { family: 'serif' } }
    const b = { _font: { family: 'serif' }, _colors: { secondary: 'blue', primary: 'red' } }
    assert.equal(canonicalJson(a), canonicalJson(b))
  })
})

describe('computeVarsHash()', () => {
  it('returns a 12-character hex string', () => {
    assert.match(computeVarsHash({ themeVariables: { a: 1 } }), /^[0-9a-f]{12}$/)
  })

  it('is deterministic for identical inputs', () => {
    const data = { themeVariables: { _colors: { primary: 'green' } }, customStyle: '.foo { color: red; }' }
    assert.equal(computeVarsHash(data), computeVarsHash(data))
  })

  it('treats missing, undefined, null, and empty equivalently', () => {
    const empty = computeVarsHash()
    assert.equal(computeVarsHash({}), empty)
    assert.equal(computeVarsHash({ themeVariables: null, customStyle: null }), empty)
    assert.equal(computeVarsHash({ themeVariables: undefined, customStyle: undefined }), empty)
  })

  it('is insensitive to key order within themeVariables', () => {
    const a = computeVarsHash({ themeVariables: { _colors: { primary: 'red', secondary: 'blue' } } })
    const b = computeVarsHash({ themeVariables: { _colors: { secondary: 'blue', primary: 'red' } } })
    assert.equal(a, b)
  })

  it('differs when themeVariables differ', () => {
    const a = computeVarsHash({ themeVariables: { _colors: { primary: 'red' } } })
    const b = computeVarsHash({ themeVariables: { _colors: { primary: 'green' } } })
    assert.notEqual(a, b)
  })

  it('differs when customStyle differs', () => {
    const a = computeVarsHash({ customStyle: '.foo { color: red; }' })
    const b = computeVarsHash({ customStyle: '.foo { color: green; }' })
    assert.notEqual(a, b)
  })

  it('is sensitive to array order (font import precedence)', () => {
    const a = computeVarsHash({ themeVariables: { _font: { _externalFonts: ['a.css', 'b.css'] } } })
    const b = computeVarsHash({ themeVariables: { _font: { _externalFonts: ['b.css', 'a.css'] } } })
    assert.notEqual(a, b)
  })
})
