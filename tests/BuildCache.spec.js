import { before, describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import upath from 'upath'
import os from 'node:os'

describe('BuildCache', () => {
  let BuildCache
  let tmpDir, cacheRoot, buildDir, cache

  before(async () => {
    mock.module('../lib/utils/log.js', {
      namedExports: {
        log: () => {},
        logDir: () => {},
        logMemory: () => {}
      }
    })
    ;({ default: BuildCache } = await import('../lib/BuildCache.js'))
  })

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aat-cache-test-'))
    cacheRoot = path.join(tmpDir, 'prebuilt-cache')
    buildDir = path.join(tmpDir, 'build')
    await fs.mkdir(buildDir, { recursive: true })
    cache = new BuildCache(cacheRoot)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe('getPath()', () => {
    it('returns one combo-keyed directory path', () => {
      assert.equal(cache.getPath('abc123', 'vanilla', 'boxMenu'), upath.join(cacheRoot, 'abc123_vanilla_boxMenu'))
    })
  })

  describe('has()', () => {
    it('returns false when cache does not exist', async () => {
      assert.equal(await cache.has('hash1', 'theme', 'menu'), false)
    })

    it('returns true when the combo dir exists', async () => {
      await fs.mkdir(cache.getPath('hash1', 'theme', 'menu'), { recursive: true })
      assert.equal(await cache.has('hash1', 'theme', 'menu'), true)
    })
  })

  describe('populate()', () => {
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

      await cache.populate(buildDir, 'hash1', 'theme', 'menu')

      const cacheDir = cache.getPath('hash1', 'theme', 'menu')
      assert.equal(await fs.readFile(path.join(cacheDir, 'adapt', 'js', 'adapt.min.js'), 'utf8'), 'js-content')
      assert.equal(await fs.readFile(path.join(cacheDir, 'index.html'), 'utf8'), '<html></html>')
      assert.equal(await fs.readFile(path.join(cacheDir, 'adapt.css'), 'utf8'), 'css-content')
      assert.equal(await fs.readFile(path.join(cacheDir, 'fonts', 'icon.woff2'), 'utf8'), 'font-data')
      await assert.rejects(fs.access(path.join(cacheDir, 'course')), { code: 'ENOENT' })
    })
  })

  describe('restore()', () => {
    it('copies cached artifacts to destination', async () => {
      const cacheDir = cache.getPath('hash1', 'theme', 'menu')
      await fs.mkdir(path.join(cacheDir, 'adapt', 'js'), { recursive: true })
      await fs.writeFile(path.join(cacheDir, 'adapt', 'js', 'adapt.min.js'), 'cached-js')
      await fs.writeFile(path.join(cacheDir, 'adapt.css'), 'cached-css')

      const destDir = path.join(tmpDir, 'restored')
      await cache.restore('hash1', 'theme', 'menu', destDir)

      assert.equal(await fs.readFile(path.join(destDir, 'adapt', 'js', 'adapt.min.js'), 'utf8'), 'cached-js')
      assert.equal(await fs.readFile(path.join(destDir, 'adapt.css'), 'utf8'), 'cached-css')
    })
  })

  describe('invalidate()', () => {
    it('removes the cache directory', async () => {
      await fs.mkdir(cacheRoot, { recursive: true })
      await fs.writeFile(path.join(cacheRoot, 'test'), 'data')
      await cache.invalidate()
      await assert.rejects(fs.access(cacheRoot), { code: 'ENOENT' })
    })

    it('does not throw when cache does not exist', async () => {
      const missing = new BuildCache(path.join(tmpDir, 'nonexistent'))
      await assert.doesNotReject(missing.invalidate())
    })
  })
})
