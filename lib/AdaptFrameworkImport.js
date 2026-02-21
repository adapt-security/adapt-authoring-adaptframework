import { App, Hook, spawn, readJson, writeJson } from 'adapt-authoring-core'
import fs from 'fs/promises'
import { glob } from 'glob'
import octopus from 'adapt-octopus'
import path from 'upath'
import { randomBytes } from 'node:crypto'
import semver from 'semver'
import { unzip } from 'zipper'
import FWUtils from './AdaptFrameworkUtils.js'
import { getImportContentCounts } from './utils.js'

import ComponentTransform from './migrations/component.js'
import ConfigTransform from './migrations/config.js'
import GraphicSrcTransform from './migrations/graphic-src.js'
import NavOrderTransform from './migrations/nav-order.js'
import ParentIdTransform from './migrations/parent-id.js'
import RemoveUndefTransform from './migrations/remove-undef.js'
import StartPageTransform from './migrations/start-page.js'
import ThemeUndefTransform from './migrations/theme-undef.js'

const ContentMigrations = [
  ComponentTransform,
  ConfigTransform,
  GraphicSrcTransform,
  NavOrderTransform,
  ParentIdTransform,
  RemoveUndefTransform,
  StartPageTransform,
  ThemeUndefTransform
]

/**
 * Handles the Adapt framework import process
 * @memberof adaptframework
 */
class AdaptFrameworkImport {
  /**
   * Runs the import
   * @param {AdaptFrameworkImportOptions} options
   * @return {Promise<AdaptFrameworkImport>}
   */
  static async run (options) {
    return new AdaptFrameworkImport(options).import()
  }

  /**
   * Returns the schema to be used for a specific content type
   * @param {Object} data The content item
   * @return {String} The schema name
   */
  static typeToSchema (data) {
    switch (data._type) {
      case 'menu':
      case 'page':
        return 'contentobject'
      case 'component':
        return `${data._component}-${data._type}`
      default:
        return data._type
    }
  }

  /**
   * Options to be passed to AdaptFrameworkBuild
   * @typedef {Object} AdaptFrameworkImportOptions
   * @property {String} importPath Path to the import package
   * @property {String} userId Owner of the imported course
   * @property {String} language Language of course files to be imported (if not specified, _defaultLanguage will be used)
   * @property {Array<String>} assetFolders List of non-standard asset directories
   * @property {Array<String>} tags List of tags to apply to the course & assets
   * @property {Boolean} isDryRun Will perform a non-modifying import process and report on the changes if run in standard mode
   * @property {Boolean} importContent Whether course content will be imported (default: true)
   * @property {Boolean} importPlugins Whether content plugins not present on the server will be installed (default: true)
   * @property {Boolean} updatePlugins Whether server content plugins should be updated if newer versions exist in the import course (default: false)
   * @property {Boolean} removeSource Whether import files should be removed after the process has completed (default: true)
   *
   * @constructor
   * @param {AdaptFrameworkImportOptions} options
   */
  constructor ({ importPath, userId, language, assetFolders, tags, isDryRun, importContent = true, importPlugins = true, migrateContent = true, updatePlugins = false, removeSource = true }) {
    const e = App.instance.errors.INVALID_PARAMS
    if (!importPath) throw e.setData({ params: ['importPath'] })
    if (!userId) throw e.setData({ params: ['userId'] })
    /**
     * Reference to the package.json data
     * @type {Object}
     */
    this.pkg = undefined
    /**
     * Path of the import package
     * @type {String}
     */
    this.path = importPath.replaceAll('\\', '/')
    /**
     * Language code for the langauge to import. Used for locating course content.
     * @type {String}
     */
    this.language = language
    /**
     * List of asset folders to check
     * @type {Array<String>}
     */
    this.assetFolders = assetFolders ?? ['assets']
    /**
     * List of asset metadata
     * @type {Array}
     */
    this.assetData = []
    /**
     * List of tags to apply to the course
     * @type {Array<String>}
     */
    this.tags = tags ?? []
    /**
     * Path to the import course folder
     * @type {String}
     */
    this.coursePath = undefined
    /**
     * Path to the import course language folder
     * @type {String}
     */
    this.langPath = undefined
    /**
     * A cache of the import's content JSON file data (note this is not the DB data used by the application)
     * @type {Object}
     */
    this.contentJson = {
      course: {},
      contentObjects: []
    }
    /**
     * Key/value store of the installed content plugins
     * @type {Object}
     */
    this.usedContentPlugins = {}
    /**
     * All plugins installed during the import as a name -> metadata map
     * @type {Object}
     */
    this.newContentPlugins = {}
    /**
     * Plugins that were updated during import with their original metadata for rollback
     * @type {Object}
     */
    this.updatedContentPlugins = {}
    /**
     * Key/value store mapping old component keys to component names
     * @type {Object}
     */
    this.componentNameMap = {}
    /**
     * A key/value map of asset file names to new asset ids
     * @type {Object}
     */
    this.assetMap = {}
    /**
     * A key/value map of old ids to new ids
     * @type {Object}
     */
    this.idMap = {}
    /**
     * The _id of the user initiating the import
     * @type {String}
     */
    this.userId = userId
    /**
     * Array of tag IDs created during import for rollback
     * @type {Array<String>}
     */
    this.newTagIds = []
    /**
     * Contains non-fatal infomation messages regarding import status which can be return as response data. Fatal errors are thrown in the usual way.
     * @type {Object}
     */
    this.statusReport = {
      info: [],
      warn: []
    }
    /**
     * Summary information for the import run
     * @type {AdaptFrameworkImportSummary}
     */
    this.summary = undefined
    /**
     * User-defined settings related to what is included with the import
     * @type {Object}
     */
    this.settings = {
      isDryRun,
      importContent,
      importPlugins,
      migrateContent,
      updatePlugins,
      removeSource
    }
    /**
     * Invoked before the import process has started
     */
    this.preImportHook = new Hook()
    /**
     * Invoked once the import process has completed
     */
    this.postImportHook = new Hook()

    /**
     * plugins on import that are of a lower version than the installed version
     * @type {Array}
     */
    this.pluginsToMigrate = ['core']
  }

