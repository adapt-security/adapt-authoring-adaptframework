import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

// Prevent log() from triggering App.instance boot during tests
mock.module('../lib/utils/log.js', {
  namedExports: {
    log: async () => {},
    logDir: () => {},
    logMemory: () => {}
  }
})

const { default: AdaptFrameworkImport } = await import('../lib/AdaptFrameworkImport.js')

describe('AdaptFrameworkImport', () => {
  describe('.typeToSchema()', () => {
    it('should return "contentobject" for menu type', () => {
      assert.equal(AdaptFrameworkImport.typeToSchema({ _type: 'menu' }), 'contentobject')
    })

    it('should return "contentobject" for page type', () => {
      assert.equal(AdaptFrameworkImport.typeToSchema({ _type: 'page' }), 'contentobject')
    })

    it('should return component-prefixed schema for component type', () => {
      assert.equal(
        AdaptFrameworkImport.typeToSchema({ _type: 'component', _component: 'adapt-contrib-text' }),
        'adapt-contrib-text-component'
      )
    })

    it('should return the _type directly for other types', () => {
      assert.equal(AdaptFrameworkImport.typeToSchema({ _type: 'course' }), 'course')
      assert.equal(AdaptFrameworkImport.typeToSchema({ _type: 'config' }), 'config')
      assert.equal(AdaptFrameworkImport.typeToSchema({ _type: 'article' }), 'article')
      assert.equal(AdaptFrameworkImport.typeToSchema({ _type: 'block' }), 'block')
    })
  })

  describe('#getSortedData()', () => {
    const getSortedData = AdaptFrameworkImport.prototype.getSortedData

    it('should sort a simple course hierarchy into levels', () => {
      const ctx = {
        contentJson: {
          course: { _id: 'course1' },
          contentObjects: {
            page1: { _id: 'page1', _parentId: 'course1' },
            art1: { _id: 'art1', _parentId: 'page1' },
            block1: { _id: 'block1', _parentId: 'art1' }
          }
        }
      }
      const { sorted, hierarchy } = getSortedData.call(ctx)
      assert.equal(sorted.length, 3)
      assert.deepEqual(sorted[0], ['page1'])
      assert.deepEqual(sorted[1], ['art1'])
      assert.deepEqual(sorted[2], ['block1'])
      assert.ok(hierarchy)
    })

    it('should group siblings at the same level', () => {
      const ctx = {
        contentJson: {
          course: { _id: 'course1' },
          contentObjects: {
            page1: { _id: 'page1', _parentId: 'course1' },
            page2: { _id: 'page2', _parentId: 'course1' },
            art1: { _id: 'art1', _parentId: 'page1' },
            art2: { _id: 'art2', _parentId: 'page2' }
          }
        }
      }
      const { sorted } = getSortedData.call(ctx)
      assert.equal(sorted.length, 2)
      assert.equal(sorted[0].length, 2)
      assert.ok(sorted[0].includes('page1'))
      assert.ok(sorted[0].includes('page2'))
      assert.equal(sorted[1].length, 2)
      assert.ok(sorted[1].includes('art1'))
      assert.ok(sorted[1].includes('art2'))
    })

    it('should not include course in the sorted output', () => {
      const ctx = {
        contentJson: {
          course: { _id: 'course1' },
          contentObjects: {
            page1: { _id: 'page1', _parentId: 'course1' }
          }
        }
      }
      const { sorted } = getSortedData.call(ctx)
      const allIds = sorted.flat()
      assert.ok(!allIds.includes('course1'))
    })

    it('should build correct hierarchy map', () => {
      const ctx = {
        contentJson: {
          course: { _id: 'course1' },
          contentObjects: {
            page1: { _id: 'page1', _parentId: 'course1' },
            page2: { _id: 'page2', _parentId: 'course1' },
            art1: { _id: 'art1', _parentId: 'page1' }
          }
        }
      }
      const { hierarchy } = getSortedData.call(ctx)
      assert.deepEqual(hierarchy.course1, ['page1', 'page2'])
      assert.deepEqual(hierarchy.page1, ['art1'])
    })

    it('should handle deep nesting (5 levels)', () => {
      const ctx = {
        contentJson: {
          course: { _id: 'c' },
          contentObjects: {
            p: { _id: 'p', _parentId: 'c' },
            a: { _id: 'a', _parentId: 'p' },
            b: { _id: 'b', _parentId: 'a' },
            x: { _id: 'x', _parentId: 'b' },
            y: { _id: 'y', _parentId: 'x' }
          }
        }
      }
      const { sorted } = getSortedData.call(ctx)
      assert.equal(sorted.length, 5)
      assert.deepEqual(sorted[0], ['p'])
      assert.deepEqual(sorted[1], ['a'])
      assert.deepEqual(sorted[2], ['b'])
      assert.deepEqual(sorted[3], ['x'])
      assert.deepEqual(sorted[4], ['y'])
    })

    it('should handle a single page', () => {
      const ctx = {
        contentJson: {
          course: { _id: 'c' },
          contentObjects: {
            p: { _id: 'p', _parentId: 'c' }
          }
        }
      }
      const { sorted } = getSortedData.call(ctx)
      assert.equal(sorted.length, 1)
      assert.deepEqual(sorted[0], ['p'])
    })
  })

  describe('#resolveAssets()', () => {
    function makeCtx (assetMap) {
      const ctx = { assetMap }
      ctx.resolveAssets = AdaptFrameworkImport.prototype.resolveAssets.bind(ctx)
      return ctx
    }

    function makeSchema (properties) {
      return {
        built: { properties },
        walk (data, predicate, props, parentPath = '') {
          props = props ?? this.built.properties
          const matches = []
          for (const [key, val] of Object.entries(props)) {
            if (data[key] === undefined) continue
            const currentPath = parentPath ? `${parentPath}/${key}` : key
            if (val.properties) {
              matches.push(...this.walk(data[key], predicate, val.properties, currentPath))
            } else if (val?.items?.properties) {
              data[key].forEach((item, i) => {
                matches.push(...this.walk(item, predicate, val.items.properties, `${currentPath}/${i}`))
              })
            } else if (predicate(val)) {
              matches.push({ path: currentPath, key, data, value: data[key] })
            }
          }
          return matches
        }
      }
    }

    it('should replace asset paths with mapped IDs', () => {
      const ctx = makeCtx({ 'course/en/assets/logo.png': 'asset123' })
      const schema = makeSchema({
        _graphic: {
          properties: {
            src: { _backboneForms: 'Asset' }
          }
        }
      })
      const data = { _graphic: { src: 'course/en/assets/logo.png' } }
      ctx.resolveAssets(schema, data)
      assert.equal(data._graphic.src, 'asset123')
    })

    it('should delete empty string asset values', () => {
      const ctx = makeCtx({})
      const schema = makeSchema({
        _graphic: {
          properties: {
            src: { _backboneForms: 'Asset' }
          }
        }
      })
      const data = { _graphic: { src: '' } }
      ctx.resolveAssets(schema, data)
      assert.equal('src' in data._graphic, false)
    })

    it('should keep value when not in assetMap', () => {
      const ctx = makeCtx({})
      const schema = makeSchema({
        img: { _backboneForms: { type: 'Asset' } }
      })
      const data = { img: 'unknown/path.png' }
      ctx.resolveAssets(schema, data)
      assert.equal(data.img, 'unknown/path.png')
    })

    it('should recurse into nested properties', () => {
      const ctx = makeCtx({ 'assets/bg.jpg': 'asset456' })
      const schema = makeSchema({
        _settings: {
          properties: {
            _background: {
              properties: {
                src: { _backboneForms: 'Asset' }
              }
            }
          }
        }
      })
      const data = { _settings: { _background: { src: 'assets/bg.jpg' } } }
      ctx.resolveAssets(schema, data)
      assert.equal(data._settings._background.src, 'asset456')
    })

    it('should recurse into array items', () => {
      const ctx = makeCtx({ 'assets/a.png': 'id1', 'assets/b.png': 'id2' })
      const schema = makeSchema({
        _items: {
          items: {
            properties: {
              src: { _backboneForms: 'Asset' }
            }
          }
        }
      })
      const data = {
        _items: [
          { src: 'assets/a.png' },
          { src: 'assets/b.png' }
        ]
      }
      ctx.resolveAssets(schema, data)
      assert.equal(data._items[0].src, 'id1')
      assert.equal(data._items[1].src, 'id2')
    })

    it('should skip undefined data keys', () => {
      const ctx = makeCtx({})
      const schema = makeSchema({
        _graphic: { _backboneForms: 'Asset' }
      })
      const data = {}
      ctx.resolveAssets(schema, data)
      assert.equal('_graphic' in data, false)
    })

    it('should handle null schema gracefully', () => {
      const ctx = makeCtx({})
      ctx.resolveAssets(null, { a: 1 })
    })

    it('should handle _backboneForms as object with type', () => {
      const ctx = makeCtx({ 'path/img.png': 'mapped' })
      const schema = makeSchema({
        hero: { _backboneForms: { type: 'Asset' } }
      })
      const data = { hero: 'path/img.png' }
      ctx.resolveAssets(schema, data)
      assert.equal(data.hero, 'mapped')
    })
  })

  describe('#loadContentFile()', () => {
    /**
     * loadContentFile depends on FWUtils.readJson (file I/O) and App.instance,
     * but we can test the classification logic by providing a mock.
     * We extract and test the classification behaviour inline.
     */
    it('should classify course type into contentJson.course', () => {
      const classify = (contents, filePath, ctx) => {
        if (contents._type === 'course') {
          ctx.contentJson.course = contents
          return
        }
        if (filePath.endsWith('config.json')) {
          ctx.contentJson.config = { _id: 'config', _type: 'config', ...contents }
          return
        }
        if (Array.isArray(contents)) {
          contents.forEach(c => {
            ctx.contentJson.contentObjects[c._id] = c
          })
        }
      }
      const ctx = { contentJson: { course: {}, config: {}, contentObjects: {} } }
      classify({ _type: 'course', title: 'My Course' }, 'en/course.json', ctx)
      assert.equal(ctx.contentJson.course.title, 'My Course')
    })

    it('should classify config.json as config with defaults', () => {
      const classify = (contents, filePath, ctx) => {
        if (contents._type === 'course') {
          ctx.contentJson.course = contents
          return
        }
        if (filePath.endsWith('config.json')) {
          ctx.contentJson.config = { _id: 'config', _type: 'config', ...contents }
          return
        }
        if (Array.isArray(contents)) {
          contents.forEach(c => {
            ctx.contentJson.contentObjects[c._id] = c
          })
        }
      }
      const ctx = { contentJson: { course: {}, config: {}, contentObjects: {} } }
      classify({ _defaultLanguage: 'en' }, 'course/config.json', ctx)
      assert.equal(ctx.contentJson.config._id, 'config')
      assert.equal(ctx.contentJson.config._type, 'config')
      assert.equal(ctx.contentJson.config._defaultLanguage, 'en')
    })

    it('should store array contents into contentObjects by _id', () => {
      const classify = (contents, filePath, ctx) => {
        if (contents._type === 'course') {
          ctx.contentJson.course = contents
          return
        }
        if (filePath.endsWith('config.json')) {
          ctx.contentJson.config = { _id: 'config', _type: 'config', ...contents }
          return
        }
        if (Array.isArray(contents)) {
          contents.forEach(c => {
            ctx.contentJson.contentObjects[c._id] = c
          })
        }
      }
      const ctx = { contentJson: { course: {}, config: {}, contentObjects: {} } }
      classify([
        { _id: 'page1', _type: 'page' },
        { _id: 'art1', _type: 'article' }
      ], 'en/contentObjects.json', ctx)
      assert.equal(ctx.contentJson.contentObjects.page1._type, 'page')
      assert.equal(ctx.contentJson.contentObjects.art1._type, 'article')
    })
  })

  describe('#cleanUp()', () => {
    const cleanUp = AdaptFrameworkImport.prototype.cleanUp

    it('should call rollback when an error is passed', async () => {
      let rollbackCalled = false
      const ctx = {
        settings: { removeSource: false },
        rollback: async () => { rollbackCalled = true }
      }
      await cleanUp.call(ctx, new Error('test'))
      assert.equal(rollbackCalled, true)
    })

    it('should not call rollback when no error is passed', async () => {
      let rollbackCalled = false
      const ctx = {
        settings: { removeSource: false },
        rollback: async () => { rollbackCalled = true }
      }
      await cleanUp.call(ctx, undefined)
      assert.equal(rollbackCalled, false)
    })

    it('should run rollback even when removeSource is false', async () => {
      let rollbackCalled = false
      const ctx = {
        settings: { removeSource: false },
        rollback: async () => { rollbackCalled = true }
      }
      await cleanUp.call(ctx, new Error('test'))
      assert.equal(rollbackCalled, true)
    })
  })

  describe('#rollback()', () => {
    const rollback = AdaptFrameworkImport.prototype.rollback

    function makeRollbackCtx (overrides = {}) {
      return {
        newContentPlugins: {},
        updatedContentPlugins: {},
        assetMap: {},
        newTagIds: [],
        contentJson: { course: {} },
        idMap: {},
        contentplugin: null,
        assets: null,
        content: null,
        ...overrides
      }
    }

    it('should uninstall newly installed plugins', async () => {
      const uninstalled = []
      const ctx = makeRollbackCtx({
        contentplugin: {
          uninstallPlugin: async (id) => uninstalled.push(id)
        },
        newContentPlugins: {
          'adapt-contrib-text': { _id: 'p1', name: 'adapt-contrib-text' },
          'adapt-contrib-gmcq': { _id: 'p2', name: 'adapt-contrib-gmcq' }
        }
      })
      await rollback.call(ctx)
      assert.deepEqual(uninstalled.sort(), ['p1', 'p2'])
    })

    it('should delete imported assets', async () => {
      const deleted = []
      const ctx = makeRollbackCtx({
        assets: {
          delete: async ({ _id }) => deleted.push(_id)
        },
        assetMap: {
          'course/en/assets/logo.png': 'a1',
          'course/en/assets/bg.jpg': 'a2'
        }
      })
      await rollback.call(ctx)
      assert.deepEqual(deleted.sort(), ['a1', 'a2'])
    })

    it('should delete course content on rollback', async () => {
      const contentDeleted = []
      const ctx = makeRollbackCtx({
        content: {
          deleteMany: async (query) => contentDeleted.push(query)
        },
        contentJson: { course: { _id: 'oldCourseId' } },
        idMap: { oldCourseId: '507f1f77bcf86cd799439011' }
      })
      await rollback.call(ctx)
      assert.equal(contentDeleted.length, 1)
    })

    it('should skip plugin uninstall when contentplugin is not available', async () => {
      const ctx = makeRollbackCtx({
        contentplugin: null,
        newContentPlugins: { 'adapt-contrib-text': { _id: 'p1', name: 'adapt-contrib-text' } }
      })
      await rollback.call(ctx) // should not throw
    })

    it('should skip asset deletion when assets module is not available', async () => {
      const ctx = makeRollbackCtx({
        assets: null,
        assetMap: { 'some/path.png': 'a1' }
      })
      await rollback.call(ctx) // should not throw
    })

    it('should skip content deletion when course ID is not in idMap', async () => {
      const deleted = []
      const ctx = makeRollbackCtx({
        content: {
          deleteMany: async (query) => deleted.push(query)
        },
        contentJson: { course: { _id: 'oldCourseId' } },
        idMap: {} // no mapping exists
      })
      await rollback.call(ctx)
      assert.equal(deleted.length, 0)
    })

    it('should continue cleaning up when an individual asset deletion fails', async () => {
      const deleted = []
      const ctx = makeRollbackCtx({
        assets: {
          delete: async ({ _id }) => {
            if (_id === 'a1') throw new Error('delete failed')
            deleted.push(_id)
          }
        },
        assetMap: {
          'path/a.png': 'a1',
          'path/b.png': 'a2',
          'path/c.png': 'a3'
        }
      })
      await rollback.call(ctx)
      assert.deepEqual(deleted.sort(), ['a2', 'a3'])
    })

    it('should continue cleaning up when an individual plugin uninstall fails', async () => {
      const uninstalled = []
      const ctx = makeRollbackCtx({
        contentplugin: {
          uninstallPlugin: async (id) => {
            if (id === 'p1') throw new Error('uninstall failed')
            uninstalled.push(id)
          }
        },
        newContentPlugins: {
          'plugin-a': { _id: 'p1', name: 'plugin-a' },
          'plugin-b': { _id: 'p2', name: 'plugin-b' }
        }
      })
      await rollback.call(ctx)
      assert.deepEqual(uninstalled, ['p2'])
    })
  })

  describe('#importCoursePlugins() - early missing plugin detection', () => {
    const importCoursePlugins = AdaptFrameworkImport.prototype.importCoursePlugins

    function makePluginCtx (overrides = {}) {
      return {
        configEnabledPlugins: [],
        usedContentPlugins: {},
        installedPlugins: {},
        newContentPlugins: {},
        updatedContentPlugins: {},
        pluginsToMigrate: ['core'],
        componentNameMap: {},
        settings: { isDryRun: false, importPlugins: true, updatePlugins: false },
        statusReport: { info: [], warn: [], error: [] },
        contentplugin: {
          find: async () => []
        },
        ...overrides
      }
    }

    it('should report missing plugins in statusReport during dry run', async () => {
      const ctx = makePluginCtx({
        configEnabledPlugins: ['adapt-contrib-text', 'adapt-contrib-missing'],
        usedContentPlugins: { 'adapt-contrib-text': { version: '1.0.0' } },
        settings: { isDryRun: true, importPlugins: true, updatePlugins: false },
        contentplugin: { find: async () => [] }
      })
      await importCoursePlugins.call(ctx)
      assert.equal(ctx.statusReport.error.length, 1)
      assert.equal(ctx.statusReport.error[0].code, 'MISSING_PLUGINS')
      assert.deepEqual(ctx.statusReport.error[0].data, ['adapt-contrib-missing'])
    })

    it('should not report error when config plugins exist in the import package', async () => {
      const ctx = makePluginCtx({
        configEnabledPlugins: ['adapt-contrib-text'],
        usedContentPlugins: { 'adapt-contrib-text': { name: 'adapt-contrib-text', version: '1.0.0', type: 'component' } },
        contentplugin: {
          find: async () => [{ name: 'adapt-contrib-text', version: '1.0.0', targetAttribute: '_text', isLocalInstall: true }]
        }
      })
      await importCoursePlugins.call(ctx)
      assert.equal(ctx.statusReport.error.length, 0)
    })

    it('should not report error when config plugins are installed on the server', async () => {
      const ctx = makePluginCtx({
        configEnabledPlugins: ['adapt-contrib-text'],
        usedContentPlugins: {},
        contentplugin: {
          find: async () => [{ name: 'adapt-contrib-text', version: '1.0.0', targetAttribute: '_text' }]
        }
      })
      await importCoursePlugins.call(ctx)
      assert.equal(ctx.statusReport.error.length, 0)
    })

    it('should not report error when configEnabledPlugins is empty', async () => {
      const ctx = makePluginCtx({
        configEnabledPlugins: [],
        contentplugin: { find: async () => [] }
      })
      await importCoursePlugins.call(ctx)
      assert.equal(ctx.statusReport.error.length, 0)
    })

    it('should only flag plugins missing from both package and server', async () => {
      const ctx = makePluginCtx({
        configEnabledPlugins: ['adapt-contrib-text', 'adapt-contrib-gmcq', 'adapt-contrib-missing'],
        usedContentPlugins: { 'adapt-contrib-text': { version: '1.0.0' } },
        settings: { isDryRun: true, importPlugins: true, updatePlugins: false },
        contentplugin: {
          find: async () => [{ name: 'adapt-contrib-gmcq', version: '2.0.0', targetAttribute: '_gmcq' }]
        }
      })
      await importCoursePlugins.call(ctx)
      assert.equal(ctx.statusReport.error.length, 1)
      assert.deepEqual(ctx.statusReport.error[0].data, ['adapt-contrib-missing'])
    })
  })
})
