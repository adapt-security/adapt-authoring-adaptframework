import { AbstractModule, Hook } from 'adapt-authoring-core'
import AdaptFrameworkBuild from './AdaptFrameworkBuild.js'
import AdaptFrameworkImport from './AdaptFrameworkImport.js'
import ApiDefs from './apidefs.js'
import fs from 'fs-extra'
import FWUtils from './AdaptFrameworkUtils.js'
import path from 'path'
import semver from 'semver'
import { unzip } from 'zipper'

/**
 * Module to handle the interface with the Adapt framework
 * @memberof adaptframework
 * @extends {AbstractModule}
 */
class AdaptFrameworkModule extends AbstractModule {
  /** @override */
  async init () {
    /**
     * Location of the local Adapt framework files
     * @type {String}
     */
    this.path = this.getConfig('frameworkDir')
    /**
     * Invoked after a framework install
     * @type {Hook}
     */
    this.postInstallHook = new Hook()
    /**
     * Invoked after a framework update
     * @type {Hook}
     */
    this.postUpdateHook = new Hook()

    /**
     * Invoked prior to a course being built. The AdaptFrameworkBuild instance is passed to any observers.
     * @type {Hook}
     */
    this.preBuildHook = new Hook({ mutable: true })
    /**
     * Invoked after a course has been built. The AdaptFrameworkBuild instance is passed to any observers.
     * @type {Hook}
     */
    this.postBuildHook = new Hook({ mutable: true })
    /**
     * Content migration functions to be run on import
     * @type {Array}
     */
    this.contentMigrations = []

    const content = await this.app.waitForModule('content')
    content.accessCheckHook.tap(this.checkContentAccess.bind(this))

    this.postInstallHook.tap(this.installFrameworkModules.bind(this))
    this.postUpdateHook.tap(this.installFrameworkModules.bind(this))

    await this.installFramework()

    if (this.app.args['update-framework'] === true) {
      await this.updateFramework()
    }
    this._version = await this.runCliCommand('getCurrentFrameworkVersion')

    await Promise.all([this.loadSchemas(), this.initRoutes()])

    this.logStatus()
  }

  /**
   * Reference to AdaptFrameworkUtils#runCliCommand
   */
  get runCliCommand() {
    return FWUtils.runCliCommand
  }

  /**
   * Semver formatted version number of the local framework copy
   * @type {String}
   */
  get version () {
    return this._version
  }

  /**
   * Run npm install on framework directory to install/update any dependencies
   * @type {Promise}
   */
  async installFrameworkModules () {
    this.log('verbose', 'INSTALL_NPM_MODULES')
    try {
      await AdaptFrameworkUtils.spawnPromise('npm install')
    } catch (e) {
      this.log('error', `failed to run npm install, ${e.message}`)
      throw this.app.errors.FW_INSTALL_FAILED
    }
  }

  /**
   * Installs a local copy of the Adapt framework
   * @return {Promise}
   */
  async installFramework (version, force = false) {
    this.log('verbose', 'INSTALL')
    try {
      const modsPath = path.resolve(this.path, '..', 'node_modules')
      try {
        await fs.stat(modsPath)
        await fs.readJson(path.resolve(this.path, 'package.json'))
        if (!force) {
          this.log('verbose', 'INSTALL no action, force !== true')
          return
        }
        this.log('verbose', 'INSTALL forcing new framework install')
        await fs.remove(this.path)
      } catch (e) {
        // if src and node_modules are missing, install required
      }
      await this.runCliCommand('installFramework', { version })
      // move node_modules into place
      this.log('verbose', 'INSTALL node_modules')
      try {
        await fs.remove(modsPath)
      } catch (e) {}
      // move node_modules so it can be shared with all builds
      await fs.move(path.join(this.path, 'node_modules'), modsPath)
    } catch (e) {
      this.log('error', `failed to install framework, ${e.message}`)
      throw this.app.errors.FW_INSTALL_FAILED
    }
    this.log('verbose', 'INSTALL hook invoke')
    await this.postInstallHook.invoke()
  }

  /**
   * Updates the local copy of the Adapt framework
   * @return {Promise}
   */
  async getLatestVersion () {
    try {
      return semver.clean(await this.runCliCommand('getLatestFrameworkVersion'))
    } catch (e) {
      this.log('error', `failed to retrieve framework update data, ${e.message}`)
      throw e
    }
  }

  /**
   * Retrieves the plugins listed in the framework manifest, but not necessarily installed
   * @return {Promise}
   */
  async getManifestPlugins () {
    const manifest = await fs.readJson(path.resolve(this.path, 'adapt.json'))
    return Object.entries(manifest.dependencies)
  }

  /**
   * Retrieves the locally installed plugins
   * @return {Promise}
   */
  async getInstalledPlugins () {
    return this.runCliCommand('getInstalledPlugins')
  }

  /**
   * Updates the local copy of the Adapt framework
   * @param {string} version The version to update to
   * @return {Promise}
   */
  async updateFramework (version) {
    try {
      await this.runCliCommand('updateFramework', { version })
      this._version = await this.runCliCommand('getCurrentFrameworkVersion')
    } catch (e) {
      this.log('error', `failed to update framework, ${e.message}`)
      throw this.app.errors.FW_UPDATE_FAILED
    }
    this.postUpdateHook.invoke()
  }

