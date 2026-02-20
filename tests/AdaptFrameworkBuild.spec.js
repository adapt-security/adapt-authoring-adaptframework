import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import AdaptFrameworkBuild from '../lib/AdaptFrameworkBuild.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('AdaptFrameworkBuild', () => {
  describe('constructor', () => {
    it('should set action and related boolean flags for preview', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      assert.equal(build.action, 'preview')
      assert.equal(build.isPreview, true)
      assert.equal(build.isPublish, false)
      assert.equal(build.isExport, false)
    })

    it('should set action and related boolean flags for publish', () => {
      const build = new AdaptFrameworkBuild({ action: 'publish', courseId: 'c1', userId: 'u1' })
      assert.equal(build.isPreview, false)
      assert.equal(build.isPublish, true)
      assert.equal(build.isExport, false)
    })

    it('should set action and related boolean flags for export', () => {
      const build = new AdaptFrameworkBuild({ action: 'export', courseId: 'c1', userId: 'u1' })
      assert.equal(build.isPreview, false)
      assert.equal(build.isPublish, false)
      assert.equal(build.isExport, true)
    })

    it('should default compress to false for preview', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      assert.equal(build.compress, false)
    })

    it('should default compress to true for publish', () => {
      const build = new AdaptFrameworkBuild({ action: 'publish', courseId: 'c1', userId: 'u1' })
      assert.equal(build.compress, true)
    })

    it('should default compress to true for export', () => {
      const build = new AdaptFrameworkBuild({ action: 'export', courseId: 'c1', userId: 'u1' })
      assert.equal(build.compress, true)
    })

    it('should allow overriding compress', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1', compress: true })
      assert.equal(build.compress, true)
    })

    it('should set courseId and userId', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'course123', userId: 'user456' })
      assert.equal(build.courseId, 'course123')
      assert.equal(build.userId, 'user456')
    })

    it('should set expiresAt when provided', () => {
      const expires = '2025-01-01T00:00:00.000Z'
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1', expiresAt: expires })
      assert.equal(build.expiresAt, expires)
    })

    it('should initialise courseData as empty object', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      assert.deepEqual(build.courseData, {})
    })

    it('should initialise enabledPlugins and disabledPlugins as empty arrays', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      assert.deepEqual(build.enabledPlugins, [])
      assert.deepEqual(build.disabledPlugins, [])
    })

    it('should set collectionName to "adaptbuilds"', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      assert.equal(build.collectionName, 'adaptbuilds')
    })
  })

  describe('#ensureDir()', () => {
    const testDir = path.join(__dirname, 'data', 'ensure-dir-test')
    let build

    before(() => {
      build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
    })

    after(async () => {
      await fs.rm(testDir, { recursive: true, force: true })
    })

    it('should create a directory that does not exist', async () => {
      await build.ensureDir(testDir)
      const stat = await fs.stat(testDir)
      assert.ok(stat.isDirectory())
    })

    it('should not throw when the directory already exists', async () => {
      await build.ensureDir(testDir)
      const stat = await fs.stat(testDir)
      assert.ok(stat.isDirectory())
    })
  })

  describe('#createIdMap()', () => {
    it('should create a mapping of _id to _friendlyId', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      const items = [
        { _id: 'abc', _friendlyId: 'friendly-abc' },
        { _id: 'def', _friendlyId: 'friendly-def' }
      ]
      build.createIdMap(items)
      assert.deepEqual(build.idMap, {
        abc: 'friendly-abc',
        def: 'friendly-def'
      })
    })

    it('should handle items without _friendlyId', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      const items = [{ _id: 'abc' }]
      build.createIdMap(items)
      assert.equal(build.idMap.abc, undefined)
    })
  })

  describe('#sortContentItems()', () => {
    it('should sort content into correct types', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      build.courseData = {
        course: { dir: '/tmp', fileName: 'course.json', data: undefined },
        config: { dir: '/tmp', fileName: 'config.json', data: undefined },
        contentObject: { dir: '/tmp', fileName: 'contentObjects.json', data: [] },
        article: { dir: '/tmp', fileName: 'articles.json', data: [] },
        block: { dir: '/tmp', fileName: 'blocks.json', data: [] },
        component: { dir: '/tmp', fileName: 'components.json', data: [] }
      }
      const items = [
        { _id: 'course1', _type: 'course' },
        { _id: 'config1', _type: 'config' },
        { _id: 'page1', _type: 'page', _parentId: 'course1', _sortOrder: 1 },
        { _id: 'article1', _type: 'article', _parentId: 'page1', _sortOrder: 1 },
        { _id: 'block1', _type: 'block', _parentId: 'article1', _sortOrder: 1 },
        { _id: 'comp1', _type: 'component', _parentId: 'block1', _sortOrder: 1 }
      ]
      build.sortContentItems(items)

      assert.equal(build.courseData.course.data._id, 'course1')
      assert.equal(build.courseData.config.data._id, 'config1')
      assert.equal(build.courseData.contentObject.data.length, 1)
      assert.equal(build.courseData.article.data.length, 1)
      assert.equal(build.courseData.block.data.length, 1)
      assert.equal(build.courseData.component.data.length, 1)
    })

    it('should sort siblings by _sortOrder', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      build.courseData = {
        course: { dir: '/tmp', fileName: 'course.json', data: undefined },
        config: { dir: '/tmp', fileName: 'config.json', data: undefined },
        contentObject: { dir: '/tmp', fileName: 'contentObjects.json', data: [] },
        article: { dir: '/tmp', fileName: 'articles.json', data: [] },
        block: { dir: '/tmp', fileName: 'blocks.json', data: [] },
        component: { dir: '/tmp', fileName: 'components.json', data: [] }
      }
      const items = [
        { _id: 'course1', _type: 'course' },
        { _id: 'page2', _type: 'page', _parentId: 'course1', _sortOrder: 2 },
        { _id: 'page1', _type: 'page', _parentId: 'course1', _sortOrder: 1 },
        { _id: 'page3', _type: 'page', _parentId: 'course1', _sortOrder: 3 }
      ]
      build.sortContentItems(items)

      assert.equal(build.courseData.contentObject.data[0]._id, 'page1')
      assert.equal(build.courseData.contentObject.data[1]._id, 'page2')
      assert.equal(build.courseData.contentObject.data[2]._id, 'page3')
    })

    it('should categorise "menu" type as contentObject', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      build.courseData = {
        course: { dir: '/tmp', fileName: 'course.json', data: undefined },
        config: { dir: '/tmp', fileName: 'config.json', data: undefined },
        contentObject: { dir: '/tmp', fileName: 'contentObjects.json', data: [] },
        article: { dir: '/tmp', fileName: 'articles.json', data: [] },
        block: { dir: '/tmp', fileName: 'blocks.json', data: [] },
        component: { dir: '/tmp', fileName: 'components.json', data: [] }
      }
      const items = [
        { _id: 'course1', _type: 'course' },
        { _id: 'menu1', _type: 'menu', _parentId: 'course1', _sortOrder: 1 }
      ]
      build.sortContentItems(items)

      assert.equal(build.courseData.contentObject.data.length, 1)
      assert.equal(build.courseData.contentObject.data[0]._id, 'menu1')
    })
  })
})
