import fs from 'node:fs/promises'
import path from 'upath'

/**
 * Applies @@placeholder substitutions in index.html
 * @param {String} buildDir The build output directory
 * @param {Object} data Replacement values
 * @param {String} data.defaultLanguage The default language code
 * @param {String} data.defaultDirection The default text direction
 * @param {String} data.buildType The build type (e.g. 'development')
 * @param {Number} data.timestamp The build timestamp
 * @return {Promise}
 */
export async function applyBuildReplacements (buildDir, { defaultLanguage, defaultDirection, buildType, timestamp }) {
  const indexPath = path.join(buildDir, 'index.html')
  let html = await fs.readFile(indexPath, 'utf8')
  html = html
    .replace(/@@config\._defaultLanguage/g, defaultLanguage)
    .replace(/@@config\._defaultDirection/g, defaultDirection)
    .replace(/@@build\.type/g, buildType)
    .replace(/@@build\.timestamp/g, String(timestamp))
  await fs.writeFile(indexPath, html)
}
