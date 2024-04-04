import { App } from 'adapt-authoring-core'
import fs from 'fs-extra'
import { glob } from 'glob'
import octopus from 'adapt-octopus'
import path from 'upath'
import semver from 'semver'
import _ from 'lodash'

import ComponentTransform from './migrations/component.js'
import ConfigTransform from './migrations/config.js'
import GraphicSrcTransform from './migrations/graphic-src.js'
import NavOrderTransform from './migrations/nav-order.js'
import ParentIdTransform from './migrations/parent-id.js'
import RemoveUndefTransform from './migrations/remove-undef.js'

const ContentMigrations = [
  ComponentTransform,
  ConfigTransform,
  GraphicSrcTransform,
  NavOrderTransform,
  ParentIdTransform,
  RemoveUndefTransform
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
   * @property {String} unzipPath
   * @property {String} userId
   * @property {Boolean} importContent
   * @property {Boolean} importPlugins
   * @property {Boolean} updatePlugins
   *
   * @constructor
   * @param {AdaptFrameworkImportOptions} options
   */
  constructor ({ unzipPath, userId, assetFolders, tags, isDryRun, importContent = true, importPlugins = true, updatePlugins = false }) {
    try {
      if (!unzipPath || !userId) throw new Error()
      /**
       * Reference to the package.json data
       * @type {Object}
       */
      this.pkg = undefined
      /**
       * Path that the import will be unzipped to
       * @type {String}
       */
      this.unzipPath = unzipPath
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
      this.tags = tags
      /**
       * Path to the import course folder
       * @type {String}
       */
      this.coursePath = undefined
      /**
       * A cache of the import's content JSON file data (note this is not the DB data used by the application)
       * @type {Object}
       */
      this.contentJson = {
        config: null,
        courseObjects: [],
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
       * Contains non-fatal infomation messages regarding import status which can be return as response data. Fatal errors are thrown in the usual way.
       * @type {Object}
       */
      this.statusReport = {
        info: [],
        warn: []
      }
      /**
       * User-defined settings related to what is included with the import
       * @type {Object}
       */
      this.settings = {
        isDryRun,
        importContent,
        importPlugins,
        updatePlugins
      }
      this.isUpdate = null
      this.referenceCourse = null
      this.referenceContent = null
      this.courseLastUpdated = null
      this.courseLastUpdatedBy = null
    } catch (e) {
      throw App.instance.errors.FW_IMPORT_INVALID_COURSE
    }
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

      await this.prepare()
      this.framework.log('debug', 'preparation tasks completed successfully')

      await this.loadAssetData()
      await this.loadCourseData()
      await this.checkCourseData()

      if (this.settings.importContent) {
        await this.importTags()
        await this.importCourseAssets()
        this.framework.log('debug', 'imported course assets successfully')
      }

      if (this.isUpdate) await this.getLastModifiedData()

      if (this.settings.importPlugins) {
        await this.importCoursePlugins()
        this.framework.log('debug', 'imported course plugins successfully')
      }
      if (!this.settings.isDryRun && this.settings.importContent) {
        const courseId = this.referenceCourse._courseId

        try {
          if (this.isUpdate) {
            const lock = await content.getLock(new Date().toISOString(), this.userId, courseId)

            if (!lock) {
              throw App.instance.CONCURRENT_EDIT
            }
          }

          await this.importCourseData()
          await content.releaseLock(courseId)
        } catch (e) {
          content.releaseLock(courseId)
          throw e
        }

        this.framework.log('debug', 'imported course data successfully')
      }
    } catch (e) {
      const course = this.referenceCourse
      const courseTitle = course && (course.title || course.displayTitle)
      const data = {
        result: e.meta.description,
        ...(courseTitle && { courseTitle }),
        ...(e.data?.data && { data: e.data.data }),
        ...(e.data?.errors && { errors: e.data.errors })
      }
      error = App.instance.errors.COURSE_DATA.setData({ data: JSON.stringify(data) })
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
    try { // if it's a nested zip, move everything up a level
      const files = await fs.readdir(this.unzipPath)
      if (files.length === 1) {
        const nestDir = `${this.unzipPath}/${files[0]}`
        await fs.stat(`${nestDir}/package.json`)
        const newDir = path.join(`${this.unzipPath}_2`)
        await fs.move(nestDir, newDir)
        await fs.remove(this.unzipPath)
        this.unzipPath = newDir
      }
    } catch (e) {
      // nothing to do
    }
    // find and store the course data path, trying several possible package structures
    await Promise.allSettled([
      `${this.unzipPath}/src/course`,
      `${this.unzipPath}/build/course`,
      `${this.unzipPath}/course`
    ].map(async f => {
      await fs.stat(f)
      this.coursePath = f
    }))
    if (!this.coursePath) {
      throw App.instance.errors.FW_IMPORT_MISSING_COURSE_PATH
    }

    /* try {
      this.pkg = await fs.readJson(`${this.unzipPath}/package.json`)
    } catch (e) {}

    await this.convertSchemas() */

    return Promise.allSettled([
      // allow update to be 'build only' (no package.json)
      fs.readJson(`${this.unzipPath}/package.json`).then(p => { this.pkg = p }),
      this.convertSchemas()
    ])
  }

  /**
   * Converts all properties.schema files to a valid JSON schema format
   * @return {Promise}
   */
  async convertSchemas () {
    return octopus.runRecursive({
      cwd: this.unzipPath,
      logger: { log: (...args) => this.framework.log('debug', ...args) }
    })
  }

  /**
   * Loads and caches all asset data either manually or using the assets.json file
   * @return {Promise}
   */
  async loadAssetData () {
    this.assetData = []
    const metaFiles = await glob(`${this.coursePath}/*/assets.json`, { absolute: true })
    if (metaFiles.length) { // process included asset metadata
      await Promise.all(metaFiles.map(async f => {
        const metaJson = await fs.readJson(f)
        Object.entries(metaJson).forEach(([filename, metadata]) => this.assetData.push({ filename, ...metadata }))
      }))
    } else { // process the file metadata manually
      const assetFiles = await glob(`${this.coursePath}/*/*/*`, { absolute: true })
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
   * Loads and caches all course content
   * @return {Promise}
   */
  async loadCourseData () {
    const usedPluginPaths = await glob(`${this.unzipPath}/src/+(components|extensions|menu|theme)/*`, { absolute: true })

    await Promise.all(usedPluginPaths.map(async p => {
      const { name, version, targetAttribute } = await fs.readJson(`${p}/bower.json`)
      const pluginName = path.basename(p)
      this.usedContentPlugins[pluginName] = { name, path: p, version, targetAttribute }
    }))

    const courseSubfolders = await fs.readdir(this.coursePath, { withFileTypes: true })
    this.languages = courseSubfolders.filter(i => i.isDirectory()).map(i => i.name)

    try {
      await this.loadContentFile(`${this.coursePath}/config.json`)
    } catch (e) {
      throw App.instance.errors.FW_IMPORT_MISSING_CONFIG
    }

    for (let i = 0; i < this.languages.length; i++) {
      const lang = this.languages[i]
      const files = await glob(`${this.coursePath}/${lang}/**/*.json`)
      await Promise.all(files.map(f => this.loadContentFile(f, lang)))
    }
    /*
    importContentObject uses transformData: the parent-id migration is using idMap to change _parentId to mongo id. the idMap is not language-aware e.g. there is idMap['a-05'] which maps to the mongo id of en a-05. French a-05 is told its parent is english co-05 so content::insert overwrites its fr _lang with en
    */
  }

  /**
   * Loads a single content JSON file, providing each model therein with the appropriate language string (with the exception of config.json).
   * @return {Promise}
   */
  async loadContentFile (filePath, lang) {
    const contents = await fs.readJson(filePath)
    if (contents._type === 'course') {
      contents._lang = lang
      this.contentJson.courseObjects.push(contents)
      return
    }
    if (path.basename(filePath) === 'config.json') {
      this.contentJson.config = {
        _id: 'config',
        _type: 'config',
        _enabledPlugins: Object.keys(this.usedContentPlugins),
        ...contents
      }
      return
    }
    if (Array.isArray(contents)) {
      contents.forEach(c => {
        c._lang = lang
        this.contentJson.contentObjects.push(c)
      })
    }
  }

  async getLastModifiedData () {
    const { _courseId } = this.contentJson.config
    const mongodb = await App.instance.waitForModule('mongodb')
    const [existingConfig] = await mongodb.find('content', { $and: [{ _type: 'config' }, { _courseId }] })
    const { courseLastUpdated, courseLastUpdatedBy } = existingConfig

    this.courseLastUpdated = courseLastUpdated

    if (courseLastUpdatedBy) {
      const [user] = await mongodb.find('users', { _id: courseLastUpdatedBy })
      this.courseLastUpdatedBy = `${user.firstName} ${user.lastName}`
    }
  }

  async checkCourseData () {
    if (this.contentJson.courseObjects.length === 0) throw App.instance.errors.FW_IMPORT_MISSING_COURSE
    if (!this.contentJson.config) throw App.instance.errors.FW_IMPORT_MISSING_CONFIG

    const { courseObjects, contentObjects } = this.contentJson
    const [mongodb, content] = await App.instance.waitForModule('mongodb', 'content')
    const coursesAndContent = courseObjects.concat(Object.values(contentObjects))

    // friendly IDs are stripped during export so reinstate them
    coursesAndContent.forEach(i => (i._friendlyId = i._id))

    const { _defaultLanguage: defaultLanguage } = this.contentJson.config

    // ensure there is a valid default language
    if (!content.isLang(defaultLanguage)) throw App.instance.errors.COURSE_DATA_DEFAULT_LANGUAGE

    this.referenceCourse = courseObjects.find(i => i._lang === defaultLanguage)

    // a course model for the default language must exist
    if (!this.referenceCourse) throw App.instance.errors.COURSE_DATA_MISSING_DEFAULT_LANGUAGE

    this.referenceContent = _.filter(contentObjects, { _lang: defaultLanguage })

    await content.checkCourseData(coursesAndContent, defaultLanguage)

    // note that older/framework courses may not have _courseId
    const courseId = this.referenceCourse._courseId

    let existingCourse = []

    if (courseId) {
      this.idMap.course = courseId
      existingCourse = await mongodb.find('content', { _courseId: courseId })
    }

    this.isUpdate = existingCourse.length > 0

    if (!this.isUpdate) {
      if (!this.pkg) throw App.instance.errors.FW_IMPORT_MISSING_PACKAGE

      if (!semver.satisfies(this.pkg.version, semver.major(this.framework.version).toString())) {
        throw App.instance.errors.FW_IMPORT_INCOMPAT
          .setData({ installed: this.pkg.version, import: this.framework.version })
      }
    }
  }

  /**
   * Imports any specified tags
   * @return {Promise}
   */
  async importTags () {
    const tags = await App.instance.waitForModule('tags')
    const existingTagMap = (await tags.find()).reduce((memo, t) => Object.assign(memo, { [t.title]: t._id.toString() }), {})
    const newTags = []
    const course = this.referenceCourse
    // process course tags
    course?.tags?.forEach(t => {
      if (!existingTagMap[t]) newTags.push(t)
      this.tags.push(t)
    })
    // determine any new asset tags
    this.assetData.forEach(a => {
      a.tags?.forEach(t => !existingTagMap[t] && newTags.push(t))
    })
    // return early on dry runs
    if (this.settings.isDryRun) {
      this.statusReport.info.push({ code: 'TAGS_IMPORTED', data: { count: newTags.length } })
      return
    }
    // insert new asset tags
    await Promise.all(newTags.map(async n => {
      const { _id } = await tags.insert({ title: n })
      existingTagMap[n] = _id.toString()
    }))
    // map tags from titles to new _ids
    this.tags = this.tags.map(t => existingTagMap[t])
    this.assetData.forEach(data => {
      data.tags = data.tags?.map(t => existingTagMap[t])
    })
    if (course.tags) {
      course.tags = course.tags.map(t => existingTagMap[t])
    }
  }

  /**
   * Imports course asset files
   * @return {Promise}
   */
  async importCourseAssets () {
    let imagesImported = this.settings.isDryRun ? this.assetData.length : 0
    await Promise.all(this.assetData.map(async data => {
      const filepath = data.filepath ?? (await glob(`${this.coursePath}/*/*/${data.filename}`, { absolute: true }))[0]
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

    if (!this.settings.updatePlugins) {
      this.statusReport.warn.push({ code: 'MANAGED_PLUGIN_UPDATE_DISABLED' })
    }
    Object.keys(this.usedContentPlugins).forEach(p => {
      const installedP = this.installedPlugins[p]
      const { version: importVersion } = this.usedContentPlugins[p]
      if (!installedP) {
        return pluginsToInstall.push(p)
      }
      if (!this.settings.updatePlugins) {
        return
      }
      const { version: installedVersion, isLocalInstall } = installedP
      if (semver.lte(importVersion, installedVersion)) {
        this.statusReport.info.push({ code: 'PLUGIN_INSTALL_NOT_NEWER', data: { name: p, installedVersion, importVersion } })
        this.framework.log('debug', `not updating '${p}@${importVersion}' during import, installed version is newer (${installedVersion})`)
        return
      }
      if (!isLocalInstall) {
        this.statusReport.warn.push({ code: 'MANAGED_PLUGIN_INSTALL_SKIPPED', data: { name: p, installedVersion, importVersion } })
        this.framework.log('debug', `cannot update '${p}' during import, plugin managed via UI`)
      }
      pluginsToUpdate.push(p)
    })
    if (pluginsToInstall.length) {
      if (!this.settings.importPlugins) {
        if (this.settings.isDryRun) return this.statusReport.error.push({ code: 'MISSING_PLUGINS', data: pluginsToInstall })
        throw App.instance.errors.FW_IMPORT_MISSING_PLUGINS
          .setData({ plugins: pluginsToInstall.join(', ') })
      }
      const errors = []
      await Promise.all([...pluginsToInstall, ...pluginsToUpdate].map(async p => {
        try {
          // try and infer a targetAttribute if there isn't one
          const pluginBowerPath = path.join(this.usedContentPlugins[p].path, 'bower.json')
          const bowerJson = await fs.readJson(pluginBowerPath)
          if (!bowerJson.targetAttribute) {
            bowerJson.targetAttribute = `_${bowerJson.component || bowerJson.extension || bowerJson.menu || bowerJson.theme}`
            await fs.writeJson(pluginBowerPath, bowerJson, { spaces: 2 })
          }
          if (!this.settings.isDryRun) {
            const [pluginData] = await this.contentplugin.installPlugins([[p, this.usedContentPlugins[p].path]], { strict: true })
            this.newContentPlugins[p] = pluginData
          }
          this.statusReport.info.push({ code: 'INSTALL_PLUGIN', data: { name: p, version: bowerJson.version } })
        } catch (e) {
          if (e.code !== 'EEXIST') {
            this.framework.log('error', 'PLUGIN_IMPORT_FAILED', p, e)
            errors.push({ plugin: p, error: e.data.errors[0] })
          } else {
            errors.push(e)
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
  }

  /**
   * Imports all course content data
   * @return {Promise}
   */
  async importCourseData () {
    return this.isUpdate ? this.importExistingCourse() : this.importNewCourse()
  }

  async importExistingCourse () {
    /**
     * At this point the import data has been verified as having a valid peer structure
     * The import replaces the existing in entirity
     * This means effecively the existing course is deleted and the import is inserted as new
     */

    const mongodb = await App.instance.waitForModule('mongodb')
    const existingRefCourse = await mongodb.find('content', { _type: 'course', _courseId: this.referenceCourse._courseId })

    await this.content.delete({ _id: existingRefCourse._id })
    await this.importNewCourse()
  }

  async importNewCourse () {
    /**
     * Note: the execution order is important here
     * - config requires course to exist
     * - Defaults cannot be applied until the config exists
     * - Everything else requires course + config to exist
     */

    let shouldCreateConfig = true
    let configDoc

    const doImportForLanguage = async lang => {
      const { config, courseObjects, contentObjects } = this.contentJson
      const courseObject = courseObjects.find(i => i._lang === lang)
      const courseContent = contentObjects.filter(i => i._lang === lang)
      const courseDoc = await this.importContentObject({ ...courseObject, tags: this.tags })

      if (shouldCreateConfig) {
        configDoc = await this.importContentObject(config)
      }

      // we need to run an update with the same data to make sure all extension schema settings are applied
      await this.importContentObject({ _id: courseDoc._id }, { isUpdate: true })

      if (shouldCreateConfig) {
        await this.importContentObject({ ...config, _id: configDoc._id }, { isUpdate: true })
      }

      shouldCreateConfig = false

      const { sorted, hierarchy } = await this.getSortedData(courseObject, courseContent)
      const errors = []
      for (const ids of sorted) {
        for (const _id of ids) {
          try {
            const itemJson = courseContent.find(i => i._id === _id)
            await this.importContentObject({
              _sortOrder: hierarchy[itemJson._parentId].indexOf(_id) + 1,
              ...itemJson // note that JSON sort order will override the deduced one
            })
          } catch (e) {
            errors.push(e?.data?.schemaName
              ? `${e.data.schemaName} ${_id} ${e.data.errors}`
              : App.instance.lang.translate(undefined, e)
            )
          }
        }
      }
      if (errors.length) throw App.instance.errors.FW_IMPORT_CONTENT_FAILED.setData({ errors: errors.join('; ') })

      this.idMap = { course: this.idMap.course }
    }

    for (let i = 0; i < this.languages.length; i++) {
      // the idMap is not language-aware so import languages sequentially
      await doImportForLanguage(this.languages[i])
    }
  }

  /**
   * Sorts the import content objects into a 2D array separating each 'level' of siblings to allow processing without the need to work out whether the parent object exists.
   * sorted is a hierarchically ordered array e.g. [['co-05'], ['a-05'], ['b-05'], ['c-05']]
   * hierarchy is a map of children e.g. {'a-05': ['b-05'], 'b-05': ['c-05'], 'co-05': ['a-05']}
   * @returns {Array<Array<String>>} The sorted list
   */
  getSortedData (courseObject, courseContent) {
    const sorted = [[courseObject._id]]
    const hierarchy = courseContent.reduce((h, c) => {
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
      this.framework.log('error', `failed to extract asset data for attribute '${e.attribute}' of schema '${schemaName}', ${e}`)
    }
    insertData = await schema.sanitise(insertData)
    let doc
    const opts = { schemaName, validate: true, useCache: false }
    if (options.isUpdate) {
      doc = await this.content.update({ _id: data._id }, insertData, opts)
    } else {
      doc = await this.content.insert(insertData, {
        ...opts,
        shouldCreatePeers: false,
        shouldSetFriendlyId: false
      })
      this.idMap[data._id] = doc._id.toString()
      if (!this.idMap.course && doc._type === 'course') this.idMap.course = this.idMap[data._id]
    }
    return doc
  }

  /**
   * Performs custom data transforms prior to import
   * @param {Object} data Data to transform
   * @return {Promise} Resolves with the transformed data
   */
  async transformData (data) {
    for (const Migration of ContentMigrations) await Migration(data, this)
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
          ? data[key] = this.assetMap[data[key]]
          : delete data[key]
      }
    })
  }

  /**
   * Performs necessary clean-up tasks
   * @param {Error|Boolean} error If param is truthy, extra error-related clean-up tasks are performed
   * @return {Promise}
   */
  async cleanUp (error) {
    try {
      const tasks = [
        fs.remove(this.unzipPath)
      ]
      if (error) {
        tasks.push(
          Promise.all(Object.values(this.newContentPlugins).map(p => this.contentplugin.uninstallPlugin(p._id))),
          Promise.all(Object.values(this.assetMap).map(a => this.assets.delete({ _id: a })))
        )
        let _courseId
        try {
          const { ObjectId } = await App.instance.waitForModule('mongodb')
          _courseId = ObjectId.parse(this.idMap.course)
        } catch (e) {}
        // TODO: determine a strategy if an update fails
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
}

export default AdaptFrameworkImport