  /**
   * Imports a course zip to the database
   * @return {Promise} Resolves with the current import instance
   */
  async import () {
    let error
    try {
      const [
        assets,
        content,
        contentplugin,
        courseassets,
        framework,
        jsonschema
      ] = await App.instance.waitForModule('assets', 'content', 'contentplugin', 'courseassets', 'adaptframework', 'jsonschema')
      /**
       * Cached module instance for easy access
       * @type {AssetsModule}
       */
      this.assets = assets
      /**
       * Cached module instance for easy access
       * @type {ContentModule}
       */
      this.content = content
      /**
       * Cached module instance for easy access
       * @type {ContentPluginModule}
       */
      this.contentplugin = contentplugin
      /**
       * Cached module instance for easy access
       * @type {CourseAssetsModule}
       */
      this.courseassets = courseassets
      /**
       * Cached module instance for easy access
       * @type {AdaptFrameworkModule}
       */
      this.framework = framework
      /**
       * Cached module instance for easy access
       * @type {JsonSchemaModule}
       */
      this.jsonschema = jsonschema

      FWUtils.log('debug', 'IMPORT_USER', this.userId)
      FWUtils.log('debug', 'IMPORT_SETTINGS', JSON.stringify(this.settings, null, 2))

      const { isDryRun, importContent, importPlugins, migrateContent } = this.settings
      const tasks = [
        [this.prepare],
        [this.loadAssetData],
        [this.loadPluginData],
        [() => this.preImportHook.invoke(this)],
        [this.importTags, importContent],
        [this.importCourseAssets, importContent],
        [this.importCoursePlugins, isDryRun && importPlugins],
        [this.importCoursePlugins, !isDryRun && importContent],
        [this.loadCourseData, isDryRun && importContent],
        [this.migrateCourseData, !isDryRun && migrateContent],
        [this.loadCourseData, !isDryRun && importContent],
        [this.importCourseData, !isDryRun && importContent],
        [this.generateSummary]
      ]
      for (const [func, test] of tasks) {
        if (test === true || test === undefined) await func.call(this)
      }
      await this.postImportHook.invoke(this)
    } catch (e) {
      error = e
    }
    await this.cleanUp(error)
    if (error) throw error
    return this
  }

