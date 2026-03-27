import { App } from 'adapt-authoring-core'
import { isDeepStrictEqual } from 'node:util'
import { collectMigrationScripts } from './collectMigrationScripts.js'
import { runContentMigration } from './runContentMigration.js'
import { log } from './log.js'

/**
 * Migrates content for a set of courses by courseId
 * @param {Object} options
 * @param {Array<{name: String, version: String}>} options.fromPlugins Plugin versions before update
 * @param {Array<{name: String, version: String}>} options.toPlugins Plugin versions after update
 * @param {String} options.frameworkDir Absolute path to the framework directory
 * @param {String[]} [options.courseIds] Specific course IDs to migrate (if omitted, migrates all)
 * @returns {Promise<{migrated: Number, failed: Number, errors: Array}>}
 */
export async function migrateExistingCourses ({ fromPlugins, toPlugins, frameworkDir, courseIds }) {
  const content = await App.instance.waitForModule('content')
  const scripts = await collectMigrationScripts(frameworkDir)

  if (!scripts.length) {
    log('debug', 'no migration scripts found, skipping')
    return { migrated: 0, failed: 0, errors: [] }
  }

  const foundCourses = courseIds
    ? await Promise.all(courseIds.map(async _id => content.findOne({ _id, _type: 'course' }, { strict: false })))
    : await content.find({ _type: 'course' })

  let migrated = 0
  let failed = 0
  const errors = []

  for (let ci = 0; ci < foundCourses.length; ci++) {
    const course = foundCourses[ci]
    if (!course) {
      const courseId = courseIds?.[ci] ?? 'unknown'
      log('warn', `course ${courseId} not found, skipping`)
      errors.push({ courseId, error: 'course not found' })
      failed++
      continue
    }
    try {
      const courseId = course._id.toString()
      log('debug', `migrating course ${courseId}`)

      const courseContent = await fetchCourseContent(content, course)
      const originals = courseContent.map(item => JSON.parse(JSON.stringify(item)))

      const migratedContent = await runContentMigration({
        content: courseContent,
        fromPlugins: JSON.parse(JSON.stringify(fromPlugins)),
        toPlugins,
        scripts
      })

      let updatedCount = 0
      for (let i = 0; i < migratedContent.length; i++) {
        const normalized = JSON.parse(JSON.stringify(migratedContent[i]))
        if (!isDeepStrictEqual(originals[i], normalized)) {
          await content.update({ _id: migratedContent[i]._id }, migratedContent[i])
          updatedCount++
        }
      }
      if (updatedCount > 0) {
        log('info', `migrated ${updatedCount} items in course ${courseId}`)
      }
      migrated++
    } catch (e) {
      const courseId = course?._id?.toString() ?? 'unknown'
      log('error', `migration failed for course ${courseId}`, e.message)
      errors.push({ courseId, error: e.message })
      failed++
    }
  }

  log('info', `migration complete: ${migrated} succeeded, ${failed} failed`)
  return { migrated, failed, errors }
}

async function fetchCourseContent (content, course) {
  const config = await content.findOne({ _courseId: course._id, _type: 'config' }, { strict: false })
  const items = await content.find({ _courseId: course._id, _type: { $nin: ['course', 'config'] } })
  const result = [course]
  if (config) result.push(config)
  result.push(...items)
  return result
}
