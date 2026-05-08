import { glob } from 'glob'
import path from 'node:path'

/**
 * Collects all migration script paths from the framework's src directory
 * @param {String} frameworkDir Absolute path to the framework directory
 * @returns {Promise<String[]>} Absolute paths to migration scripts
 */
export async function collectMigrationScripts (frameworkDir) {
  const srcDir = path.join(frameworkDir, 'src')
  return glob([
    'core/migrations/**/*.js',
    '*/*/migrations/**/*.js'
  ], { cwd: srcDir, absolute: true })
}