  /**
   * Performs preliminary checks to confirm that a course is suitable for import
   * @return {Promise}
   */
  async prepare () {
    if (this.path.endsWith('.zip')) {
      this.path = await unzip(this.path, `${this.path}_unzip`, { removeSource: true })
    }
    try { // if it's a nested zip, move everything up a level
      const files = await fs.readdir(this.path)
      if (files.length === 1) {
        const nestDir = `${this.path}/${files[0]}`
        await fs.stat(`${nestDir}/package.json`)
        const newDir = path.join(`${this.path}_2`)
        await fs.rename(nestDir, newDir)
        await fs.rm(this.path, { recursive: true })
        this.path = newDir
      }
    } catch (e) {
      // nothing to do
    }
    // find and store the course data path
    const courseDirs = await glob(`${this.path}/*/course`)
    if (courseDirs.length > 1) {
      this.framework.log('error', 'MULTIPLE_COURSE_DIRS', courseDirs)
      throw App.instance.errors.FW_IMPORT_INVALID_COURSE
    }
    this.coursePath = courseDirs[0]
    try {
      await this.loadContentFile(`${this.coursePath}/config.json`)
      this.language = this.language ?? this.contentJson.config._defaultLanguage
      this.langPath = `${this.coursePath}/${this.language}`
      await fs.readdir(this.langPath)
    } catch (e) {
      this.framework.log('error', e)
      throw (e?.statusCode ? e : App.instance.errors.FW_IMPORT_INVALID_COURSE.setData({ reason: e.message }))
    }
    FWUtils.logDir('unzipPath', this.path)
    FWUtils.logDir('coursePath', this.coursePath)

    try {
      /** @ignore */this.pkg = await readJson(`${this.path}/package.json`)
    } catch (e) {
      throw App.instance.errors.FW_IMPORT_INVALID.setData({ reason: e.message })
    }
    try {
      await fs.rm(`${this.path}/package-lock.json`)
    } catch (e) {}

    if (!semver.satisfies(this.pkg.version, semver.major(this.framework.version).toString())) {
      const data = { installed: this.framework.version, import: this.pkg.version }
      if (!this.settings.migrateContent) {
        throw App.instance.errors.FW_IMPORT_INCOMPAT
          .setData(data)
      }
      this.statusReport.info.push({ code: 'MIGRATE_CONTENT', data })
    }
    await this.convertSchemas()
    FWUtils.log('debug', 'preparation tasks completed successfully')
  }

  /**
   * Converts all properties.schema files to a valid JSON schema format
   * @return {Promise}
   */
  async convertSchemas () {
    return octopus.runRecursive({
      cwd: this.path,
      logger: { log: (...args) => FWUtils.log('debug', ...args) }
    })
  }

  /**
   * Writes the contents of 2-customStyles.less to course.json file. Unfortunately it's necessary to do it this way to ensure it's included in migrations.
   */
  async patchCustomStyle () {
    const [customStylePath] = await glob('**/2-customStyles.less', { cwd: this.path, absolute: true })
    const courseJsonPath = `${this.langPath}/course.json`
    if (!customStylePath) {
      return
    }
    try {
      const customStyle = await fs.readFile(customStylePath, 'utf8')
      const courseJson = await readJson(courseJsonPath)
      await writeJson(courseJsonPath, { customStyle, ...courseJson })
      FWUtils.log('info', 'patched course customStyle')
    } catch (e) {
      FWUtils.log('warn', 'failed to patch course customStyle', e)
    }
  }

  /**
   * Ensures _theme exists on the config
   */
  async patchThemeName () {
    try {
      const configJsonPath = `${this.coursePath}/config.json`
      const configJson = await readJson(configJsonPath)
      if (configJson._theme) return
      configJson._theme = Object.values(this.usedContentPlugins).find(p => p.type === 'theme').name
      await writeJson(configJsonPath, configJson)
      FWUtils.log('info', 'patched config _theme')
    } catch (e) {
      FWUtils.log('warn', 'failed to patch config _theme', e)
    }
  }

