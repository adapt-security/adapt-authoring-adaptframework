import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const testCachePath = fs.mkdtempSync(path.join(os.tmpdir(), 'runContentMigration-test-'))

const mockLoad = mock.fn(async () => {})
const mockMigrate = mock.fn(async ({ journal }) => {
  journal.data.content[0].title = 'migrated'
})

class FakeJournal {
  constructor ({ data }) {
    this.data = data
  }
}

class FakeLogger {
  info () {}
  error () {}
  warn () {}
  debug () {}
  log () {}
}

mock.module('adapt-migrations', {
  namedExports: {
    load: mockLoad,
    migrate: mockMigrate,
    Journal: FakeJournal,
    Logger: { getInstance: () => new FakeLogger() }
  }
})

const { runContentMigration } = await import('../lib/utils/runContentMigration.js')

describe('runContentMigration()', () => {
  it('should call load with scripts and logger', async () => {
    mockLoad.mock.resetCalls()
    const scripts = ['/path/to/migration.js']
    await runContentMigration({
      content: [{ _id: 'c1', title: 'old' }],
      fromPlugins: [{ name: 'core', version: '1.0.0' }],
      toPlugins: [{ name: 'core', version: '2.0.0' }],
      scripts,
      cachePath: testCachePath
    })
    assert.equal(mockLoad.mock.calls.length, 1)
    assert.deepEqual(mockLoad.mock.calls[0].arguments[0].scripts, scripts)
  })

  it('should create a Journal with correct data shape', async () => {
    mockMigrate.mock.resetCalls()
    await runContentMigration({
      content: [{ _id: 'c1', title: 'old' }],
      fromPlugins: [{ name: 'core', version: '1.0.0' }],
      toPlugins: [{ name: 'core', version: '2.0.0' }],
      scripts: [],
      cachePath: testCachePath
    })
    assert.equal(mockMigrate.mock.calls.length, 1)
    const journal = mockMigrate.mock.calls[0].arguments[0].journal
    assert.ok(journal.data.content)
    assert.ok(journal.data.fromPlugins)
    assert.ok(journal.data.originalFromPlugins)
    assert.ok(journal.data.toPlugins)
  })

  it('should return mutated content', async () => {
    mockMigrate.mock.resetCalls()
    mockMigrate.mock.mockImplementation(async ({ journal }) => {
      journal.data.content[0].title = 'migrated'
    })
    const result = await runContentMigration({
      content: [{ _id: 'c1', title: 'old' }],
      fromPlugins: [{ name: 'core', version: '1.0.0' }],
      toPlugins: [{ name: 'core', version: '2.0.0' }],
      scripts: [],
      cachePath: testCachePath
    })
    assert.equal(result[0].title, 'migrated')
  })

  it('should deep-clone fromPlugins into originalFromPlugins', async () => {
    mockMigrate.mock.resetCalls()
    mockMigrate.mock.mockImplementation(async () => {})
    const fromPlugins = [{ name: 'core', version: '1.0.0' }]
    await runContentMigration({
      content: [{ _id: 'c1' }],
      fromPlugins,
      toPlugins: [{ name: 'core', version: '2.0.0' }],
      scripts: [],
      cachePath: testCachePath
    })
    const journal = mockMigrate.mock.calls[0].arguments[0].journal
    assert.deepEqual(journal.data.originalFromPlugins, fromPlugins)
    assert.notEqual(journal.data.originalFromPlugins, journal.data.fromPlugins)
  })
})
