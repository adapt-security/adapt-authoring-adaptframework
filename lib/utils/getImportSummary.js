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
 * @property {Object} assets Counts of assets referenced by the imported course
 * @property {Number} assets.total Total assets referenced by the course
 * @property {Number} assets.imported Assets created by this import (on a dry run, those that would be created)
 * @property {Number} assets.reused Assets matched to an existing record by content hash rather than created (on a dry run, those that would be reused)
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
    assetData,
    newAssetIds,
    reusedAssetIds,
    settings: { pluginUpdatePolicy, isDryRun }
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
      status: getPluginUpdateStatus(versions, p?.isLocalInstall, pluginUpdatePolicy),
      versions
    }
  })
  return {
    title: contentJson.course.displayTitle || contentJson.course.title,
    courseId,
    statusReport,
    content: getImportContentCounts(contentJson),
    assets: {
      total: assetData.length,
      imported: isDryRun ? Math.max(0, assetData.length - reusedAssetIds.length) : newAssetIds.length,
      reused: reusedAssetIds.length
    },
    versions
  }
}
