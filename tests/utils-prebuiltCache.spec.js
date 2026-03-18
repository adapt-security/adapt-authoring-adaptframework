import { before, describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

describe('prebuiltCache', () => {
  let getCachePaths, hasCachedBuild, hasSharedCache, populateCache, populateSharedCacheOnly, restoreFromCache, invalidateCache
  let tmpDir, cacheRoot, buildDir

  before(async () => {
    // Mock the log utility to suppress output during tests
    mock.module('../lib/utils/log.js', {
      namedExports: {
        log: () => {},
        logDir: () => {},
        logMemory: () => {}
      }
    })
    ;({ getCachePaths, hasCachedBuild, hasSharedCache, populateCache, populateSharedCacheOnly, restoreFromCache, invalidateCache } = await import('../lib/utils/prebuiltCache.js'))
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

  describe('getCachePaths()', () => {
    it('should return correct shared and CSS directory paths', () => {
      const result = getCachePaths('/cache', 'abc123', 'vanilla', 'boxMenu')
      assert.equal(result.sharedDir, path.join('/cache', 'abc123'))
      assert.equal(result.cssDir, path.join('/cache', 'abc123_vanilla_boxMenu'))
    })
  })

  describe('hasCachedBuild()', () => {
    it('should return false when cache does not exist', async () => {
      assert.equal(await hasCachedBuild(cacheRoot, 'hash1', 'theme', 'menu'), false)
    })

    it('should return true when both shared and CSS dirs exist', async () => {
      const { sharedDir, cssDir } = getCachePaths(cacheRoot, 'hash1', 'theme', 'menu')
      await fs.mkdir(sharedDir, { recursive: true })
      await fs.mkdir(cssDir, { recursive: true })
      assert.equal(await hasCachedBuild(cacheRoot, 'hash1', 'theme', 'menu'), true)
    })

    it('should return false when only shared dir exists', async () => {
      const { sharedDir } = getCachePaths(cacheRoot, 'hash1', 'theme', 'menu')
      await fs.mkdir(sharedDir, { recursive: true })
      assert.equal(await hasCachedBuild(cacheRoot, 'hash1', 'theme', 'menu'), false)
    })
  })

  describe('populateCache()', () => {
    it('should cache all build entries except course/', async () => {
      // Create mock build output matching actual grunt structure
      await fs.mkdir(path.join(buildDir, 'adapt', 'js'), { recursive: true })
      await fs.writeFile(path.join(buildDir, 'adapt', 'js', 'adapt.min.js'), 'js-content')
      await fs.writeFile(path.join(buildDir, 'adapt.css'), 'css-content')
      await fs.writeFile(path.join(buildDir, 'adapt.css.map'), 'map-content')
      await fs.mkdir(path.join(buildDir, 'fonts'), { recursive: true })
      await fs.writeFile(path.join(buildDir, 'fonts', 'icon.woff2'), 'font-data')
      await fs.writeFile(path.join(buildDir, 'index.html'), '<html></html>')
      await fs.writeFile(path.join(buildDir, 'templates.js'), 'templates')
      await fs.mkdir(path.join(buildDir, 'assets'), { recursive: true })
      await fs.writeFile(path.join(buildDir, 'assets', 'logo.png'), 'img')
      await fs.mkdir(path.join(buildDir, 'libraries'), { recursive: true })
      await fs.writeFile(path.join(buildDir, 'libraries', 'modernizr.js'), 'lib')
      // Required files from plugins (e.g. spoortracking)
      await fs.writeFile(path.join(buildDir, 'connection.txt'), '')
      await fs.writeFile(path.join(buildDir, 'scorm_test_harness.html'), '<html></html>')
      // course/ should be skipped
      await fs.mkdir(path.join(buildDir, 'course', 'en'), { recursive: true })
      await fs.writeFile(path.join(buildDir, 'course', 'en', 'course.json'), '{}')

      await populateCache(buildDir, cacheRoot, 'hash1', 'theme', 'menu')

      const { sharedDir, cssDir } = getCachePaths(cacheRoot, 'hash1', 'theme', 'menu')

      // Shared artifacts
      const js = await fs.readFile(path.join(sharedDir, 'adapt', 'js', 'adapt.min.js'), 'utf8')
      assert.equal(js, 'js-content')
      const html = await fs.readFile(path.join(sharedDir, 'index.html'), 'utf8')
      assert.equal(html, '<html></html>')
      const conn = await fs.readFile(path.join(sharedDir, 'connection.txt'), 'utf8')
      assert.equal(conn, '')
      const harness = await fs.readFile(path.join(sharedDir, 'scorm_test_harness.html'), 'utf8')
      assert.equal(harness, '<html></html>')

      // CSS artifacts
      const css = await fs.readFile(path.join(cssDir, 'adapt.css'), 'utf8')
      assert.equal(css, 'css-content')
      const cssMap = await fs.readFile(path.join(cssDir, 'adapt.css.map'), 'utf8')
      assert.equal(cssMap, 'map-content')
      const font = await fs.readFile(path.join(cssDir, 'fonts', 'icon.woff2'), 'utf8')
      assert.equal(font, 'font-data')

      // course/ should NOT be cached
      await assert.rejects(fs.access(path.join(sharedDir, 'course')), { code: 'ENOENT' })
      await assert.rejects(fs.access(path.join(cssDir, 'course')), { code: 'ENOENT' })
    })
  })

  describe('restoreFromCache()', () => {
    it('should copy cached artifacts to destination', async () => {
      // Set up cache matching actual structure
      const { sharedDir, cssDir } = getCachePaths(cacheRoot, 'hash1', 'theme', 'menu')
      await fs.mkdir(path.join(sharedDir, 'adapt', 'js'), { recursive: true })
      await fs.writeFile(path.join(sharedDir, 'adapt', 'js', 'adapt.min.js'), 'cached-js')
      await fs.writeFile(path.join(sharedDir, 'index.html'), 'cached-html')
      await fs.writeFile(path.join(sharedDir, 'connection.txt'), '')
      await fs.mkdir(cssDir, { recursive: true })
      await fs.writeFile(path.join(cssDir, 'adapt.css'), 'cached-css')
      await fs.mkdir(path.join(cssDir, 'fonts'), { recursive: true })
      await fs.writeFile(path.join(cssDir, 'fonts', 'icon.woff2'), 'cached-font')

      const destDir = path.join(tmpDir, 'restored')
      await restoreFromCache(cacheRoot, 'hash1', 'theme', 'menu', destDir)

      const js = await fs.readFile(path.join(destDir, 'adapt', 'js', 'adapt.min.js'), 'utf8')
      assert.equal(js, 'cached-js')
      const css = await fs.readFile(path.join(destDir, 'adapt.css'), 'utf8')
      assert.equal(css, 'cached-css')
      const font = await fs.readFile(path.join(destDir, 'fonts', 'icon.woff2'), 'utf8')
      assert.equal(font, 'cached-font')
      const conn = await fs.readFile(path.join(destDir, 'connection.txt'), 'utf8')
      assert.equal(conn, '')
    })
  })

  describe('hasSharedCache()', () => {
    it('should return false when shared cache does not exist', async () => {
      assert.equal(await hasSharedCache(cacheRoot, 'hash1'), false)
    })

    it('should return true when shared cache exists', async () => {
      await fs.mkdir(path.join(cacheRoot, 'hash1'), { recursive: true })
      assert.equal(await hasSharedCache(cacheRoot, 'hash1'), true)
    })
  })

  describe('populateSharedCacheOnly()', () => {
    it('should cache only shared entries, skipping CSS and course', async () => {
      // Create mock build output
      await fs.mkdir(path.join(buildDir, 'adapt', 'js'), { recursive: true })
      await fs.writeFile(path.join(buildDir, 'adapt', 'js', 'adapt.min.js'), 'js')
      await fs.writeFile(path.join(buildDir, 'index.html'), 'html')
      await fs.writeFile(path.join(buildDir, 'connection.txt'), '')
      // CSS entries — should be excluded
      await fs.writeFile(path.join(buildDir, 'adapt.css'), 'css')
      await fs.mkdir(path.join(buildDir, 'fonts'), { recursive: true })
      await fs.writeFile(path.join(buildDir, 'fonts', 'icon.woff2'), 'font')
      // course/ — should be excluded
      await fs.mkdir(path.join(buildDir, 'course', 'en'), { recursive: true })
      await fs.writeFile(path.join(buildDir, 'course', 'en', 'course.json'), '{}')

      await populateSharedCacheOnly(buildDir, cacheRoot, 'hash1')

      const sharedDir = path.join(cacheRoot, 'hash1')
      // Shared entries present
      assert.equal(await fs.readFile(path.join(sharedDir, 'adapt', 'js', 'adapt.min.js'), 'utf8'), 'js')
      assert.equal(await fs.readFile(path.join(sharedDir, 'index.html'), 'utf8'), 'html')
      assert.equal(await fs.readFile(path.join(sharedDir, 'connection.txt'), 'utf8'), '')
      // CSS entries absent
      await assert.rejects(fs.access(path.join(sharedDir, 'adapt.css')), { code: 'ENOENT' })
      await assert.rejects(fs.access(path.join(sharedDir, 'fonts')), { code: 'ENOENT' })
      // course/ absent
      await assert.rejects(fs.access(path.join(sharedDir, 'course')), { code: 'ENOENT' })
    })
  })

  describe('invalidateCache()', () => {
    it('should remove the cache directory', async () => {
      await fs.mkdir(cacheRoot, { recursive: true })
      await fs.writeFile(path.join(cacheRoot, 'test'), 'data')
      await invalidateCache(cacheRoot)
      await assert.rejects(fs.access(cacheRoot), { code: 'ENOENT' })
    })

    it('should not throw when cache does not exist', async () => {
      await assert.doesNotReject(invalidateCache(path.join(tmpDir, 'nonexistent')))
    })
  })
})