  /**
   * Loads and caches all asset data either manually or using the assets.json file
   * @return {Promise}
   */
  async loadAssetData () {
    this.assetData = []
    const metaFiles = await glob(`${this.langPath}/assets.json`, { absolute: true })
    if (metaFiles.length) { // process included asset metadata
      FWUtils.log('debug', 'processing metadata files', metaFiles)
      await Promise.all(metaFiles.map(async f => {
        const metaJson = await readJson(f)
        Object.entries(metaJson).forEach(([filename, metadata]) => this.assetData.push({ filename, ...metadata }))
      }))
    } else { // process the file metadata manually
      const assetFiles = await glob(`${this.langPath}/*/*`, { absolute: true })
      FWUtils.log('debug', 'processing asset files manually', assetFiles.length)
      this.assetData.push(...assetFiles.map(f => Object.assign({}, { title: path.basename(f), filepath: f })))
    }
    const hasGlobalTags = !!this.tags.length
    this.assetData.forEach(a => {
      if (!a.description) a.description = a.title
      if (a.tags?.length && a.tags[0].title) a.tags = a.tags.map(t => t.title) // convert from old
      if (hasGlobalTags) a.tags = this.tags.concat(a.tags ?? [])
    })
  }

  /**
   * Loads and caches all course plugins
   * @return {Promise}
   */
  async loadPluginData () {
    const usedPluginPaths = await glob(`${this.path}/src/+(components|extensions|menu|theme)/*`, { absolute: true })
    const getPluginType = pluginData => {
      for (const type of ['component', 'extension', 'menu', 'theme']) {
        if (pluginData[type] !== undefined) return type
      }
    }
    await Promise.all(usedPluginPaths.map(async p => {
      const bowerJson = await readJson(`${p}/bower.json`)
      const { name, version, targetAttribute } = bowerJson
      FWUtils.log('debug', 'found plugin', name)
      this.usedContentPlugins[path.basename(p)] = { name, path: p, version, targetAttribute, type: getPluginType(bowerJson) }
    }))
    this.contentJson.config._enabledPlugins = Object.keys(this.usedContentPlugins)
  }

  /**
   * Loads and caches all course content
   * @return {Promise}
   */
  async loadCourseData () {
    const files = await glob('**/*.json', { cwd: this.langPath, absolute: true, ignore: { ignored: p => p.name === 'assets.json' } })
    const mapped = await Promise.all(files.map(f => this.loadContentFile(f)))
    this.statusReport.info.push({ code: 'CONTENT_IMPORTED', data: getImportContentCounts(this.contentJson) })
    FWUtils.log('info', 'loaded course data successfully')
    return mapped
  }

  /**
   * Loads a single content JSON file
   * @return {Promise}
   */
  async loadContentFile (filePath) {
    let contents
    try {
      contents = await readJson(filePath)
    } catch (e) {
      if (e.constructor.name === 'SyntaxError') {
        throw App.instance.errors.FILE_SYNTAX_ERROR.setData({ path: filePath.replace(this.path, ''), message: e.message })
      }
      throw e
    }
    if (contents._type === 'course') {
      this.contentJson.course = contents
      return
    }
    if (path.basename(filePath) === 'config.json') {
      this.contentJson.config = {
        _id: 'config',
        _type: 'config',
        ...contents
      }
      return
    }
    if (Array.isArray(contents)) {
      contents.forEach(c => {
        this.contentJson.contentObjects[c._id] = c
        if (!c._type) {
          FWUtils.log('warn', App.instance.errors.FW_IMPORT_INVALID_CONTENT.setData({ item: c }))
          this.statusReport.warn.push({ code: 'INVALID_CONTENT', data: c })
        }
      })
    }
    FWUtils.log('debug', 'LOAD_CONTENT', path.resolve(filePath))
  }

  /**
   * Run grunt task
   * @return {Promise}
   */
  async runGruntMigration (subTask, { outputDir, captureDir, outputFilePath }) {
    const output = await spawn({
      cmd: 'npx',
      args: ['grunt', `migration:${subTask}`, `--outputdir=${outputDir}`, `--capturedir=${captureDir}`],
      cwd: this.frameworkPath ?? this.framework.path
    })
    if (outputFilePath) await fs.writeFile(outputFilePath, output)
  }

