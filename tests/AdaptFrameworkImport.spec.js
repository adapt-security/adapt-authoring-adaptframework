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
})
