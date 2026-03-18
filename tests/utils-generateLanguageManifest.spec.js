import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { generateLanguageManifest } from '../lib/utils/generateLanguageManifest.js'

describe('generateLanguageManifest()', () => {
  it('should return all filenames except the manifest and assets.json', () => {
    const input = ['course.json', 'contentObjects.json', 'articles.json', 'language_data_manifest.js', 'assets.json']
    const result = generateLanguageManifest(input)
    assert.deepEqual(result, ['course.json', 'contentObjects.json', 'articles.json'])
  })

  it('should return an empty array when only excluded files are present', () => {
    const result = generateLanguageManifest(['language_data_manifest.js', 'assets.json'])
    assert.deepEqual(result, [])
  })

  it('should return all filenames when no exclusions apply', () => {
    const input = ['course.json', 'blocks.json']
    const result = generateLanguageManifest(input)
    assert.deepEqual(result, ['course.json', 'blocks.json'])
  })

  it('should handle an empty input array', () => {
    assert.deepEqual(generateLanguageManifest([]), [])
  })
})
