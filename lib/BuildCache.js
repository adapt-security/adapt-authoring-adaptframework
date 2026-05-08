import fs from 'node:fs/promises'
import path from 'upath'
import { log } from './utils/log.js'

/** Build output entries that aren't cached (rebuilt per-build from course data) */
const SKIP_ENTRIES = new Set(['course'])

/**
 * Filesystem-level cache of grunt build output, keyed by (pluginHash, theme, menu).
 * One instance per cache root; methods are stateless beyond the root path.
 */
class BuildCache {
  /**
   * @param {String} cacheRoot Root cache directory
   */
  constructor (cacheRoot) {
    this.cacheRoot = cacheRoot
  }

  /**
   * @returns {String} The cache directory path for the given combo
   */
  getPath (pluginHash, theme, menu) {
    return path.join(this.cacheRoot, `${pluginHash}_${theme}_${menu}`)
  }

  /**
   * @returns {Promise<Boolean>} Whether a cached build exists for the given combo
   */
  async has (pluginHash, theme, menu) {
    try {
      await fs.access(this.getPath(pluginHash, theme, menu))
      return true
    } catch {
      return false
    }
  }

  /**
   * Copies the build output (minus per-course content) into the cache for the given combo.
   * Uses a temp dir + atomic rename for parallel safety.
   * @param {String} buildOutputDir The build output directory
   */
  async populate (buildOutputDir, pluginHash, theme, menu) {
    const cacheDir = this.getPath(pluginHash, theme, menu)
    await fs.mkdir(this.cacheRoot, { recursive: true })

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
   * @param {String} destDir Destination build directory
   */
  async restore (pluginHash, theme, menu, destDir) {
    await fs.mkdir(destDir, { recursive: true })
    await fs.cp(this.getPath(pluginHash, theme, menu), destDir, { recursive: true })
    log('info', 'CACHE', `restored from cache for ${pluginHash} (theme=${theme}, menu=${menu})`)
  }

  /**
   * Removes the entire cache root.
   */
  async invalidate () {
    await fs.rm(this.cacheRoot, { recursive: true, force: true })
    log('info', 'CACHE', 'invalidated prebuilt cache')
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

export default BuildCache