  /**
   * Handle migrate course data, installs adapt-migrations/capture data/adds updated scripts/migrates data
   */
  async migrateCourseData () {
    try {
      await this.patchThemeName()
      await this.patchCustomStyle()

      const migrationId = `${this.userId}-${randomBytes(4).toString('hex')}`

      const opts = {
        outputDir: path.relative(this.framework.path, path.resolve(this.coursePath, '..')),
        captureDir: path.join(`./${migrationId}-migrations`),
        outputFilePath: path.join(this.framework.path, 'migrations', `${migrationId}.txt`)
      }
      FWUtils.log('debug', 'MIGRATION_ID', migrationId)
      FWUtils.logDir('captureDir', opts.captureDir)
      FWUtils.logDir('outputDir', opts.outputDir)

      await this.runGruntMigration('capture', opts)
      await this.runGruntMigration('migrate', opts)

      await fs.rm(path.join(this.framework.path, opts.captureDir), { recursive: true })
    } catch (error) {
      FWUtils.log('error', 'Migration process failed', error)
      throw App.instance.errors.FW_IMPORT_MIGRATION_FAILED.setData({ reason: error.message })
    }
  }

  /**
   * Imports any specified tags
   * @return {Promise}
   */
  async importTags () {
    const tags = await App.instance.waitForModule('tags')
    const existingTagMap = (await tags.find()).reduce((memo, t) => Object.assign(memo, { [t.title]: t._id.toString() }), {})
    const newTags = new Set()
    const course = this.contentJson.course
    // process course tags
    course?.tags?.forEach(t => {
      if (!existingTagMap[t]) newTags.push(t)
      this.tags.push(t)
    })
    // determine any new asset tags
    this.assetData.forEach(a => {
      a.tags?.forEach(t => !existingTagMap[t] && newTags.add(t))
    })
    // return early on dry runs
    if (this.settings.isDryRun) {
      this.statusReport.info.push({ code: 'TAGS_IMPORTED', data: { count: newTags.length } })
      return
    }
    // insert new asset tags
    await Promise.all(Array.from(newTags).map(async n => {
      const { _id } = await tags.insert({ title: n })
      existingTagMap[n] = _id.toString()
      this.newTagIds.push(_id.toString())
    }))
    // map tags from titles to new _ids
    this.tags = this.tags.map(t => existingTagMap[t])
    this.assetData.forEach(data => {
      data.tags = data.tags?.map(t => existingTagMap[t])
    })
    if (course.tags) {
      course.tags = course.tags.map(t => existingTagMap[t])
    }
    FWUtils.log('debug', 'imported tags successfully')
  }

  /**
   * Imports course asset files
   * @return {Promise}
   */
  async importCourseAssets () {
    let imagesImported = this.settings.isDryRun ? this.assetData.length : 0
    await Promise.all(this.assetData.map(async data => {
      const filepath = data.filepath ?? (await glob(`${this.langPath}/*/${data.filename}`, { absolute: true }))[0]
      // remove unused filepath to avoid possible issues
      delete data.filepath
      if (this.settings.isDryRun) {
        return
      }
      try {
        const asset = await this.assets.insert({
          ...data,
          createdBy: this.userId,
          file: {
            filepath,
            originalFilename: filepath
          },
          tags: data.tags
        })
        // store the asset _id so we can map it to the old path later
        const resolved = path.relative(`${this.coursePath}/..`, filepath)
        this.assetMap[resolved] = asset._id.toString()
      } catch (e) {
        this.statusReport.warn.push({ code: 'ASSET_IMPORT_FAILED', data: { filepath } })
      }
      imagesImported++
    }))
    FWUtils.log('debug', 'imported course assets successfully')
    this.statusReport.info.push({ code: 'ASSETS_IMPORTED_SUCCESSFULLY', data: { count: imagesImported } })
  }