  /**
   * Logs relevant framework status messages
   */
  async logStatus () {
    const current = this.version
    const latest = await this.runCliCommand('getLatestFrameworkVersion')

    this.log('info', `local adapt_framework v${current} installed`)
    if (semver.lt(current, latest)) {
      this.log('info', `a newer version of the adapt_framework is available (${latest}), pass the --update-framework flag to update`)
    }
  }

  /**
   * Loads schemas from the local copy of the Adapt framework and registers them with the app
   * @return {Promise}
   */
  async loadSchemas () {
    const jsonschema = await this.app.waitForModule('jsonschema')
    const schemas = (await this.runCliCommand('getSchemaPaths')).filter(s => s.includes('/core/'))
    await Promise.all(schemas.map(s => jsonschema.registerSchema(s)))
  }

  /**
   * Checks whether the request user should be given access to the content they're requesting
   * @param {external:ExpressRequest} req
   * @param {Object} data
   * @return {Promise} Resolves with boolean
   */
  async checkContentAccess (req, data) {
    const content = await this.app.waitForModule('content')
    let course
    if (data._type === 'course') {
      course = data
    } else {
      [course] = await content.find({ _id: data._courseId || (await content.find(data))._courseId })
    }
    if (!course) {
      return
    }
    const shareWithUsers = course?._shareWithUsers.map(id => id.toString()) ?? []
    const userId = req.auth.user._id.toString()
    return course._isShared || shareWithUsers.includes(userId)
  }

  /**
   * Initialises the module routing
   * @return {Promise}
   */
  async initRoutes () {
    const [auth, server] = await this.app.waitForModule('auth', 'server')
    /**
     * Router for handling all non-API calls
     * @type {Router}
     */
    this.rootRouter = server.root.createChildRouter('adapt')
    this.rootRouter.addRoute({
      route: '/preview/:id/{*splat}',
      handlers: {
        get: (req, res, next) => { // fail silently
          FWUtils.getHandler(req, res, e => e ? res.status(e.statusCode || 500).end() : next())
        }
      }
    })
    /**
     * Router for handling all API calls
     * @type {Router}
     */
    this.apiRouter = server.api.createChildRouter('adapt')
    this.apiRouter.addRoute(
      {
        route: '/preview/:id',
        handlers: { post: FWUtils.postHandler },
        meta: ApiDefs.preview
      },
      {
        route: '/publish/:id',
        handlers: { post: FWUtils.postHandler, get: FWUtils.getHandler },
        meta: ApiDefs.publish
      },
      {
        route: '/import',
        handlers: { post: [FWUtils.importHandler] },
        meta: ApiDefs.import
      },
      {
        route: '/export/:id',
        handlers: { post: FWUtils.postHandler, get: FWUtils.getHandler },
        meta: ApiDefs.export
      }
    )
    auth.secureRoute(`${this.apiRouter.path}/preview/:id`, 'post', ['preview:adapt'])
    auth.secureRoute(`${this.apiRouter.path}/publish/:id`, 'get', ['publish:adapt'])
    auth.secureRoute(`${this.apiRouter.path}/publish/:id`, 'post', ['publish:adapt'])
    auth.secureRoute(`${this.apiRouter.path}/import`, 'post', ['import:adapt'])
    auth.secureRoute(`${this.apiRouter.path}/export/:id`, 'get', ['export:adapt'])
    auth.secureRoute(`${this.apiRouter.path}/export/:id`, 'post', ['export:adapt'])
    auth.secureRoute(`${this.apiRouter.path}/update`, 'post', ['update:adapt'])

    if (this.getConfig('enableUpdateApi')) {
      this.apiRouter.addRoute({
        route: '/update',
        handlers: { post: FWUtils.postUpdateHandler, get: FWUtils.getUpdateHandler },
        meta: ApiDefs.update
      })
      auth.secureRoute(`${this.apiRouter.path}/update`, 'get', ['update:adapt'])
    }
  }

  registerImportContentMigration (migration) {
    if (typeof migration !== 'function') {
      return this.log('warn', `Cannot register content migration, unexpected type (${typeof migration})`)
    }
    this.contentMigrations.push(migration)
  }

  /**
   * Builds a single Adapt framework course
   * @param {AdaptFrameworkBuildOptions} options
   * @return {AdaptFrameworkBuild}
   */
  async buildCourse (options) {
    return AdaptFrameworkBuild.run(options)
  }

  /**
   * Imports a single Adapt framework course
   * @param {String} importPath Path to the course import
   * @param {String} userId _id of the new owner of the imported course
   * @return {AdaptFrameworkImportSummary}
   */
  async importCourse (importPath, userId) {
    let unzipPath = importPath
    if (importPath.endsWith('.zip')) {
      unzipPath = `${importPath}_unzip`
      await unzip(importPath, unzipPath, { removeSource: true })
    }
    const importer = await AdaptFrameworkImport.run({ unzipPath, userId })
    return await FWUtils.getImportSummary(importer)
  }
}

export default AdaptFrameworkModule
