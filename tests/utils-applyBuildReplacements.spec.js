import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { applyBuildReplacements } from '../lib/utils/applyBuildReplacements.js'

describe('applyBuildReplacements()', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aat-replace-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('should replace all @@placeholders in index.html', async () => {
    const template = [
      '<html lang="@@config._defaultLanguage" dir="@@config._defaultDirection">',
      '<meta name="build.type" content="@@build.type">',
      '<meta name="build.timestamp" content="@@build.timestamp">'
    ].join('\n')
    await fs.writeFile(path.join(tmpDir, 'index.html'), template)

    await applyBuildReplacements(tmpDir, {
      defaultLanguage: 'fr',
      defaultDirection: 'rtl',
      buildType: 'development',
      timestamp: 1234567890
    })

    const result = await fs.readFile(path.join(tmpDir, 'index.html'), 'utf8')
    assert.ok(result.includes('lang="fr"'))
    assert.ok(result.includes('dir="rtl"'))
    assert.ok(result.includes('content="development"'))
    assert.ok(result.includes('content="1234567890"'))
    assert.ok(!result.includes('@@'))
  })

  it('should handle multiple occurrences of the same placeholder', async () => {
    const template = '@@config._defaultLanguage @@config._defaultLanguage'
    await fs.writeFile(path.join(tmpDir, 'index.html'), template)

    await applyBuildReplacements(tmpDir, {
      defaultLanguage: 'de',
      defaultDirection: 'ltr',
      buildType: 'production',
      timestamp: 0
    })

    const result = await fs.readFile(path.join(tmpDir, 'index.html'), 'utf8')
    assert.equal(result, 'de de')
  })
})
