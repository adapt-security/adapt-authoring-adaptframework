import { createHash } from 'node:crypto'

/**
 * Computes a deterministic hash from the installed plugin set
 * @param {String} frameworkDir Path to the local framework installation
 * @return {Promise<String>} 16-char hex hash
 */
export async function computePluginHash (frameworkDir) {
  const { default: Project } = await import('adapt-cli/lib/integration/Project.js')
  const project = new Project({ cwd: frameworkDir })
  const deps = await project.getInstalledDependencies()
  const sorted = Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16)
}
