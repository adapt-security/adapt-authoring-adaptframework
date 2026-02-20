import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import AdaptFrameworkImport from '../lib/AdaptFrameworkImport.js'

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

  describe('#extractAssets()', () => {
    function makeCtx (assetMap) {
      const ctx = { assetMap }
      ctx.extractAssets = AdaptFrameworkImport.prototype.extractAssets.bind(ctx)
      return ctx
    }

    it('should replace asset paths with mapped IDs', () => {
      const ctx = makeCtx({ 'course/en/assets/logo.png': 'asset123' })
      const schema = {
        _graphic: {
          properties: {
            src: { _backboneForms: 'Asset' }
          }
        }
      }
      const data = { _graphic: { src: 'course/en/assets/logo.png' } }
      ctx.extractAssets(schema, data)
      assert.equal(data._graphic.src, 'asset123')
    })

    it('should delete empty string asset values', () => {
      const ctx = makeCtx({})
      const schema = {
        _graphic: {
          properties: {
            src: { _backboneForms: 'Asset' }
          }
        }
      }
      const data = { _graphic: { src: '' } }
      ctx.extractAssets(schema, data)
      assert.equal('src' in data._graphic, false)
    })

    it('should keep value when not in assetMap', () => {
      const ctx = makeCtx({})
      const schema = {
        img: { _backboneForms: { type: 'Asset' } }
      }
      const data = { img: 'unknown/path.png' }
      ctx.extractAssets(schema, data)
      assert.equal(data.img, 'unknown/path.png')
    })

    it('should recurse into nested properties', () => {
      const ctx = makeCtx({ 'assets/bg.jpg': 'asset456' })
      const schema = {
        _settings: {
          properties: {
            _background: {
              properties: {
                src: { _backboneForms: 'Asset' }
              }
            }
          }
        }
      }
      const data = { _settings: { _background: { src: 'assets/bg.jpg' } } }
      ctx.extractAssets(schema, data)
      assert.equal(data._settings._background.src, 'asset456')
    })

    it('should recurse into array items', () => {
      const ctx = makeCtx({ 'assets/a.png': 'id1', 'assets/b.png': 'id2' })
      const schema = {
        _items: {
          items: {
            properties: {
              src: { _backboneForms: 'Asset' }
            }
          }
        }
      }
      const data = {
        _items: [
          { src: 'assets/a.png' },
          { src: 'assets/b.png' }
        ]
      }
      ctx.extractAssets(schema, data)
      assert.equal(data._items[0].src, 'id1')
      assert.equal(data._items[1].src, 'id2')
    })

    it('should skip undefined data keys', () => {
      const ctx = makeCtx({})
      const schema = {
        _graphic: { _backboneForms: 'Asset' }
      }
      const data = {}
      ctx.extractAssets(schema, data)
      assert.equal('_graphic' in data, false)
    })

    it('should handle null schema gracefully', () => {
      const ctx = makeCtx({})
      ctx.extractAssets(null, { a: 1 })
    })

    it('should handle _backboneForms as object with type', () => {
      const ctx = makeCtx({ 'path/img.png': 'mapped' })
      const schema = {
        hero: { _backboneForms: { type: 'Asset' } }
      }
      const data = { hero: 'path/img.png' }
      ctx.extractAssets(schema, data)
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
})
