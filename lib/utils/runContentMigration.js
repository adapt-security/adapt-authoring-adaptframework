import { load, migrate, Journal, Logger } from 'adapt-migrations'

/**
 * Runs adapt-migrations on a content array. Shared by framework update, course import, and plugin update.
 * @param {Object} options
 * @param {Array} options.content Flat array of content objects (course, config, contentObjects, etc.)
 * @param {Array<{name: String, version: String}>} options.fromPlugins Plugin versions before the update
 * @param {Array<{name: String, version: String}>} options.toPlugins Plugin versions after the update
 * @param {String[]} options.scripts Absolute paths to migration scripts
 * @param {String} [options.cachePath] Optional cache path for adapt-migrations
 * @returns {Promise<Array>} The migrated content array
 */
export async function runContentMigration ({ content, fromPlugins, toPlugins, scripts, cachePath }) {
  const logger = Logger.getInstance()

  await load({ scripts, cachePath, logger })

  const originalFromPlugins = JSON.parse(JSON.stringify(fromPlugins))
  const journal = new Journal({
    logger,
    data: {
      content,
      fromPlugins,
      originalFromPlugins,
      toPlugins
    }
  })

  await migrate({ journal, logger })

  return journal.data.content
}
