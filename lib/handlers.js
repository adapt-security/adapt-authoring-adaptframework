import { App, toBoolean } from 'adapt-authoring-core'
import path from 'upath'
import semver from 'semver'
import { inferBuildAction, retrieveBuildData, slugifyTitle, log } from './utils.js'

/**
 * Handles GET requests to the API
 * @param {external:ExpressRequest} req
 * @param {external:ExpressResponse} res
 * @param {Function} next
 * @return {Promise}
 */
export async function getHandler (req, res, next) {
  const action = inferBuildAction(req)
  const id = req.params.id
  let buildData
  try {
    buildData = await retrieveBuildData(id)
  } catch (e) {
    return next(e)
  }
  if (!buildData || new Date(buildData.expiresAt).getTime() < Date.now()) {
    return next(App.instance.errors.FW_BUILD_NOT_FOUND.setData({ _id: id }))
  }
  if (action === 'publish' || action === 'export') {
    res.set('content-disposition', `attachment; filename="${await slugifyTitle(buildData)}.zip"`)
    return res.sendFile(path.resolve(buildData.location), e => e && next(e))
  }
  if (action === 'preview') {
    if (!req.auth.user) {
      return res.status(App.instance.errors.MISSING_AUTH_HEADER.statusCode).end()
    }
    const filePath = path.resolve(buildData.location, req.path.slice(req.path.indexOf(id) + id.length + 1) || 'index.html')
    await res.sendFile(filePath, e => {
      if (!e) return
      if (e.code === 'ENOENT') e = App.instance.errors.NOT_FOUND.setData({ type: 'file', id: filePath })
      next(e)
    })
  }
}

/**
 * Handles POST requests to the API
 * @param {external:ExpressRequest} req
 * @param {external:ExpressResponse} res
 * @param {Function} next
 * @return {Promise}
 */
export async function postHandler (req, res, next) {
  const framework = await App.instance.waitForModule('adaptframework')
  const startTime = Date.now()
  const action = inferBuildAction(req)
  const courseId = req.params.id
  const userId = req.auth.user._id.toString()

  log('info', `running ${action} for course '${courseId}' initiated by ${userId}`)
  try {
    const { isPreview, buildData } = await framework.buildCourse({ action, courseId, userId })
    const duration = Math.round((Date.now() - startTime) / 10) / 100
    log('info', `finished ${action} for course '${courseId}' in ${duration} seconds`)
    const urlRoot = isPreview ? framework.rootRouter.url : framework.apiRouter.url
    res.json({
      [`${action}_url`]: `${urlRoot}/${action}/${buildData._id}/`,
      versions: buildData.versions
    })
  } catch (e) {
    log('error', `failed to ${action} course '${courseId}'`)
    return next(e)
  }
}

/**
 * Deals with an incoming course (supports both local zip and remote URL stream)
 * @param {external:ExpressRequest} req
 * @param {external:ExpressResponse} res
 * @return {Promise}
 */
async function handleImportFile (req, res) {
  const [fw, middleware] = await App.instance.waitForModule('adaptframework', 'middleware')
  const handler = req.get('Content-Type').indexOf('multipart/form-data') === 0
    ? middleware.fileUploadParser
    : middleware.urlUploadParser
  return new Promise((resolve, reject) => {
    handler(middleware.zipTypes, { maxFileSize: fw.getConfig('importMaxFileSize'), unzip: true })(req, res, e => e ? reject(e) : resolve())
  })
}

/**
 * Handles POST /import requests to the API
 * @param {external:ExpressRequest} req
 * @param {external:ExpressResponse} res
 * @param {Function} next
 * @return {Promise}
 */
export async function importHandler (req, res, next) {
  try {
    const framework = await App.instance.waitForModule('adaptframework')
    let importPath = req.body.importPath
    if (req.get('Content-Type').indexOf('multipart/form-data') === 0) {
      await handleImportFile(req, res)
      const [course] = req.fileUpload.files.course
      importPath = course.filepath
    }
    const importer = await framework.importCourse({
      importPath,
      userId: req.auth.user._id.toString(),
      isDryRun: toBoolean(req.body.dryRun),
      assetFolders: req.body.formAssetFolders,
      tags: req.body.tags?.length > 0 ? req.body.tags?.split(',') : [],
      importContent: toBoolean(req.body.importContent),
      importPlugins: toBoolean(req.body.importPlugins),
      migrateContent: toBoolean(req.body.migrateContent),
      updatePlugins: toBoolean(req.body.updatePlugins)
    })
    res.json(importer.summary)
  } catch (e) {
    return next(e?.statusCode ? e : App.instance.errors.FW_IMPORT_FAILED.setData({ error: e }))
  }
}

/**
 * Handles POST /update requests to the API
 * @param {external:ExpressRequest} req
 * @param {external:ExpressResponse} res
 * @param {Function} next
 * @return {Promise}
 */
export async function postUpdateHandler (req, res, next) {
  try {
    log('info', 'running framework update')
    const framework = await App.instance.waitForModule('adaptframework')
    const previousVersion = framework.version
    await framework.updateFramework(req.body.version)
    const currentVersion = framework.version !== previousVersion ? framework.version : undefined
    res.json({
      from: previousVersion,
      to: currentVersion
    })
  } catch (e) {
    return next(e)
  }
}

/**
 * Handles GET /update requests to the API
 * @param {external:ExpressRequest} req
 * @param {external:ExpressResponse} res
 * @param {Function} next
 * @return {Promise}
 */
export async function getUpdateHandler (req, res, next) {
  try {
    const framework = await App.instance.waitForModule('adaptframework')
    const current = framework.version
    const latest = await framework.getLatestVersion()
    res.json({
      canBeUpdated: semver.gt(latest, current),
      currentVersion: current,
      latestCompatibleVersion: latest
    })
  } catch (e) {
    return next(e)
  }
}
