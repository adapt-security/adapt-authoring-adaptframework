import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { App, ensureDir } from 'adapt-authoring-core'
import { load, migrate, Journal, Logger } from 'adapt-migrations'

const require = createRequire(import.meta.url)

/**
 * Runs adapt-migrations on a content array. Shared by framework update, course import, and plugin update.
 * @param {Object} options
 * @param {Array} options.content Flat array of content objects (course, config, contentObjects, etc.)
 * @param {Array<{name: String, version: String}>} options.fromPlugins Plugin versions before the update
 * @param {Array<{name: String, version: String}>} options.toPlugins Plugin versions after the update
 * @param {String[]} options.scripts Absolute paths to migration scripts
 * @param {String} [options.cachePath] Optional cache path for adapt-migrations. If omitted, a unique dir under the app's tempDir is created and removed after migration — callers running concurrently MUST either omit this or pass a unique path per call, as adapt-migrations wipes the directory on entry.
 * @returns {Promise<Array>} The migrated content array
 */
export async function runContentMigration ({ content, fromPlugins, toPlugins, scripts, cachePath }) {
  const logger = Logger.getInstance()

  let resolvedCachePath = cachePath
  const usingEphemeralCache = !resolvedCachePath
  if (usingEphemeralCache) {
    const tempDir = App.instance.getConfig('tempDir')
    const baseCacheDir = path.join(tempDir, 'migration-cache')
    await ensureDir(baseCacheDir)
    // Symlink node_modules at the base so cached migration scripts' bare
    // `import 'adapt-migrations'` resolves via Node's upward walk. It must sit
    // a level ABOVE the run dir, otherwise adapt-migrations's own `npm install`
    // step (which runs in the run dir) wipes the symlink.
    const sharedLink = path.join(baseCacheDir, 'node_modules')
    if (!fs.existsSync(sharedLink)) {
      const sharedNodeModules = path.dirname(path.dirname(require.resolve('adapt-migrations')))
      try {
        fs.symlinkSync(sharedNodeModules, sharedLink, 'dir')
      } catch (err) {
        if (err.code !== 'EEXIST') throw err
      }
    }
    resolvedCachePath = fs.mkdtempSync(path.join(baseCacheDir, 'run-'))
  } else {
    await ensureDir(resolvedCachePath)
  }

  try {
    await load({ scripts, cachePath: resolvedCachePath, logger })

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
  } finally {
    if (usingEphemeralCache) {
      try {
        fs.rmSync(resolvedCachePath, { recursive: true, force: true })
      } catch (err) {
        logger.warn(`Failed to clean up migration cache at ${resolvedCachePath}: ${err.message}`)
      }
    }
  }
}
