import { before, describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import upath from 'upath'
import os from 'node:os'

describe('prebuiltCache', () => {
  let getCachePath, hasCachedBuild, populateCache, restoreFromCache, invalidateCache
  let tmpDir, cacheRoot, buildDir

  before(async () => {
    mock.module('../lib/utils/log.js', {
      namedExports: {
        log: () => {},
        logDir: () => {},
        logMemory: () => {}
      }
    })
    ;({ getCachePath, hasCachedBuild, populateCache, restoreFromCache, invalidateCache } = await import('../lib/utils/prebuiltCache.js'))
  })

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aat-cache-test-'))
    cacheRoot = path.join(tmpDir, 'prebuilt-cache')
    buildDir = path.join(tmpDir, 'build')
    await fs.mkdir(buildDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe('getCachePath()', () => {
    it('returns one combo-keyed directory path', () => {
      const result = getCachePath('/cache', 'abc123', 'vanilla', 'boxMenu')
      assert.equal(result, upath.join('/cache', 'abc123_vanilla_boxMenu'))
    })
  })

  describe('hasCachedBuild()', () => {
    it('returns false when cache does not exist', async () => {
      assert.equal(await hasCachedBuild(cacheRoot, 'hash1', 'theme', 'menu'), false)
    })

    it('returns true when the combo dir exists', async () => {
      await fs.mkdir(getCachePath(cacheRoot, 'hash1', 'theme', 'menu'), { recursive: true })
      assert.equal(await hasCachedBuild(cacheRoot, 'hash1', 'theme', 'menu'), true)
    })
  })

  describe('populateCache()', () => {
    it('caches all build entries except course/', async () => {
      await fs.mkdir(path.join(buildDir, 'adapt', 'js'), { recursive: true })
      await fs.writeFile(path.join(buildDir, 'adapt', 'js', 'adapt.min.js'), 'js-content')
      await fs.writeFile(path.join(buildDir, 'adapt.css'), 'css-content')
      await fs.writeFile(path.join(buildDir, 'adapt.css.map'), 'map-content')
      await fs.mkdir(path.join(buildDir, 'fonts'), { recursive: true })
      await fs.writeFile(path.join(buildDir, 'fonts', 'icon.woff2'), 'font-data')
      await fs.writeFile(path.join(buildDir, 'index.html'), '<html></html>')
      await fs.writeFile(path.join(buildDir, 'templates.js'), 'templates')
      await fs.mkdir(path.join(buildDir, 'libraries'), { recursive: true })
      await fs.writeFile(path.join(buildDir, 'libraries', 'modernizr.js'), 'lib')
      // course/ should be skipped
      await fs.mkdir(path.join(buildDir, 'course', 'en'), { recursive: true })
      await fs.writeFile(path.join(buildDir, 'course', 'en', 'course.json'), '{}')

      await populateCache(buildDir, cacheRoot, 'hash1', 'theme', 'menu')

      const cacheDir = getCachePath(cacheRoot, 'hash1', 'theme', 'menu')
      assert.equal(await fs.readFile(path.join(cacheDir, 'adapt', 'js', 'adapt.min.js'), 'utf8'), 'js-content')
      assert.equal(await fs.readFile(path.join(cacheDir, 'index.html'), 'utf8'), '<html></html>')
      assert.equal(await fs.readFile(path.join(cacheDir, 'adapt.css'), 'utf8'), 'css-content')
      assert.equal(await fs.readFile(path.join(cacheDir, 'fonts', 'icon.woff2'), 'utf8'), 'font-data')
      await assert.rejects(fs.access(path.join(cacheDir, 'course')), { code: 'ENOENT' })
    })
  })

  describe('restoreFromCache()', () => {
    it('copies cached artifacts to destination', async () => {
      const cacheDir = getCachePath(cacheRoot, 'hash1', 'theme', 'menu')
      await fs.mkdir(path.join(cacheDir, 'adapt', 'js'), { recursive: true })
      await fs.writeFile(path.join(cacheDir, 'adapt', 'js', 'adapt.min.js'), 'cached-js')
      await fs.writeFile(path.join(cacheDir, 'adapt.css'), 'cached-css')

      const destDir = path.join(tmpDir, 'restored')
      await restoreFromCache(cacheRoot, 'hash1', 'theme', 'menu', destDir)

      assert.equal(await fs.readFile(path.join(destDir, 'adapt', 'js', 'adapt.min.js'), 'utf8'), 'cached-js')
      assert.equal(await fs.readFile(path.join(destDir, 'adapt.css'), 'utf8'), 'cached-css')
    })
  })

  describe('invalidateCache()', () => {
    it('removes the cache directory', async () => {
      await fs.mkdir(cacheRoot, { recursive: true })
      await fs.writeFile(path.join(cacheRoot, 'test'), 'data')
      await invalidateCache(cacheRoot)
      await assert.rejects(fs.access(cacheRoot), { code: 'ENOENT' })
    })

    it('does not throw when cache does not exist', async () => {
      await assert.doesNotReject(invalidateCache(path.join(tmpDir, 'nonexistent')))
    })
  })
})