  /**
   * Imports course content plugins
   * @return {Promise}
   */
  async importCoursePlugins () {
    this.installedPlugins = (await this.contentplugin.find({})).reduce((m, p) => Object.assign(m, { [p.name]: p }), {})
    const pluginsToInstall = []
    const pluginsToUpdate = []

    let managedPluginUpdateBlocked = false
    Object.keys(this.usedContentPlugins).forEach(p => {
      const installedP = this.installedPlugins[p]
      let { version: importVersion } = this.usedContentPlugins[p]
      if (!semver.valid(importVersion)) {
        if (!installedP) {
          throw App.instance.errors.FW_INVALID_VERSION.setData({ name: p, version: importVersion })
        }
        this.statusReport.warn.push({ code: 'INVALID_PLUGIN_VERSION', data: { name: p, importVersion } })
        importVersion = '0.0.0' // set to a valid version to allow the other logic to run
      }
      if (!installedP) {
        return pluginsToInstall.push(p)
      }
      const { version: installedVersion, isLocalInstall } = installedP
      if (semver.lt(importVersion, installedVersion)) {
        this.statusReport.info.push({ code: 'PLUGIN_INSTALL_MIGRATING', data: { name: p, installedVersion, importVersion } })
        FWUtils.log('debug', `migrating '${p}@${importVersion}' during import, installed version is newer (${installedVersion})`)
        this.pluginsToMigrate.push(p)
        return
      }
      if (!this.settings.updatePlugins) {
        if (!isLocalInstall && semver.gt(importVersion, installedVersion)) managedPluginUpdateBlocked = true
        return
      }
      if (semver.eq(importVersion, installedVersion)) {
        this.statusReport.info.push({ code: 'PLUGIN_INSTALL_NOT_NEWER', data: { name: p, installedVersion, importVersion } })
        FWUtils.log('debug', `not updating '${p}@${importVersion}' during import, installed version is equal to (${installedVersion})`)
        return
      }
      if (!isLocalInstall) {
        this.statusReport.warn.push({ code: 'MANAGED_PLUGIN_INSTALL_SKIPPED', data: { name: p, installedVersion, importVersion } })
        FWUtils.log('debug', `cannot update '${p}' during import, plugin managed via UI`)
      }
      pluginsToUpdate.push(p)
    })
    if (managedPluginUpdateBlocked) {
      this.statusReport.warn.push({ code: 'MANAGED_PLUGIN_UPDATE_DISABLED' })
    }
    if (pluginsToInstall.length) {
      if (!this.settings.importPlugins) {
        if (this.settings.isDryRun) return this.statusReport.error.push({ code: 'MISSING_PLUGINS', data: pluginsToInstall })
        throw App.instance.errors.FW_IMPORT_MISSING_PLUGINS
          .setData({ plugins: pluginsToInstall.join(', ') })
      }
      const errors = []
      await Promise.all([...pluginsToInstall, ...pluginsToUpdate].map(async p => {
        try {
          // Store original plugin metadata for updates before overwriting
          const isUpdate = pluginsToUpdate.includes(p)
          if (isUpdate && this.installedPlugins[p]) {
            this.updatedContentPlugins[p] = this.installedPlugins[p]
          }
          // try and infer a targetAttribute if there isn't one
          const pluginBowerPath = path.join(this.usedContentPlugins[p].path, 'bower.json')
          const bowerJson = await readJson(pluginBowerPath)
          if (!bowerJson.targetAttribute) {
            bowerJson.targetAttribute = `_${bowerJson.component || bowerJson.extension || bowerJson.menu || bowerJson.theme}`
            await writeJson(pluginBowerPath, bowerJson)
          }
          if (!this.settings.isDryRun) {
            const [pluginData] = await this.contentplugin.installPlugins([[p, this.usedContentPlugins[p].path]], { strict: true })
            if (!isUpdate) {
              this.newContentPlugins[p] = pluginData
            }
          }
          this.statusReport.info.push({ code: 'INSTALL_PLUGIN', data: { name: p, version: bowerJson.version } })
        } catch (e) {
          if (e.code === 'EEXIST') {
            FWUtils.log('warn', 'PLUGIN_ALREADY_EXISTS', p)
          } else {
            FWUtils.log('error', 'PLUGIN_IMPORT_FAILED', p, e)
            errors.push({ plugin: p, error: e.data?.errors?.[0] ?? e })
          }
        }
      }))
      if (errors.length) {
        throw App.instance.errors.FW_IMPORT_PLUGINS_FAILED
          .setData({ errors: errors.map(e => App.instance.lang.translate(undefined, e)).join(', ') })
      }
    }
    this.componentNameMap = Object.values({ ...this.installedPlugins, ...this.newContentPlugins }).reduce((m, v) => {
      return { ...m, [v.targetAttribute.slice(1)]: v.name }
    }, {})
    FWUtils.log('debug', 'imported course plugins successfully')
  }

