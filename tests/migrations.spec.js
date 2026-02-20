import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

import ConfigTransform from '../lib/migrations/config.js'
import GraphicSrcTransform from '../lib/migrations/graphic-src.js'
import NavOrderTransform from '../lib/migrations/nav-order.js'
import ParentIdTransform from '../lib/migrations/parent-id.js'
import RemoveUndef from '../lib/migrations/remove-undef.js'
import StartPage from '../lib/migrations/start-page.js'
import ThemeUndef from '../lib/migrations/theme-undef.js'

describe('Migrations', () => {
  describe('ConfigTransform', () => {
    it('should convert numeric ARIA levels to strings', async () => {
      const data = {
        _type: 'config',
        _accessibility: {
          _ariaLevels: {
            _menu: 1,
            _menuItem: 2,
            _page: 3,
            _article: 4,
            _block: 5,
            _component: 6,
            _componentItem: 7,
            _notify: 8
          }
        }
      }
      await ConfigTransform(data)
      assert.equal(data._accessibility._ariaLevels._menu, '1')
      assert.equal(data._accessibility._ariaLevels._menuItem, '2')
      assert.equal(data._accessibility._ariaLevels._page, '3')
      assert.equal(data._accessibility._ariaLevels._article, '4')
      assert.equal(data._accessibility._ariaLevels._block, '5')
      assert.equal(data._accessibility._ariaLevels._component, '6')
      assert.equal(data._accessibility._ariaLevels._componentItem, '7')
      assert.equal(data._accessibility._ariaLevels._notify, '8')
    })

    it('should not modify already-string values', async () => {
      const data = {
        _type: 'config',
        _accessibility: { _ariaLevels: { _menu: '1' } }
      }
      await ConfigTransform(data)
      assert.equal(data._accessibility._ariaLevels._menu, '1')
    })

    it('should skip non-config types', async () => {
      const data = {
        _type: 'course',
        _accessibility: { _ariaLevels: { _menu: 1 } }
      }
      await ConfigTransform(data)
      assert.equal(data._accessibility._ariaLevels._menu, 1)
    })

    it('should skip config without _ariaLevels', async () => {
      const data = { _type: 'config', _accessibility: {} }
      await ConfigTransform(data)
      assert.deepEqual(data._accessibility, {})
    })

    it('should not convert falsy values (0)', async () => {
      const data = {
        _type: 'config',
        _accessibility: { _ariaLevels: { _menu: 0 } }
      }
      await ConfigTransform(data)
      assert.equal(data._accessibility._ariaLevels._menu, 0)
    })
  })

  describe('GraphicSrcTransform', () => {
    it('should copy src to large and small for graphic component', async () => {
      const data = {
        _component: 'adapt-contrib-graphic',
        _graphic: { src: 'image.png' }
      }
      await GraphicSrcTransform(data)
      assert.equal(data._graphic.large, 'image.png')
      assert.equal(data._graphic.small, 'image.png')
    })

    it('should copy src to large and small for hotgraphic component', async () => {
      const data = {
        _component: 'adapt-contrib-hotgraphic',
        _graphic: { src: 'hot.png' },
        _items: [
          { _graphic: { src: 'item1.png' } },
          { _graphic: { src: 'item2.png' } }
        ]
      }
      await GraphicSrcTransform(data)
      assert.equal(data._graphic.large, 'hot.png')
      assert.equal(data._graphic.small, 'hot.png')
      assert.equal(data._items[0]._graphic.large, 'item1.png')
      assert.equal(data._items[0]._graphic.small, 'item1.png')
      assert.equal(data._items[1]._graphic.large, 'item2.png')
      assert.equal(data._items[1]._graphic.small, 'item2.png')
    })

    it('should skip non-graphic components', async () => {
      const data = {
        _component: 'adapt-contrib-text',
        _graphic: { src: 'image.png' }
      }
      await GraphicSrcTransform(data)
      assert.equal(data._graphic.large, undefined)
    })

    it('should not overwrite if src is absent', async () => {
      const data = {
        _component: 'adapt-contrib-graphic',
        _graphic: { large: 'existing.png' }
      }
      await GraphicSrcTransform(data)
      assert.equal(data._graphic.large, 'existing.png')
    })

    it('should handle graphic without _items', async () => {
      const data = {
        _component: 'adapt-contrib-graphic',
        _graphic: { src: 'only.png' }
      }
      await GraphicSrcTransform(data)
      assert.equal(data._graphic.large, 'only.png')
      assert.equal(data._graphic.small, 'only.png')
    })
  })

  describe('NavOrderTransform', () => {
    it('should convert string _navOrder to number', async () => {
      const data = {
        _type: 'course',
        _globals: {
          _extensions: {
            _trickle: { _navOrder: '100' },
            _resources: { _navOrder: '200' }
          }
        }
      }
      await NavOrderTransform(data)
      assert.equal(data._globals._extensions._trickle._navOrder, 100)
      assert.equal(data._globals._extensions._resources._navOrder, 200)
    })

    it('should keep numeric _navOrder as-is', async () => {
      const data = {
        _type: 'course',
        _globals: { _extensions: { _trickle: { _navOrder: 50 } } }
      }
      await NavOrderTransform(data)
      assert.equal(data._globals._extensions._trickle._navOrder, 50)
    })

    it('should skip non-course types', async () => {
      const data = {
        _type: 'config',
        _globals: { _extensions: { _trickle: { _navOrder: '100' } } }
      }
      await NavOrderTransform(data)
      assert.equal(data._globals._extensions._trickle._navOrder, '100')
    })

    it('should skip extensions without _navOrder', async () => {
      const data = {
        _type: 'course',
        _globals: { _extensions: { _trickle: { other: 'value' } } }
      }
      await NavOrderTransform(data)
      assert.equal(data._globals._extensions._trickle._navOrder, undefined)
    })
  })

  describe('ParentIdTransform', () => {
    it('should remap _parentId using idMap', async () => {
      const data = { _parentId: 'old-id' }
      const importer = { idMap: { 'old-id': 'new-id' } }
      await ParentIdTransform(data, importer)
      assert.equal(data._parentId, 'new-id')
    })

    it('should set _parentId to undefined when not in idMap', async () => {
      const data = { _parentId: 'unknown' }
      const importer = { idMap: {} }
      await ParentIdTransform(data, importer)
      assert.equal(data._parentId, undefined)
    })

    it('should skip when _parentId is falsy', async () => {
      const data = { _parentId: undefined }
      const importer = { idMap: { undefined: 'should-not-set' } }
      await ParentIdTransform(data, importer)
      assert.equal(data._parentId, undefined)
    })

    it('should skip when _parentId is not present', async () => {
      const data = { _type: 'course' }
      const importer = { idMap: {} }
      await ParentIdTransform(data, importer)
      assert.equal(data._parentId, undefined)
    })
  })

  describe('RemoveUndef', () => {
    it('should remove null properties', async () => {
      const data = { a: 1, b: null, c: 'test' }
      await RemoveUndef(data)
      assert.equal(data.a, 1)
      assert.equal(data.c, 'test')
      assert.equal('b' in data, false)
    })

    it('should recursively remove nulls in nested objects', async () => {
      const data = { a: { b: null, c: { d: null, e: 1 } } }
      await RemoveUndef(data)
      assert.equal('b' in data.a, false)
      assert.equal('d' in data.a.c, false)
      assert.equal(data.a.c.e, 1)
    })

    it('should not recurse into arrays', async () => {
      const data = { arr: [null, 1, null] }
      await RemoveUndef(data)
      assert.deepEqual(data.arr, [null, 1, null])
    })

    it('should preserve non-null falsy values', async () => {
      const data = { a: 0, b: false, c: '', d: undefined }
      await RemoveUndef(data)
      assert.equal(data.a, 0)
      assert.equal(data.b, false)
      assert.equal(data.c, '')
      assert.equal(data.d, undefined)
    })

    it('should handle empty object', async () => {
      const data = {}
      await RemoveUndef(data)
      assert.deepEqual(data, {})
    })

    it('should handle deeply nested nulls', async () => {
      const data = { a: { b: { c: { d: null } } } }
      await RemoveUndef(data)
      assert.equal('d' in data.a.b.c, false)
    })
  })

  describe('StartPage', () => {
    it('should assign _friendlyId to content objects from _startIds', async () => {
      const data = {
        _type: 'course',
        _start: {
          _startIds: [
            { _id: 'page1' },
            { _id: 'page2' }
          ]
        }
      }
      const importer = {
        contentJson: {
          contentObjects: {
            page1: { _id: 'page1' },
            page2: { _id: 'page2' }
          }
        },
        framework: { log: mock.fn() }
      }
      await StartPage(data, importer)
      assert.equal(importer.contentJson.contentObjects.page1._friendlyId, 'start_page_1')
      assert.equal(importer.contentJson.contentObjects.page2._friendlyId, 'start_page_2')
    })

    it('should preserve existing _friendlyId', async () => {
      const data = {
        _type: 'course',
        _start: {
          _startIds: [{ _id: 'page1' }]
        }
      }
      const importer = {
        contentJson: {
          contentObjects: {
            page1: { _id: 'page1', _friendlyId: 'my-custom-id' }
          }
        },
        framework: { log: mock.fn() }
      }
      await StartPage(data, importer)
      assert.equal(importer.contentJson.contentObjects.page1._friendlyId, 'my-custom-id')
      assert.equal(data._start._startIds[0]._id, 'my-custom-id')
    })

    it('should log warning for missing content object', async () => {
      const logFn = mock.fn()
      const data = {
        _type: 'course',
        _start: {
          _startIds: [{ _id: 'missing' }]
        }
      }
      const importer = {
        contentJson: { contentObjects: {} },
        framework: { log: logFn }
      }
      await StartPage(data, importer)
      assert.equal(logFn.mock.calls.length, 1)
      assert.equal(logFn.mock.calls[0].arguments[0], 'warn')
    })

    it('should skip non-course types', async () => {
      const data = { _type: 'config', _start: { _startIds: [{ _id: 'p1' }] } }
      const importer = { contentJson: { contentObjects: {} } }
      await StartPage(data, importer)
    })

    it('should skip when _start is undefined', async () => {
      const data = { _type: 'course' }
      await StartPage(data, {})
    })

    it('should update _startIds[i]._id to match _friendlyId', async () => {
      const data = {
        _type: 'course',
        _start: { _startIds: [{ _id: 'page1' }] }
      }
      const importer = {
        contentJson: {
          contentObjects: { page1: { _id: 'page1' } }
        },
        framework: { log: mock.fn() }
      }
      await StartPage(data, importer)
      assert.equal(data._start._startIds[0]._id, 'start_page_1')
    })
  })

  describe('ThemeUndef', () => {
    it('should set _theme from used plugins when undefined', async () => {
      const data = { _type: 'config' }
      const importer = {
        usedContentPlugins: {
          'adapt-contrib-vanilla': { name: 'adapt-contrib-vanilla', type: 'theme' },
          'adapt-contrib-text': { name: 'adapt-contrib-text', type: 'component' }
        }
      }
      await ThemeUndef(data, importer)
      assert.equal(data._theme, 'adapt-contrib-vanilla')
    })

    it('should not override existing _theme', async () => {
      const data = { _type: 'config', _theme: 'my-theme' }
      const importer = {
        usedContentPlugins: {
          'adapt-contrib-vanilla': { name: 'adapt-contrib-vanilla', type: 'theme' }
        }
      }
      await ThemeUndef(data, importer)
      assert.equal(data._theme, 'my-theme')
    })

    it('should skip non-config types', async () => {
      const data = { _type: 'course' }
      const importer = {
        usedContentPlugins: {
          'adapt-contrib-vanilla': { name: 'adapt-contrib-vanilla', type: 'theme' }
        }
      }
      await ThemeUndef(data, importer)
      assert.equal(data._theme, undefined)
    })

    it('should set _theme to undefined when no theme plugin found', async () => {
      const data = { _type: 'config' }
      const importer = {
        usedContentPlugins: {
          'adapt-contrib-text': { name: 'adapt-contrib-text', type: 'component' }
        }
      }
      await ThemeUndef(data, importer)
      assert.equal(data._theme, undefined)
    })

    it('should handle empty usedContentPlugins', async () => {
      const data = { _type: 'config' }
      const importer = { usedContentPlugins: {} }
      await ThemeUndef(data, importer)
      assert.equal(data._theme, undefined)
    })
  })
})
