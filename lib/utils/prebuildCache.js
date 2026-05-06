import { App, ensureDir, writeJson } from 'adapt-authoring-core'
import AdaptCli from 'adapt-cli'
import fs from 'node:fs/promises'
import path from 'upath'
import { copyFrameworkSource } from './copyFrameworkSource.js'
import { hasCachedBuild, populateCache } from './prebuiltCache.js'
import { computePluginHash } from './computePluginHash.js'
import { log } from './log.js'

/**
 * Eagerly populates the prebuilt cache for every (theme, menu) combination
 * of installed plugins. Iterates serially: each iteration runs a full grunt
 * build with the chosen theme/menu and caches the output.
 *
 * Idempotent — combos that already have a cache entry are skipped, so
 * re-runs only build what's missing. Per-iteration failures are logged
 * but don't abort the whole prebuild.
 * @param {Object} options
 * @param {String} options.buildDir Root build directory
 * @param {String} options.frameworkDir Path to the adapt_framework source
 * @return {Promise}
 */
export async function prebuildCache ({ buildDir, frameworkDir }) {
  const app = App.instance
  const cacheRoot = path.join(buildDir, 'prebuilt-cache')
  const pluginHash = await computePluginHash(frameworkDir)

  const contentplugin = await app.waitForModule('contentplugin')
  const allPlugins = await contentplugin.find({})
  const themes = allPlugins.filter(p => p.type === 'theme')
  const menus = allPlugins.filter(p => p.type === 'menu')

  if (!themes.length || !menus.length) {
    throw new Error('Cannot prebuild cache: no theme or menu plugin installed')
  }

  log('info', 'CACHE', `starting eager prebuild for ${themes.length * menus.length} (theme,menu) combinations`)

  for (const theme of themes) {
    for (const menu of menus) {
      try {
        await prebuildOne({ buildDir, cacheRoot, pluginHash, theme, menu, allPlugins })
      } catch (e) {
        log('warn', 'CACHE', `eager prebuild failed for theme=${theme.name} menu=${menu.name}: ${e.message}`)
        if (e.cmd) log('warn', 'CACHE', `cmd: ${e.cmd}`)
        if (e.stderr) log('warn', 'CACHE', `stderr: ${e.stderr}`)
      }
    }
  }

  log('info', 'CACHE', 'eager prebuild complete')
}

async function prebuildOne ({ buildDir, cacheRoot, pluginHash, theme, menu, allPlugins }) {
  const app = App.instance

  if (await hasCachedBuild(cacheRoot, pluginHash, theme.name, menu.name)) {
    log('info', 'CACHE', `skipping cached combo theme=${theme.name} menu=${menu.name}`)
    return
  }

  // Only one theme/menu can be active per build — drop the others so
  // the framework's less:dev task doesn't glob multiple themes' LESS
  // into a single adapt.css (see adapt_framework#3802).
  const includedPlugins = allPlugins.filter(p =>
    (p.type !== 'theme' && p.type !== 'menu') || p.name === theme.name || p.name === menu.name
  )
  const pluginNames = includedPlugins.map(p => p.name)

  const tmpDir = path.join(buildDir, `_eager_cache_${Date.now()}_${theme.name}_${menu.name}`)
  try {
    log('info', 'CACHE', `building combo theme=${theme.name} menu=${menu.name}`)

    await copyFrameworkSource({
      destDir: tmpDir,
      enabledPlugins: pluginNames,
      linkNodeModules: true
    })

    const outputDir = path.join(tmpDir, 'build')
    const buildCourseDir = path.join(outputDir, 'course', 'en')
    await ensureDir(buildCourseDir)
    await writeJson(path.join(outputDir, 'course', 'config.json'), {
      _defaultLanguage: 'en',
      _theme: theme.name,
      _menu: menu.name,
      _enabledPlugins: pluginNames
    })
    await writeJson(path.join(buildCourseDir, 'course.json'), {
      title: '_eager_cache_build',
      _latestTrackingId: 0
    })
    const cacheDir = path.join(buildDir, 'cache')
    await ensureDir(cacheDir)

    await AdaptCli.buildCourse({
      cwd: tmpDir,
      sourceMaps: true,
      outputDir,
      cachePath: path.join(cacheDir, '_eager_cache'),
      logger: { log: (...args) => app.logger.log('debug', 'adapt-cli', ...args) }
    })

    if (!await hasCachedBuild(cacheRoot, pluginHash, theme.name, menu.name)) {
      await populateCache(outputDir, cacheRoot, pluginHash, theme.name, menu.name)
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}
