import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

const mockContentModule = {
  find: mock.fn(async () => [
    { _id: 'course1', _type: 'course', title: 'Course 1' }
  ]),
  findOne: mock.fn(async ({ _id, _type, _courseId }) => {
    if (_type === 'config') return { _id: 'cfg1', _type: 'config', _courseId }
    return { _id, _type: 'course', title: 'Course 1' }
  }),
  update: mock.fn(async () => {})
}

mock.module('adapt-authoring-core', {
  namedExports: {
    App: {
      instance: {
        waitForModule: mock.fn(async () => mockContentModule)
      }
    }
  }
})

const mockCollectMigrationScripts = mock.fn(async () => ['/path/to/script.js'])
mock.module('../lib/utils/collectMigrationScripts.js', {
  namedExports: {
    collectMigrationScripts: mockCollectMigrationScripts
  }
})

const mockRunContentMigration = mock.fn(async ({ content }) => {
  return content.map(item => ({
    ...item,
    title: item.title ? item.title + ' (migrated)' : item.title
  }))
})
mock.module('../lib/utils/runContentMigration.js', {
  namedExports: {
    runContentMigration: mockRunContentMigration
  }
})

mock.module('../lib/utils/log.js', {
  namedExports: {
    log: () => {}
  }
})

const { migrateExistingCourses } = await import('../lib/utils/migrateExistingCourses.js')

describe('migrateExistingCourses()', () => {
  it('should collect migration scripts from frameworkDir', async () => {
    mockCollectMigrationScripts.mock.resetCalls()
    await migrateExistingCourses({
      fromPlugins: [{ name: 'core', version: '1.0.0' }],
      toPlugins: [{ name: 'core', version: '2.0.0' }],
      frameworkDir: '/fw'
    })
    assert.equal(mockCollectMigrationScripts.mock.calls.length, 1)
    assert.equal(mockCollectMigrationScripts.mock.calls[0].arguments[0], '/fw')
  })

  it('should query all courses when no courseIds provided', async () => {
    mockContentModule.find.mock.resetCalls()
    await migrateExistingCourses({
      fromPlugins: [],
      toPlugins: [],
      frameworkDir: '/fw'
    })
    const findCalls = mockContentModule.find.mock.calls
    assert.ok(findCalls.some(c =>
      JSON.stringify(c.arguments[0]) === JSON.stringify({ _type: 'course' })
    ))
  })

  it('should return migration result counts', async () => {
    mockContentModule.find.mock.resetCalls()
    mockContentModule.update.mock.resetCalls()
    mockRunContentMigration.mock.resetCalls()
    mockRunContentMigration.mock.mockImplementation(async ({ content }) => {
      return content.map(item => ({
        ...item,
        title: item.title ? item.title + ' (migrated)' : item.title
      }))
    })
    const result = await migrateExistingCourses({
      fromPlugins: [{ name: 'core', version: '1.0.0' }],
      toPlugins: [{ name: 'core', version: '2.0.0' }],
      frameworkDir: '/fw'
    })
    assert.equal(result.migrated, 1)
    assert.equal(result.failed, 0)
    assert.deepEqual(result.errors, [])
  })

  it('should only update changed items in DB', async () => {
    mockContentModule.update.mock.resetCalls()
    mockRunContentMigration.mock.mockImplementation(async ({ content }) => {
      return content.map(item => ({
        ...item,
        title: item.title ? item.title + ' (migrated)' : item.title
      }))
    })
    await migrateExistingCourses({
      fromPlugins: [],
      toPlugins: [],
      frameworkDir: '/fw'
    })
    assert.ok(mockContentModule.update.mock.calls.length > 0)
  })

  it('should skip DB writes when content is unchanged', async () => {
    mockContentModule.update.mock.resetCalls()
    mockRunContentMigration.mock.mockImplementation(async ({ content }) => content)
    await migrateExistingCourses({
      fromPlugins: [],
      toPlugins: [],
      frameworkDir: '/fw'
    })
    assert.equal(mockContentModule.update.mock.calls.length, 0)
  })

  it('should return early with zero counts when no scripts found', async () => {
    mockCollectMigrationScripts.mock.mockImplementation(async () => [])
    const result = await migrateExistingCourses({
      fromPlugins: [],
      toPlugins: [],
      frameworkDir: '/fw'
    })
    assert.equal(result.migrated, 0)
    assert.equal(result.failed, 0)
    // restore
    mockCollectMigrationScripts.mock.mockImplementation(async () => ['/path/to/script.js'])
  })

  it('should isolate per-course errors and continue', async () => {
    mockContentModule.find.mock.mockImplementation(async (query) => {
      if (query._type === 'course') {
        return [
          { _id: 'course1', _type: 'course', title: 'OK' },
          { _id: 'course2', _type: 'course', title: 'Fails' }
        ]
      }
      return []
    })
    let callCount = 0
    mockRunContentMigration.mock.mockImplementation(async ({ content }) => {
      callCount++
      if (callCount === 2) throw new Error('migration error')
      return content.map(item => ({ ...item, title: item.title + ' (migrated)' }))
    })
    const result = await migrateExistingCourses({
      fromPlugins: [],
      toPlugins: [],
      frameworkDir: '/fw'
    })
    assert.equal(result.migrated, 1)
    assert.equal(result.failed, 1)
    assert.equal(result.errors.length, 1)
    assert.equal(result.errors[0].courseId, 'course2')
  })
})