  /**
   * Imports all course content data
   * @return {Promise}
   */
  async importCourseData () {
    const formatError = e => {
      if (e?.data?.schemaName) {
        return `${e.data.schemaName}${e.data.data?._id ? ` (${e.data.data._id})` : ''}: ${e.data.errors ?? e.message}`
      }
      return e?.toString() ?? String(e)
    }
    /**
     * Note: the execution order is important here
     * - config requires course to exist
     * - Defaults cannot be applied until the config exists
     * - Everything else requires course + config to exist
     */
    try {
      const course = await this.importContentObject({ ...this.contentJson.course, tags: this.tags })
      /*  config  */ await this.importContentObject(this.contentJson.config)
      // we need to run an update with the same data to make sure all extension schema settings are applied
      await this.importContentObject({ ...this.contentJson.course, _id: course._id }, { isUpdate: true })
    } catch (e) {
      throw App.instance.errors.FW_IMPORT_CONTENT_FAILED.setData({ errors: [formatError(e)] })
    }
    const { sorted, hierarchy } = await this.getSortedData()
    const errors = []

    for (const ids of sorted) {
      for (const _id of ids) {
        try {
          const itemJson = this.contentJson.contentObjects[_id]
          await this.importContentObject({
            _sortOrder: hierarchy[itemJson._parentId].indexOf(_id) + 1,
            ...itemJson // note that JSON sort order will override the deduced one
          })
        } catch (e) {
          errors.push(formatError(e))
        }
      }
    }
    if (errors.length) throw App.instance.errors.FW_IMPORT_CONTENT_FAILED.setData({ errors })
    FWUtils.log('debug', 'imported course data successfully')
  }

  /**
   * Sorts the import content objects into a 2D array separating each 'level' of siblings to allow processing without the need to work out whether the parent object exists.
   * @returns {Array<Array<String>>} The sorted list
   */
  getSortedData () {
    const sorted = [[this.contentJson.course._id]]
    const hierarchy = Object.values(this.contentJson.contentObjects).reduce((h, c) => {
      return Object.assign(h, {
        [c._parentId]: [...(h[c._parentId] ?? []), c._id]
      })
    }, {})
    const toSort = Object.keys(hierarchy)
    while (toSort.length) {
      const newLevel = []
      sorted[sorted.length - 1].forEach(_id => {
        newLevel.push(...(hierarchy[_id] ?? []))
        toSort.splice(toSort.indexOf(_id), 1)
      })
      if (!newLevel.length) {
        throw App.instance.errors.FW_IMPORT_UNEXPECTED_STRUCTURE // level has no children, so something's gone wrong
      }
      sorted.push(newLevel)
    }
    return { sorted: sorted.slice(1), hierarchy } // remove course from sorted
  }

  /**
   * Imports a single content object
   * @return {Object} The data to be imported
   * @return {Promise} Resolves with the created document
   */
  async importContentObject (data, options = {}) {
    let insertData = await this.transformData({
      ...data,
      _id: undefined,
      _courseId: this.idMap.course,
      createdBy: this.userId
    })
    const schemaName = AdaptFrameworkImport.typeToSchema(data)
    const schema = await this.content.getSchema(schemaName, insertData)
    try {
      this.extractAssets(schema.built.properties, insertData)
    } catch (e) {
      FWUtils.log('error', `failed to extract asset data for attribute '${e.attribute}' of schema '${schemaName}', ${e}`)
    }
    insertData = await schema.sanitise(insertData)
    let doc
    const opts = { schemaName, validate: true, useCache: false }
    if (options.isUpdate) {
      doc = await this.content.update({ _id: data._id }, insertData, opts)
    } else {
      doc = await this.content.insert(insertData, opts)
      this.idMap[data._id] = doc._id.toString()
      if (doc._type === 'course') this.idMap.course = this.idMap[data._id]
    }
    return doc
  }

