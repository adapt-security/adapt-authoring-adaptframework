import { before, describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

describe('prebuiltCache', () => {
  let getCachePaths, hasCachedBuild, populateCache, restoreFromCache, invalidateCache
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
    ;({ getCachePaths, hasCachedBuild, populateCache, restoreFromCache, invalidateCache } = await import('../lib/utils/prebuiltCache.js'))
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
    it('should copy shared and CSS artifacts to cache', async () => {
      // Create mock build output
      await fs.mkdir(path.join(buildDir, 'adapt', 'js'), { recursive: true })
      await fs.writeFile(path.join(buildDir, 'adapt', 'js', 'adapt.min.js'), 'js-content')
      await fs.mkdir(path.join(buildDir, 'adapt', 'css'), { recursive: true })
      await fs.writeFile(path.join(buildDir, 'adapt', 'css', 'adapt.css'), 'css-content')
      await fs.writeFile(path.join(buildDir, 'index.html'), '<html>@@config._defaultLanguage</html>')

      await populateCache(buildDir, cacheRoot, 'hash1', 'theme', 'menu')

      const { sharedDir, cssDir } = getCachePaths(cacheRoot, 'hash1', 'theme', 'menu')
      const js = await fs.readFile(path.join(sharedDir, 'adapt', 'js', 'adapt.min.js'), 'utf8')
      assert.equal(js, 'js-content')
      const css = await fs.readFile(path.join(cssDir, 'adapt', 'css', 'adapt.css'), 'utf8')
      assert.equal(css, 'css-content')
      const html = await fs.readFile(path.join(sharedDir, 'index.html'), 'utf8')
      assert.ok(html.includes('@@config._defaultLanguage'))
    })
  })

  describe('restoreFromCache()', () => {
    it('should copy cached artifacts to destination', async () => {
      // Set up cache
      const { sharedDir, cssDir } = getCachePaths(cacheRoot, 'hash1', 'theme', 'menu')
      await fs.mkdir(path.join(sharedDir, 'adapt', 'js'), { recursive: true })
      await fs.writeFile(path.join(sharedDir, 'adapt', 'js', 'adapt.min.js'), 'cached-js')
      await fs.mkdir(path.join(cssDir, 'adapt', 'css'), { recursive: true })
      await fs.writeFile(path.join(cssDir, 'adapt', 'css', 'adapt.css'), 'cached-css')

      const destDir = path.join(tmpDir, 'restored')
      await restoreFromCache(cacheRoot, 'hash1', 'theme', 'menu', destDir)

      const js = await fs.readFile(path.join(destDir, 'adapt', 'js', 'adapt.min.js'), 'utf8')
      assert.equal(js, 'cached-js')
      const css = await fs.readFile(path.join(destDir, 'adapt', 'css', 'adapt.css'), 'utf8')
      assert.equal(css, 'cached-css')
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
