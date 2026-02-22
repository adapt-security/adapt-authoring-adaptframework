import { App } from 'adapt-authoring-core'
import { getPluginUpdateStatus } from './getPluginUpdateStatus.js'
import { getImportContentCounts } from './getImportContentCounts.js'

/**
 * @typedef {AdaptFrameworkImportSummary}
 * @property {String} title Course title
 * @property {String} courseId Course _id
 * @property {Object} statusReport Status report
 * @property {Object<String>} statusReport.info Information messages
 * @property {Array<String>} statusReport.warn Warning messages
 * @property {Object} content Object mapping content types to the number of items of that type found in the imported course
 * @property {Object} versions A map of plugins used in the imported course and their versions
 *
 * @param {AdaptFrameworkImport} importer The import instance
 * @return {AdaptFrameworkImportSummary} Object mapping all import versions to server installed versions
 * @example
 * {
 *   adapt_framework: [1.0.0, 2.0.0],
 *   adapt-contrib-vanilla: [1.0.0, 2.0.0]
 * }
 */
export async function getImportSummary (importer) {
  const [framework, contentplugin] = await App.instance.waitForModule('adaptframework', 'contentplugin')
  const installedPlugins = await contentplugin.find()
  const {
    pkg: { name: fwName, version: fwVersion },
    idMap: { course: courseId },
    contentJson,
    usedContentPlugins: usedPlugins,
    newContentPlugins: newPlugins,
    statusReport,
    settings: { updatePlugins }
  } = importer
  const versions = [
    { name: fwName, versions: [framework.version, fwVersion] },
    ...Object.values(usedPlugins),
    ...Object.values(newPlugins)
  ].map(meta => {
    const p = installedPlugins.find(p => p.name === meta.name)
    const versions = meta.versions ?? [p?.version, meta.version]
    return {
      name: meta.name,
      status: getPluginUpdateStatus(versions, p?.isLocalInstall, updatePlugins),
      versions
    }
  })
  return {
    title: contentJson.course.displayTitle || contentJson.course.title,
    courseId,
    statusReport,
    content: getImportContentCounts(contentJson),
    versions
  }
}
