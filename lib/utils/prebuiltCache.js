import fs from 'node:fs/promises'
import path from 'upath'
import { log } from './log.js'

/** Entries to skip (rebuilt per-build from course data) */
const SKIP_ENTRIES = new Set(['course'])

/**
 * Returns the cache directory path for a given (pluginHash, theme, menu) combo.
 * @param {String} cacheRoot Root cache directory
 * @param {String} pluginHash Hash of installed plugins
 * @param {String} theme Theme name
 * @param {String} menu Menu name
 * @return {String}
 */
export function getCachePath (cacheRoot, pluginHash, theme, menu) {
  return path.join(cacheRoot, `${pluginHash}_${theme}_${menu}`)
}

/**
 * Checks whether a cached build exists for the given combo.
 * @param {String} cacheRoot Root cache directory
 * @param {String} pluginHash Hash of installed plugins
 * @param {String} theme Theme name
 * @param {String} menu Menu name
 * @return {Promise<Boolean>}
 */
export async function hasCachedBuild (cacheRoot, pluginHash, theme, menu) {
  try {
    await fs.access(getCachePath(cacheRoot, pluginHash, theme, menu))
    return true
  } catch {
    return false
  }
}

async function copyEntry (src, dest) {
  const stat = await fs.stat(src)
  if (stat.isDirectory()) {
    await fs.cp(src, dest, { recursive: true })
  } else {
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.copyFile(src, dest)
  }
}

/**
 * Copies the build output (minus per-course content) into the cache for the given combo.
 * Uses a temp dir + atomic rename for parallel safety.
 * @param {String} buildOutputDir The build output directory
 * @param {String} cacheRoot Root cache directory
 * @param {String} pluginHash Hash of installed plugins
 * @param {String} theme Theme name
 * @param {String} menu Menu name
 * @return {Promise}
 */
export async function populateCache (buildOutputDir, cacheRoot, pluginHash, theme, menu) {
  const cacheDir = getCachePath(cacheRoot, pluginHash, theme, menu)
  await fs.mkdir(cacheRoot, { recursive: true })

  const tmpDir = `${cacheDir}_tmp_${Date.now()}`
  try {
    await fs.mkdir(tmpDir, { recursive: true })
    const entries = await fs.readdir(buildOutputDir)
    for (const entry of entries) {
      if (SKIP_ENTRIES.has(entry)) continue
      await copyEntry(path.join(buildOutputDir, entry), path.join(tmpDir, entry))
    }
    await safeRename(tmpDir, cacheDir)
    log('info', 'CACHE', `populated cache for ${pluginHash} (theme=${theme}, menu=${menu})`)
  } catch (e) {
    await fs.rm(tmpDir, { recursive: true, force: true })
    throw e
  }
}

/**
 * Copies cached artifacts to a build directory.
 * @param {String} cacheRoot Root cache directory
 * @param {String} pluginHash Hash of installed plugins
 * @param {String} theme Theme name
 * @param {String} menu Menu name
 * @param {String} destDir Destination build directory
 * @return {Promise}
 */
export async function restoreFromCache (cacheRoot, pluginHash, theme, menu, destDir) {
  await fs.mkdir(destDir, { recursive: true })
  await fs.cp(getCachePath(cacheRoot, pluginHash, theme, menu), destDir, { recursive: true })
  log('info', 'CACHE', `restored from cache for ${pluginHash} (theme=${theme}, menu=${menu})`)
}

/**
 * Removes the entire prebuilt cache directory.
 * @param {String} cacheRoot Root cache directory
 * @return {Promise}
 */
export async function invalidateCache (cacheRoot) {
  await fs.rm(cacheRoot, { recursive: true, force: true })
  log('info', 'CACHE', 'invalidated prebuilt cache')
}

async function safeRename (src, dest) {
  try {
    await fs.rename(src, dest)
  } catch (e) {
    if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') {
      await fs.rm(src, { recursive: true, force: true })
    } else {
      throw e
    }
  }
}
