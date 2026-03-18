import fs from 'node:fs/promises'
import path from 'upath'
import { log } from './log.js'

/** Entries that are theme/menu-specific and belong in the CSS cache */
const CSS_ENTRIES = new Set(['adapt.css', 'adapt.css.map', 'fonts'])

/** Entries to skip (rebuilt per-build from course data) */
const SKIP_ENTRIES = new Set(['course'])

/**
 * Returns the cache directory paths for a given plugin hash, theme, and menu
 * @param {String} cacheRoot Root cache directory
 * @param {String} pluginHash Hash of installed plugins
 * @param {String} theme Theme name
 * @param {String} menu Menu name
 * @return {{ sharedDir: String, cssDir: String }}
 */
export function getCachePaths (cacheRoot, pluginHash, theme, menu) {
  return {
    sharedDir: path.join(cacheRoot, pluginHash),
    cssDir: path.join(cacheRoot, `${pluginHash}_${theme}_${menu}`)
  }
}

/**
 * Checks whether a cached build exists for the given parameters
 * @param {String} cacheRoot Root cache directory
 * @param {String} pluginHash Hash of installed plugins
 * @param {String} theme Theme name
 * @param {String} menu Menu name
 * @return {Promise<Boolean>}
 */
export async function hasCachedBuild (cacheRoot, pluginHash, theme, menu) {
  const { sharedDir, cssDir } = getCachePaths(cacheRoot, pluginHash, theme, menu)
  try {
    await Promise.all([
      fs.access(sharedDir),
      fs.access(cssDir)
    ])
    return true
  } catch {
    return false
  }
}

/**
 * Copies a file or directory from src to dest, creating parent dirs as needed
 * @param {String} src Source path
 * @param {String} dest Destination path
 * @return {Promise}
 */
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
 * Extracts shared artifacts from a completed grunt build into the cache.
 * Scans the build root and categorises each entry as shared or CSS-specific.
 * Uses atomic rename for parallel safety.
 * @param {String} buildOutputDir The build output directory (contains adapt/, index.html, etc.)
 * @param {String} cacheRoot Root cache directory
 * @param {String} pluginHash Hash of installed plugins
 * @param {String} theme Theme name
 * @param {String} menu Menu name
 * @return {Promise}
 */
export async function populateCache (buildOutputDir, cacheRoot, pluginHash, theme, menu) {
  const { sharedDir, cssDir } = getCachePaths(cacheRoot, pluginHash, theme, menu)
  await fs.mkdir(cacheRoot, { recursive: true })

  // Write to temp dirs first, then rename atomically
  const tmpShared = `${sharedDir}_tmp_${Date.now()}`
  const tmpCss = `${cssDir}_tmp_${Date.now()}`

  try {
    await fs.mkdir(tmpShared, { recursive: true })
    await fs.mkdir(tmpCss, { recursive: true })

    const entries = await fs.readdir(buildOutputDir)
    for (const entry of entries) {
      if (SKIP_ENTRIES.has(entry)) continue
      const src = path.join(buildOutputDir, entry)
      if (CSS_ENTRIES.has(entry)) {
        await copyEntry(src, path.join(tmpCss, entry))
      } else {
        await copyEntry(src, path.join(tmpShared, entry))
      }
    }

    // Atomic rename into place (last writer wins for parallel builds)
    await safeRename(tmpShared, sharedDir)
    await safeRename(tmpCss, cssDir)

    log('info', 'CACHE', `populated cache for ${pluginHash} (theme=${theme}, menu=${menu})`)
  } catch (e) {
    // Clean up temp dirs on failure
    await fs.rm(tmpShared, { recursive: true, force: true })
    await fs.rm(tmpCss, { recursive: true, force: true })
    throw e
  }
}

/**
 * Copies cached artifacts to a build directory
 * @param {String} cacheRoot Root cache directory
 * @param {String} pluginHash Hash of installed plugins
 * @param {String} theme Theme name
 * @param {String} menu Menu name
 * @param {String} destDir Destination build directory
 * @return {Promise}
 */
export async function restoreFromCache (cacheRoot, pluginHash, theme, menu, destDir) {
  const { sharedDir, cssDir } = getCachePaths(cacheRoot, pluginHash, theme, menu)
  await fs.mkdir(destDir, { recursive: true })
  await fs.cp(sharedDir, destDir, { recursive: true })
  await fs.cp(cssDir, destDir, { recursive: true })
  log('info', 'CACHE', `restored from cache for ${pluginHash} (theme=${theme}, menu=${menu})`)
}

/**
 * Checks whether the shared cache exists for a given plugin hash
 * @param {String} cacheRoot Root cache directory
 * @param {String} pluginHash Hash of installed plugins
 * @return {Promise<Boolean>}
 */
export async function hasSharedCache (cacheRoot, pluginHash) {
  try {
    await fs.access(path.join(cacheRoot, pluginHash))
    return true
  } catch {
    return false
  }
}

/**
 * Populates only the shared (plugin-hash-keyed) portion of the cache,
 * skipping CSS/theme-specific entries. Used by the eager cache prebuild.
 * @param {String} buildOutputDir The build output directory
 * @param {String} cacheRoot Root cache directory
 * @param {String} pluginHash Hash of installed plugins
 * @return {Promise}
 */
export async function populateSharedCacheOnly (buildOutputDir, cacheRoot, pluginHash) {
  const sharedDir = path.join(cacheRoot, pluginHash)
  await fs.mkdir(cacheRoot, { recursive: true })

  const tmpShared = `${sharedDir}_tmp_${Date.now()}`
  try {
    await fs.mkdir(tmpShared, { recursive: true })
    const entries = await fs.readdir(buildOutputDir)
    for (const entry of entries) {
      if (SKIP_ENTRIES.has(entry) || CSS_ENTRIES.has(entry)) continue
      await copyEntry(path.join(buildOutputDir, entry), path.join(tmpShared, entry))
    }
    await safeRename(tmpShared, sharedDir)
    log('info', 'CACHE', `populated shared cache for ${pluginHash}`)
  } catch (e) {
    await fs.rm(tmpShared, { recursive: true, force: true })
    throw e
  }
}

/**
 * Removes the entire prebuilt cache directory
 * @param {String} cacheRoot Root cache directory
 * @return {Promise}
 */
export async function invalidateCache (cacheRoot) {
  await fs.rm(cacheRoot, { recursive: true, force: true })
  log('info', 'CACHE', 'invalidated prebuilt cache')
}

/**
 * Renames src to dest atomically. If dest already exists (parallel build),
 * removes src instead since dest already has identical content.
 */
async function safeRename (src, dest) {
  try {
    await fs.rename(src, dest)
  } catch (e) {
    if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') {
      // Another build already wrote the cache — clean up our temp copy
      await fs.rm(src, { recursive: true, force: true })
    } else {
      throw e
    }
  }
}
