import { AbstractModule, Hook, readJson } from 'adapt-authoring-core'
import AdaptFrameworkBuild from './AdaptFrameworkBuild.js'
import AdaptFrameworkImport from './AdaptFrameworkImport.js'
import fs from 'node:fs/promises'
import { getHandler, postHandler, importHandler, postUpdateHandler, getUpdateHandler } from './handlers.js'
import { loadRouteConfig, registerRoutes } from 'adapt-authoring-server'
import { runCliCommand } from './utils.js'
import path from 'node:path'
import semver from 'semver'

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
     * Invoked prior to a course being imported. The AdaptFrameworkImport instance is passed to any observers.
     * @type {Hook}
     */
    this.preImportHook = new Hook({ mutable: true })
    /**
     * Invoked after a course has been imported. The AdaptFrameworkImport instance is passed to any observers.
     * @type {Hook}
     */
    this.postImportHook = new Hook()
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

    const meta = await readJson(path.resolve(this.rootDir, 'adapt-authoring.json'))
    /**
     * The major version of the Adapt framework this module is designed to work with
     * @type {Number}
     */
    this._targetFrameworkVersion = meta.framework?.targetVersion

    const content = await this.app.waitForModule('content')
    content.accessCheckHook.tap(this.checkContentAccess.bind(this))

    await this.installFramework()

    if (this.app.args['update-framework'] === true) {
      await this.updateFramework()
    }
    this._version = await this.runCliCommand('getCurrentFrameworkVersion')

    await Promise.all([this.loadSchemas(), this.initRoutes()])

    this.logStatus()
  }

  /**
   * Reference to runCliCommand utility
   */
  get runCliCommand () {
    return runCliCommand
  }

  /**
   * Semver formatted version number of the local framework copy
   * @type {String}
   */
  get version () {
    return this._version
  }

  /**
   * The major version of the Adapt framework this module is designed to work with
   * @type {Number|undefined}
   */
  get targetFrameworkVersion () {
    return this._targetFrameworkVersion
  }

  /**
   * Returns a semver range string constrained to the target major version, or undefined if no target is set
   * @type {String|undefined}
   */
  get targetVersionRange () {
    if (this._targetFrameworkVersion === undefined) return undefined
    return `>=${this._targetFrameworkVersion}.0.0 <${this._targetFrameworkVersion + 1}.0.0`
  }

  /**
   * Checks whether the given version is compatible with the configured target major version
   * @param {string} version Semver version string to check
   * @throws If the version's major does not match the target major version
   */
  checkVersionCompatibility (version) {
    if (this._targetFrameworkVersion === undefined) return
    const major = semver.major(version)
    if (major !== this._targetFrameworkVersion) {
      throw this.app.errors.FW_VERSION_NOT_ALLOWED.setData({ version, targetMajorVersion: this._targetFrameworkVersion, allowedRange: this.targetVersionRange })
    }
  }

  /**
   * Installs a local copy of the Adapt framework
   * @return {Promise}
   */
  async installFramework (version, force = false) {
    this.log('verbose', 'INSTALL')
    try {
      try {
        await fs.readFile(path.resolve(this.path, 'package.json'))
        if (force) {
          this.log('verbose', 'INSTALL forcing new framework install')
        } else {
          return this.log('verbose', 'INSTALL no action, force !== true')
        }
        await fs.rm(this.path, { recursive: true })
      } catch (e) {
        // package is missing, an install is required
      }
      if (version) {
        this.checkVersionCompatibility(version)
      }
      await this.runCliCommand('installFramework', { version: version ?? this.targetVersionRange })
    } catch (e) {
      this.log('error', `failed to install framework, ${e.message}`)
      throw e.statusCode ? e : this.app.errors.FW_INSTALL_FAILED.setData({ reason: e.message })
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
      return semver.clean(await this.runCliCommand('getLatestFrameworkVersion', { version: this.targetVersionRange }))
    } catch (e) {
      this.log('error', `failed to retrieve framework update data, ${e.message}`)
      throw this.app.errors.FW_LATEST_VERSION_FAILED.setData({ reason: e.message })
    }
  }

  /**
   * Retrieves the plugins listed in the framework manifest, but not necessarily installed
   * @return {Promise}
   */
  async getManifestPlugins () {
    const manifest = await readJson(path.resolve(this.path, 'adapt.json'))
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
      if (version) {
        this.checkVersionCompatibility(version)
      }
      await this.runCliCommand('updateFramework', { version: version ?? this.targetVersionRange })
      this._version = await this.runCliCommand('getCurrentFrameworkVersion')
    } catch (e) {
      this.log('error', `failed to update framework, ${e.message}`)
      throw e.statusCode ? e : this.app.errors.FW_UPDATE_FAILED.setData({ reason: e.message })
    }
    this.postUpdateHook.invoke()
  }

  /**
   * Logs relevant framework status messages
   */
  async logStatus () {
    const current = this.version
    const latest = await this.getLatestVersion()

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
      course = await content.findOne({ _id: data._courseId || (await content.findOne(data, { strict: false }))?._courseId })
    }
    if (!course) {
      return
    }
    const shareWithUsers = course?._shareWithUsers.map(id => id.toString()) ?? []
    const userId = req.auth.user._id.toString()
    return course.createdBy.toString() === userId || course._isShared || shareWithUsers.includes(userId)
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
          getHandler(req, res, e => e ? res.status(e.statusCode || 500).end() : next())
        }
      }
    })
    /**
     * Router for handling all API calls
     * @type {Router}
     */
    const config = await loadRouteConfig(this.rootDir, this, {
      handlerAliases: { getHandler, postHandler, importHandler, postUpdateHandler, getUpdateHandler }
    })
    this.apiRouter = server.api.createChildRouter(config.root)
    registerRoutes(this.apiRouter, config.routes, auth)
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
    const builder = new AdaptFrameworkBuild(options)
    builder.preBuildHook.tap(() => this.preBuildHook.invoke(builder))
    builder.postBuildHook.tap(() => this.postBuildHook.invoke(builder))
    return builder.build()
  }

  /**
   * Imports a single Adapt framework course
   * @param {AdaptFrameworkImportOptions} options
   * @return {AdaptFrameworkImportSummary}
   */
  async importCourse (options) {
    const importer = new AdaptFrameworkImport(options)
    importer.preImportHook.tap(() => this.preImportHook.invoke(importer))
    importer.postImportHook.tap(() => this.postImportHook.invoke(importer))
    return importer.import()
  }
}

export default AdaptFrameworkModule