  /**
   * Performs custom data transforms prior to import
   * @param {Object} data Data to transform
   * @return {Promise} Resolves with the transformed data
   */
  async transformData (data) {
    const migrations = [...ContentMigrations, ...this.framework.contentMigrations]
    for (const Migration of migrations) await Migration(data, this)
    return data
  }

  /**
   * Infers the presence of any assets in incoming JSON data
   * @param {Object} schema Schema for the passed data
   * @param {Object} data Data to check
   */
  extractAssets (schema, data) {
    if (!schema) {
      return
    }
    Object.entries(schema).forEach(([key, val]) => {
      if (data[key] === undefined) {
        return
      }
      if (val.properties) {
        this.extractAssets(val.properties, data[key])
      } else if (val?.items?.properties) {
        data[key].forEach(d => this.extractAssets(val.items.properties, d))
      } else if (val?._backboneForms?.type === 'Asset' || val?._backboneForms === 'Asset') {
        data[key] !== ''
          ? data[key] = this.assetMap[data[key]] ?? data[key]
          : delete data[key]
      }
    })
  }

  /**
   * Performs necessary clean-up tasks
   * @param {Error|Boolean} error If param is truthy, extra error-related clean-up tasks are performed
   * @return {Promise}
   */
  async generateSummary () {
    this.summary = await FWUtils.getImportSummary(this)
  }

  /**
   * Performs necessary clean-up tasks
   * @param {Error|Boolean} error If param is truthy, extra error-related clean-up tasks are performed
   * @return {Promise}
   */
  async cleanUp (error) {
    if (!this.settings.removeSource) {
      return
    }
    try {
      const tasks = [fs.rm(this.path, { recursive: true })]
      if (error) {
        // Uninstall newly installed plugins
        tasks.push(Promise.all(Object.values(this.newContentPlugins).map(p => this.contentplugin.uninstallPlugin(p._id))))
        // Restore updated plugins to their original versions
        if (Object.keys(this.updatedContentPlugins).length > 0) {
          tasks.push(this.restoreUpdatedPlugins())
        }
        // Delete imported assets
        tasks.push(Promise.all(Object.values(this.assetMap).map(a => this.assets.delete({ _id: a }))))
        // Delete newly created tags
        if (this.newTagIds.length > 0) {
          const tags = await App.instance.waitForModule('tags')
          tasks.push(Promise.all(this.newTagIds.map(id => tags.delete({ _id: id }))))
        }
        let _courseId
        try {
          const { ObjectId } = await App.instance.waitForModule('mongodb')
          _courseId = ObjectId.parse(this.idMap[this.contentJson.course._id])
        } catch (e) {}
        if (_courseId) {
          tasks.push(
            this.content.deleteMany({ _courseId }),
            this.courseassets.deleteMany({ courseId: _courseId })
          )
        }
      }
      await Promise.allSettled(tasks)
    } catch (e) {} // ignore any thrown errors
  }

  /**
   * Restores plugins that were updated during import to their original versions
   * Uses ContentPluginModule's restorePluginFromBackup to restore from cached backups
   * @return {Promise}
   */
  async restoreUpdatedPlugins () {
    const pluginNames = Object.keys(this.updatedContentPlugins)
    if (pluginNames.length === 0) return Promise.resolve()

    const restoreTasks = []
    for (const [pluginName, originalMetadata] of Object.entries(this.updatedContentPlugins)) {
      FWUtils.log('info', `restoring plugin '${pluginName}' to previous version ${originalMetadata.version}`)
      restoreTasks.push(
        this.contentplugin.restorePluginFromBackup(pluginName)
          .catch(e => FWUtils.log('error', `failed to restore plugin '${pluginName}' from backup, ${e.message}`))
      )
    }
    return Promise.allSettled(restoreTasks)
  }
}

export default AdaptFrameworkImport
