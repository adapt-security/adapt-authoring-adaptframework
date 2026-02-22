import { App } from 'adapt-authoring-core'
import fs from 'fs/promises'
import path from 'upath'

/**
 * Copies the framework source directory
 * @param {Object} options
 * @param {String} options.destDir The destination directory path
 * @param {Array<String>} options.enabledPlugins List of plugins to include
 * @param {Boolean} options.copyNodeModules Whether to physically copy node_modules
 * @param {Boolean} options.linkNodeModules Whether to symlink node_modules
 * @return {Promise}
 */
export async function copyFrameworkSource (options) {
  const { path: fwPath } = await App.instance.waitForModule('adaptframework')
  const BLACKLIST = ['.git', '.DS_Store', 'thumbs.db', 'course', 'migrations']
  if (options.copyNodeModules !== true) BLACKLIST.push('node_modules')

  const srcDir = path.join(fwPath, 'src')
  const enabledPlugins = options.enabledPlugins ?? []
  await fs.cp(fwPath, options.destDir, {
    recursive: true,
    filter: f => {
      f = path.normalize(f)
      const [type, name] = path.relative(srcDir, f).split('/')
      const isPlugin = f.startsWith(srcDir) && type && type !== 'core' && !!name

      if (isPlugin && !enabledPlugins.includes(name)) {
        return false
      }
      return !BLACKLIST.includes(path.basename(f))
    }
  })
  if (options.linkNodeModules !== false) await fs.symlink(`${fwPath}/node_modules`, `${options.destDir}/node_modules`, 'junction')
}
