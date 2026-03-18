import { App, ensureDir, writeJson } from 'adapt-authoring-core'
import AdaptCli from 'adapt-cli'
import fs from 'node:fs/promises'
import path from 'upath'
import { copyFrameworkSource } from './copyFrameworkSource.js'
import { hasSharedCache, populateSharedCacheOnly } from './prebuiltCache.js'
import { computePluginHash } from './computePluginHash.js'
import { log } from './log.js'

/**
 * Eagerly rebuilds the shared prebuilt cache in the background.
 * Runs a full grunt build with all installed plugins and a minimal
 * dummy course, then extracts only the shared artifacts (JS, HTML,
 * templates, libraries, required files) into the cache.
 * @param {Object} options
 * @param {String} options.buildDir Root build directory
 * @param {String} options.frameworkDir Path to the adapt_framework source
 * @return {Promise}
 */
export async function prebuildSharedCache ({ buildDir, frameworkDir }) {
  const app = App.instance
  const cacheRoot = path.join(buildDir, 'prebuilt-cache')
  const pluginHash = await computePluginHash(frameworkDir)

  if (await hasSharedCache(cacheRoot, pluginHash)) return

  const contentplugin = await app.waitForModule('contentplugin')
  const allPlugins = await contentplugin.find({})
  const pluginNames = allPlugins.map(p => p.name)
  const theme = allPlugins.find(p => p.type === 'theme')?.name
  const menu = allPlugins.find(p => p.type === 'menu')?.name

  if (!theme || !menu) {
    throw new Error('Cannot prebuild shared cache: no theme or menu plugin installed')
  }

  const tmpDir = path.join(buildDir, `_eager_cache_${Date.now()}`)
  try {
    log('info', 'CACHE', 'starting eager shared cache build')

    await copyFrameworkSource({
      destDir: tmpDir,
      enabledPlugins: pluginNames,
      linkNodeModules: true
    })

    // Write minimal course data so grunt can run
    const courseDir = path.join(tmpDir, 'src', 'course', 'en')
    await ensureDir(courseDir)
    await writeJson(path.join(tmpDir, 'src', 'course', 'config.json'), {
      _defaultLanguage: 'en',
      _theme: theme,
      _menu: menu
    })
    await writeJson(path.join(courseDir, 'course.json'), {
      title: '_eager_cache_build',
      _latestTrackingId: 0
    })

    const outputDir = path.join(tmpDir, 'build')
    const cacheDir = path.join(buildDir, 'cache')
    await ensureDir(cacheDir)

    await AdaptCli.buildCourse({
      cwd: tmpDir,
      sourceMaps: true,
      outputDir,
      cachePath: path.join(cacheDir, '_eager_cache'),
      logger: { log: (...args) => app.logger.log('debug', 'adapt-cli', ...args) }
    })

    // Only extract the shared entries (skip CSS which is theme-specific)
    if (!await hasSharedCache(cacheRoot, pluginHash)) {
      await populateSharedCacheOnly(outputDir, cacheRoot, pluginHash)
    }

    log('info', 'CACHE', 'eager shared cache build complete')
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}
