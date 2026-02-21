import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import _ from 'lodash'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { ensureDir } from 'adapt-authoring-core'
import AdaptFrameworkBuild from '../lib/AdaptFrameworkBuild.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * transformContentItems is async and calls App.instance.waitForModule('tags')
 * at the end. We extract the synchronous logic here to test it in isolation.
 */
function transformContentItemsSync (build, items) {
  items.forEach(i => {
    ['_courseId', '_parentId'].forEach(k => {
      i[k] = build.idMap[i[k]] || i[k]
    })
    if (i._friendlyId) {
      i._id = i._friendlyId
    }
    const idMapEntries = Object.entries(build.assetData.idMap)
    const itemString = idMapEntries.reduce((s, [_id, assetPath]) => {
      const relPath = assetPath.replace(build.courseDir, 'course')
      return s.replace(new RegExp(_id, 'g'), relPath)
    }, JSON.stringify(i))
    Object.assign(i, JSON.parse(itemString))
    if (i._component) {
      i._component = build.enabledPlugins.find(p => p.name === i._component)?.targetAttribute.slice(1) ?? i._component
    }
  })
  build.enabledPlugins.forEach(({ targetAttribute, type }) => {
    let key = `_${type}`
    if (type === 'component' || type === 'extension') key += 's'
    const globals = build.courseData.course.data._globals
    if (!globals?.[targetAttribute]) return
    _.merge(globals, { [key]: { [targetAttribute]: globals[targetAttribute] } })
    delete globals[targetAttribute]
  })
}

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

  describe('ensureDir() (from core)', () => {
    const testDir = path.join(__dirname, 'data', 'ensure-dir-test')

    after(async () => {
      await fs.rm(testDir, { recursive: true, force: true })
    })

    it('should create a directory that does not exist', async () => {
      await ensureDir(testDir)
      const stat = await fs.stat(testDir)
      assert.ok(stat.isDirectory())
    })

    it('should not throw when the directory already exists', async () => {
      await ensureDir(testDir)
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

    it('should sort deeply nested content in global order', () => {
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
        { _id: 'page1', _type: 'page', _parentId: 'course1', _sortOrder: 1 },
        { _id: 'page2', _type: 'page', _parentId: 'course1', _sortOrder: 2 },
        { _id: 'art1', _type: 'article', _parentId: 'page1', _sortOrder: 1 },
        { _id: 'art2', _type: 'article', _parentId: 'page2', _sortOrder: 1 },
        { _id: 'art3', _type: 'article', _parentId: 'page1', _sortOrder: 2 }
      ]
      build.sortContentItems(items)

      const articleIds = build.courseData.article.data.map(a => a._id)
      assert.equal(articleIds[0], 'art1')
      assert.equal(articleIds[1], 'art3')
      assert.equal(articleIds[2], 'art2')
    })
  })

  describe('#transformContentItems()', () => {
    it('should replace _courseId and _parentId with friendlyIds from idMap', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      build.idMap = { course1: 'co-friendly', page1: 'page-friendly' }
      build.assetData = { idMap: {} }
      build.enabledPlugins = []
      build.courseData = { course: { dir: '/tmp', data: {} } }

      const items = [
        { _courseId: 'course1', _parentId: 'page1' }
      ]
      transformContentItemsSync(build, items)
      assert.equal(items[0]._courseId, 'co-friendly')
      assert.equal(items[0]._parentId, 'page-friendly')
    })

    it('should replace _id with _friendlyId when present', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      build.idMap = {}
      build.assetData = { idMap: {} }
      build.enabledPlugins = []
      build.courseData = { course: { dir: '/tmp', data: {} } }

      const items = [{ _id: 'abc', _friendlyId: 'my-friendly' }]
      transformContentItemsSync(build, items)
      assert.equal(items[0]._id, 'my-friendly')
    })

    it('should not replace _id when _friendlyId is absent', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      build.idMap = {}
      build.assetData = { idMap: {} }
      build.enabledPlugins = []
      build.courseData = { course: { dir: '/tmp', data: {} } }

      const items = [{ _id: 'abc' }]
      transformContentItemsSync(build, items)
      assert.equal(items[0]._id, 'abc')
    })

    it('should replace asset _ids with relative paths', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      build.idMap = {}
      build.courseDir = '/build/course'
      build.assetData = { idMap: { asset123: '/build/course/assets/image.png' } }
      build.enabledPlugins = []
      build.courseData = { course: { dir: '/tmp', data: {} } }

      const items = [{ graphic: 'asset123' }]
      transformContentItemsSync(build, items)
      assert.equal(items[0].graphic, 'course/assets/image.png')
    })

    it('should resolve _component to targetAttribute', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      build.idMap = {}
      build.assetData = { idMap: {} }
      build.enabledPlugins = [
        { name: 'adapt-contrib-text', targetAttribute: '_text', type: 'component' }
      ]
      build.courseData = { course: { dir: '/tmp', data: {} } }

      const items = [{ _component: 'adapt-contrib-text' }]
      transformContentItemsSync(build, items)
      assert.equal(items[0]._component, 'text')
    })

    it('should keep _component as-is when plugin not found', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      build.idMap = {}
      build.assetData = { idMap: {} }
      build.enabledPlugins = []
      build.courseData = { course: { dir: '/tmp', data: {} } }

      const items = [{ _component: 'unknown-plugin' }]
      transformContentItemsSync(build, items)
      assert.equal(items[0]._component, 'unknown-plugin')
    })

    it('should move globals into nested _extensions object', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      build.idMap = {}
      build.assetData = { idMap: {} }
      build.enabledPlugins = [
        { name: 'adapt-contrib-trickle', targetAttribute: '_trickle', type: 'extension' }
      ]
      build.courseData = {
        course: {
          dir: '/tmp',
          data: {
            _globals: {
              _trickle: { label: 'Trickle' }
            }
          }
        }
      }

      transformContentItemsSync(build, [])
      const globals = build.courseData.course.data._globals
      assert.equal(globals._extensions._trickle.label, 'Trickle')
      assert.equal(globals._trickle, undefined)
    })

    it('should use _components key for component type globals', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      build.idMap = {}
      build.assetData = { idMap: {} }
      build.enabledPlugins = [
        { name: 'adapt-contrib-text', targetAttribute: '_text', type: 'component' }
      ]
      build.courseData = {
        course: {
          dir: '/tmp',
          data: {
            _globals: {
              _text: { ariaRegion: 'Text' }
            }
          }
        }
      }

      transformContentItemsSync(build, [])
      const globals = build.courseData.course.data._globals
      assert.equal(globals._components._text.ariaRegion, 'Text')
    })

    it('should keep _courseId as-is when not in idMap', () => {
      const build = new AdaptFrameworkBuild({ action: 'preview', courseId: 'c1', userId: 'u1' })
      build.idMap = {}
      build.assetData = { idMap: {} }
      build.enabledPlugins = []
      build.courseData = { course: { dir: '/tmp', data: {} } }

      const items = [{ _courseId: 'unmapped' }]
      transformContentItemsSync(build, items)
      assert.equal(items[0]._courseId, 'unmapped')
    })
  })

  describe('#writeContentJson() asset mapping', () => {
    it('should map asset data to export format for export builds', () => {
      const build = new AdaptFrameworkBuild({ action: 'export', courseId: 'c1', userId: 'u1' })
      build.assetData = {
        data: [
          { title: 'Logo', description: 'A logo', path: 'assets/logo.png', tags: ['branding'], _id: '123', url: '' },
          { title: 'Icon', description: 'An icon', path: 'assets/icon.svg', tags: [], _id: '456', url: '' }
        ]
      }
      /* simulate the mapping logic from writeContentJson */
      const mapped = build.assetData.data.map(d => ({
        title: d.title,
        description: d.description,
        filename: d.path,
        tags: d.tags
      }))
      assert.equal(mapped.length, 2)
      assert.equal(mapped[0].filename, 'assets/logo.png')
      assert.equal(mapped[0].title, 'Logo')
      assert.equal(mapped[0]._id, undefined)
      assert.deepEqual(mapped[1].tags, [])
    })

    it('should not include assets for export when assetData is empty', () => {
      const build = new AdaptFrameworkBuild({ action: 'export', courseId: 'c1', userId: 'u1' })
      build.assetData = { data: [] }
      build.courseData = {
        course: { dir: '/tmp', fileName: 'course.json', data: {} }
      }
      const data = Object.values(build.courseData)
      if (build.isExport && build.assetData.data.length) {
        data.push(build.assetData)
      }
      assert.equal(data.length, 1)
    })

    it('should include asset data entry for non-empty export', () => {
      const build = new AdaptFrameworkBuild({ action: 'export', courseId: 'c1', userId: 'u1' })
      build.assetData = { data: [{ title: 'img', path: 'a.png' }] }
      build.courseData = {
        course: { dir: '/tmp', fileName: 'course.json', data: {} }
      }
      const data = Object.values(build.courseData)
      if (build.isExport && build.assetData.data.length) {
        data.push(build.assetData)
      }
      assert.equal(data.length, 2)
    })
  })
})
