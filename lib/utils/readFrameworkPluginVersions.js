import { readJson } from 'adapt-authoring-core'
import { glob } from 'glob'
import path from 'node:path'

/**
 * Reads bower.json files from the framework's src directory to build a list of plugin names and versions
 * @param {String} frameworkDir Absolute path to the framework directory
 * @returns {Promise<Array<{name: String, version: String}>>}
 */
export async function readFrameworkPluginVersions (frameworkDir) {
  const srcDir = path.join(frameworkDir, 'src')
  const bowerPaths = await glob([
    'core/bower.json',
    '{components,extensions,menu,theme}/*/bower.json'
  ], { cwd: srcDir, absolute: true })
  const plugins = await Promise.all(bowerPaths.map(async p => {
    const { name, version } = await readJson(p)
    return { name, version }
  }))
  return plugins
}
