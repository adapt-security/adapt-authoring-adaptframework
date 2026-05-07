import _ from 'lodash'
import { App, Hook, ensureDir, writeJson } from 'adapt-authoring-core'
import { parseObjectId } from 'adapt-authoring-mongodb'
import { createWriteStream } from 'node:fs'
import AdaptCli from 'adapt-cli'
import { log, logDir, logMemory, copyFrameworkSource, generateLanguageManifest, applyBuildReplacements } from './utils.js'
import BuildCache from './BuildCache.js'
import fs from 'node:fs/promises'
import path from 'upath'
import semver from 'semver'
import zipper from 'zipper'

/**
 * Encapsulates all behaviour needed to build a single Adapt course instance
 * @memberof adaptframework
 */
class AdaptFrameworkBuild {
  /**
   * Imports a course zip to the database
   * @param {AdaptFrameworkBuildOptions} options
   * @return {Promise} Resolves to this AdaptFrameworkBuild instance
   */
  static async run (options) {
    return new AdaptFrameworkBuild(options).build()
  }

  /**
   * Returns a timestring to be used for an adaptbuild expiry
   * @return {String}
   */
  static async getBuildExpiry () {
    const framework = await App.instance.waitForModule('adaptframework')
    return new Date(Date.now() + framework.getConfig('buildLifespan')).toISOString()
  }

  /**
   * Options to be passed to AdaptFrameworkBuild
   * @typedef {Object} AdaptFrameworkBuildOptions
   * @property {String} action The type of build to execute
   * @property {String} courseId The course  to build
   * @property {String} userId The user executing the build
   * @property {String} expiresAt When the build expires
   * @property {Boolean} compress Whether output files should be compressed into an archive file
   * @property {String} outputDir If set, uses this as the build root. If the directory already exists, only content data and assets are written (framework copy and compilation are skipped)
   *
   * @constructor
   * @param {AdaptFrameworkBuildOptions} options
   */
  constructor ({ action, courseId, userId, expiresAt, compress, outputDir }) {
    /**
     * The MongoDB collection name
     * @type {String}
     */
    this.collectionName = 'adaptbuilds'
    /**
     * The build action being performed
     * @type {String}
     */
    this.action = action
    /**
     * Shorthand for checking if this build is a preview
     * @type {Boolean}
     */
    this.isPreview = action === 'preview'
    /**
     * Shorthand for checking if this build is a publish
     * @type {Boolean}
     */
    this.isPublish = action === 'publish'
    /**
     * Shorthand for checking if this build is an export
     * @type {Boolean}
     */
    this.isExport = action === 'export'
    /**
     * Whether the final output directory should be compressed
     * @type {Boolean}
     */
    this.compress = compress ?? !this.isPreview
    /**
     * The _id of the course being build
     * @type {String}
     */
    this.courseId = courseId
    /**
     * All JSON data describing this course
     * @type {Object}
     */
    this.expiresAt = expiresAt
    /**
     * All JSON data describing this course
     * @type {Object}
     */
    this.courseData = {}
    /**
     * All metadata related to assets used in this course
     * @type {Object}
     */
    this.assetData = {}
    /**
     * Metadata describing this build attempt
     * @type {Object}
     */
    this.buildData = {}
    /**
     * A map of _ids for use with 'friendly' IDs
     * @type {Object}
     */
    this.idMap = {}
    /**
     * _id of the user initiating the course build
     * @type {String}
     */
    this.userId = userId
    /**
     * The build output directory
     * @type {String}
     */
    this.dir = ''
    /**
     * The course build directory
     * @type {String}
     */
    this.buildDir = ''
    /**
     * The course content directory
     * @type {String}
     */
    this.courseDir = ''
    /**
     * The final location of the build
     * @type {String}
     */
    this.location = ''
    /**
     * List of plugins used in this course
     * @type {Array<Object>}
     */
    this.enabledPlugins = []
    /**
     * List of plugins NOT used in this course
     * @type {Array<Object>}
     */
    this.disabledPlugins = []
    /**
     * Invoked prior to a course being built.
     * @type {Hook}
     */
    this.preBuildHook = new Hook({ mutable: true })
    /**
      * Invoked after a course has been built.
      * @type {Hook}
      */
    this.postBuildHook = new Hook({ mutable: true })
    /**
     * Custom output directory. If the directory already exists, only content and assets are written
     * @type {String}
     */
    this.outputDir = outputDir ?? null
  }

  /**
  /**
   * Runs the Adapt framework build tools to generate a course build
   * @return {Promise} Resolves with the output directory
   */
  async build () {
    if (!this.outputDir) {
      await this.removeOldBuilds()
    }

    const framework = await App.instance.waitForModule('adaptframework')
    if (!this.expiresAt) {
      this.expiresAt = await AdaptFrameworkBuild.getBuildExpiry()
    }
    if (this.outputDir) {
      this.dir = this.outputDir
    } else {
      // random suffix to account for parallel builds executed at exactly the same millisecond
      const randomSuffix = `_${Math.floor(Math.random() * 1000).toString().padStart(4, '0')}`
      this.dir = path.resolve(framework.getConfig('buildDir'), Date.now() + randomSuffix)
    }
    this.buildDir = path.join(this.dir, 'build')
    this.courseDir = path.join(this.buildDir, 'course')

    const dirExists = await fs.access(this.dir).then(() => true, () => false)
    const contentOnly = this.outputDir && dirExists

    const cacheDir = path.join(framework.getConfig('buildDir'), 'cache')

    await ensureDir(this.dir)
    await ensureDir(this.buildDir)
    if (!contentOnly) {
      await ensureDir(cacheDir)
    }

    logDir('dir', this.dir)
    logDir('buildDir', this.buildDir)
    logDir('cacheDir', this.cacheDir)

    await this.loadCourseData()

    // Check for cached preview build
    if (this.isPreview && !contentOnly) {
      const cache = new BuildCache(path.join(framework.getConfig('buildDir'), 'prebuilt-cache'))
      const pluginHash = await framework.getPluginHash()
      const theme = this.courseData.config.data._theme
      const menu = this.courseData.config.data._menu

      if (await cache.has(pluginHash, theme, menu)) {
        await cache.restore(pluginHash, theme, menu, this.buildDir)
        await this.applySchemaDefaults()
        await this.copyAssets()
        await this.preBuildHook.invoke(this)
        await this.writeContentJson()
        await this.writeLanguageManifest()
        await applyBuildReplacements(this.buildDir, {
          defaultLanguage: this.courseData.config.data._defaultLanguage ?? 'en',
          defaultDirection: this.courseData.config.data._defaultDirection ?? 'ltr',
          buildType: 'development',
          timestamp: Date.now()
        })
        this.location = path.join(this.dir, 'build')
        await this.postBuildHook.invoke(this)
        this.buildData = await this.recordBuildAttempt()
        return this
      }
    }

    const tasks = [this.copyAssets()]
    if (!contentOnly) {
      // preview cache is shared across courses, so include all installed plugins
      // — except disabled themes/menus, since only one of each can be active per
      // build and the framework's less:dev task globs every theme/menu in src/,
      // which OOMs when more than one is present (see adapt_framework#3802).
      const pluginsToInclude = this.isPreview
        ? [
            ...this.enabledPlugins,
            ...this.disabledPlugins.filter(p => p.type !== 'theme' && p.type !== 'menu')
          ]
        : this.enabledPlugins
      tasks.push(copyFrameworkSource({
        destDir: this.dir,
        enabledPlugins: pluginsToInclude.map(p => p.name),
        linkNodeModules: !this.isExport
      }))
    }
    await Promise.all(tasks)

    await this.preBuildHook.invoke(this)

    await this.applySchemaDefaults()
    await this.writeContentJson()

    logDir('courseDir', this.courseDir)

    if (!contentOnly && !this.isExport) {
      try {
        logMemory()
        await AdaptCli.buildCourse({
          cwd: this.dir,
          sourceMaps: !this.isPublish,
          outputDir: this.buildDir,
          cachePath: path.resolve(cacheDir, this.courseId),
          logger: { log: (...args) => App.instance.logger.log('debug', 'adapt-cli', ...args) }
        })
        logMemory()
      } catch (e) {
        logMemory()
        throw App.instance.errors.FW_CLI_BUILD_FAILED
          .setData(e)
      }
    }
    // Populate prebuilt cache after successful grunt build for preview
    if (this.isPreview && !contentOnly) {
      const cache = new BuildCache(path.join(framework.getConfig('buildDir'), 'prebuilt-cache'))
      const pluginHash = await framework.getPluginHash()
      const theme = this.courseData.config.data._theme
      const menu = this.courseData.config.data._menu
      try {
        await cache.populate(this.buildDir, pluginHash, theme, menu)
      } catch (e) {
        log('warn', 'CACHE', `failed to populate prebuilt cache: ${e.message}`)
      }
    }
    if (this.compress) {
      this.location = await this.prepareZip()
    } else {
      this.location = this.isPreview ? path.join(this.dir, 'build') : this.dir
    }
    await this.postBuildHook.invoke(this)

    this.buildData = await this.recordBuildAttempt()

    return this
  }

  /**
   * Collects and caches all the DB data for the course being built
   * @return {Promise}
   */
  async loadCourseData () {
    const content = await App.instance.waitForModule('content')
    const course = await content.findOne({ _id: this.courseId, _type: 'course' })
    const config = await content.findOne({ _courseId: this.courseId, _type: 'config' })
    const langDir = path.join(this.courseDir, course._language ?? config._defaultLanguage ?? 'en')
    this.courseData = {
      course: { dir: langDir, fileName: 'course.json', data: undefined },
      config: { dir: this.courseDir, fileName: 'config.json', data: undefined },
      contentObject: { dir: langDir, fileName: 'contentObjects.json', data: [] },
      article: { dir: langDir, fileName: 'articles.json', data: [] },
      block: { dir: langDir, fileName: 'blocks.json', data: [] },
      component: { dir: langDir, fileName: 'components.json', data: [] }
    }
    await this.loadAssetData()
    const contentItems = [course, ...await content.find({ _courseId: course._id })]
    this.createIdMap(contentItems)
    this.sortContentItems(contentItems)
    await this.cachePluginData()
    await this.transformContentItems(contentItems)
  }

  /**
   * Processes and caches the course's assets
   * @return {Promise}
   */
  async loadAssetData () {
    const [assets, content, tags] = await App.instance.waitForModule('assets', 'content', 'tags')

    const courseContent = await content.find({ _courseId: this.courseId }, { validate: false }, { projection: { _assetIds: 1 } })
    const uniqueAssetIds = new Set(courseContent.flatMap(c => (c._assetIds ?? []).map(id => parseObjectId(id))))
    const usedAssets = await assets.find({ _id: { $in: [...uniqueAssetIds] } })

    const usedTagIds = new Set(usedAssets.reduce((m, a) => [...m, ...(a.tags ?? [])], []))
    const usedTags = await tags.find({ _id: { $in: [...usedTagIds] } })
    const tagTitleLookup = t => usedTags.find(u => u._id.toString() === t.toString()).title

    const idMap = {}
    const assetDocs = []
    const courseDir = this.courseData.course.dir

    await Promise.all(usedAssets.map(async a => {
      assetDocs.push({ ...a, tags: a?.tags?.map(tagTitleLookup) })
      if (!idMap[a._id]) idMap[a._id] = a.url ? a.url : path.join(courseDir, 'assets', a.path)
    }))
    this.assetData = { dir: courseDir, fileName: 'assets.json', idMap, data: assetDocs }
  }

  /**
   * Caches lists of which plugins are/aren't being used in this course
   * @return {Promise}
   */
  async cachePluginData () {
    const all = (await (await App.instance.waitForModule('contentplugin')).find({}))
      .reduce((m, p) => Object.assign(m, { [p.name]: p }), {})

    const _cachePluginDeps = (p, memo = {}) => {
      Object.entries(p?.pluginDependencies ?? {}).forEach(([name, version]) => {
        const p = memo[name] ?? all[name]
        const e = !p
          ? App.instance.errors.FW_MISSING_PLUGIN_DEP.setData({ name })
          : !semver.satisfies(p.version, version) ? App.instance.errors.FW_INCOMPAT_PLUGIN_DEP.setData({ name, version }) : undefined
        if (e) {
          throw e.setData({ name, version })
        }
        if (!memo[name]) {
          _cachePluginDeps(p, memo)
          memo[name] = p
        }
      })
      return memo
    }
    const enabled = (this.courseData.config.data._enabledPlugins || [])
      .reduce((plugins, name) => {
        const p = all[name]
        return Object.assign(plugins, { [name]: p, ..._cachePluginDeps(p) })
      }, {})

    Object.entries(all).forEach(([name, p]) => (enabled[name] ? this.enabledPlugins : this.disabledPlugins).push(p))
  }

  /**
   * Stores a map of friendlyId values to ObjectId _ids
   */
  createIdMap (items) {
    items.forEach(i => {
      this.idMap[i._id] = i._friendlyId
    })
  }

  /**
   * Sorts the course data into the types needed for each Adapt JSON file. Works by memoising items into an object using the relative sort order as a key used for sorting.
   * @param {Array<Object>} items The list of content objects
   */
  sortContentItems (items) {
    const getSortOrderStr = co => (co._type === 'course' ? '1' : co._sortOrder.toString()).padStart(4, '0') // note we pad to allow 9999 children
    const coMap = items.reduce((m, item) => Object.assign(m, { [item._id]: item }), {}) // object mapping items to their _id for easy lookup
    const sorted = {}
    items.forEach(i => {
      const type = i._type === 'page' || i._type === 'menu' ? 'contentObject' : i._type
      if (type === 'course' || type === 'config') {
        this.courseData[type].data = i
        return // don't sort the course or config items
      }
      if (!sorted[type]) sorted[type] = {}
      // recursively calculate a sort order which is relative to the entire course for comparison
      let sortOrder = ''
      for (let item = i; item; sortOrder = getSortOrderStr(item) + sortOrder, item = coMap[item._parentId]);
      sorted[type][sortOrder.padEnd(64, '0')] = i // pad the final string for comparison purposes
    }) // finally populate this.courseData with the sorted items
    Object.entries(sorted).forEach(([type, data]) => {
      this.courseData[type].data = Object.keys(data).sort().map(key => data[key])
    })
  }

  /**
   * Transforms content items into a format recognised by the Adapt framework
   */
  async transformContentItems (items) {
    items.forEach(i => {
      // slot any _friendlyIds into the _id field
      ['_courseId', '_parentId'].forEach(k => {
        i[k] = this.idMap[i[k]] || i[k]
      })
      if (i._friendlyId) {
        i._id = i._friendlyId
      }
      // replace asset _ids with correct paths
      const idMapEntries = Object.entries(this.assetData.idMap)
      const itemString = idMapEntries.reduce((s, [_id, assetPath]) => {
        const relPath = assetPath.replace(this.courseDir, 'course')
        return s.replace(new RegExp(_id, 'g'), relPath)
      }, JSON.stringify(i))
      Object.assign(i, JSON.parse(itemString))
      // insert expected _component values
      if (i._component) {
        i._component = this.enabledPlugins.find(p => p.name === i._component)?.targetAttribute.slice(1) ?? i._component
      }
    })
    // move globals to a nested _extensions object as expected by the framework
    this.enabledPlugins.forEach(({ targetAttribute, type }) => {
      let key = `_${type}`
      if (type === 'component' || type === 'extension') key += 's'
      const globals = this.courseData.course.data._globals
      if (!globals?.[targetAttribute]) return
      _.merge(globals, { [key]: { [targetAttribute]: globals[targetAttribute] } })
      delete globals[targetAttribute]
    })
    // map course tag values (_id -> title)
    const tags = await App.instance.waitForModule('tags')
    const course = this.courseData.course.data
    if (course?.tags?.length) {
      course.tags = (await tags.find({ $or: course.tags.map(_id => Object.create({ _id })) }))
        .map(t => t.title)
    }
  }

  /**
   * Deals with copying all assets used in this course
   * @return {Promise}
   */
  async copyAssets () {
    const assets = await App.instance.waitForModule('assets')
    return Promise.all(this.assetData.data.map(async a => {
      if (a.url) {
        return
      }
      await ensureDir(path.dirname(this.assetData.idMap[a._id]))
      const inputStream = await assets.createFsWrapper(a).read(a)
      const outputStream = createWriteStream(this.assetData.idMap[a._id])
      inputStream.pipe(outputStream)
      return new Promise((resolve, reject) => {
        inputStream.on('end', () => resolve())
        outputStream.on('error', e => reject(e))
      })
    }))
  }

  /**
   * Outputs all course data to the required JSON files
   * @return {Promise}
   */
  async writeContentJson () {
    const data = Object.values(this.courseData)
    if (this.isExport && this.assetData.data.length) {
      this.assetData.data = this.assetData.data.map(d => {
        return {
          title: d.title,
          description: d.description,
          filename: d.path,
          tags: d.tags
        }
      })
      data.push(this.assetData)
    }
    return Promise.all(data.map(async ({ dir, fileName, data }) => {
      await ensureDir(dir)
      const filepath = path.join(dir, fileName)
      const returnData = await writeJson(filepath, data)
      log('verbose', 'WRITE', filepath)
      return returnData
    }))
  }

  /**
   * Applies schema defaults to the in-memory course and config data using
   * the jsonschema module. Replicates what grunt's schema-defaults task does.
   * @return {Promise}
   */
  async applySchemaDefaults () {
    const [jsonschema, contentplugin] = await App.instance.waitForModule('jsonschema', 'contentplugin')

    const enabledPluginSchemas = this.enabledPlugins
      .reduce((m, p) => [...m, ...contentplugin.getPluginSchemas(p.name)], [])
    const extensionFilter = s => contentplugin.isPluginSchema(s) ? enabledPluginSchemas.includes(s) : true
    const getSchema = name => jsonschema.getSchema(name, { useCache: false, extensionFilter })

    // Apply defaults without running full validation (which rejects ObjectIds etc.)
    const [courseSchema, configSchema] = await Promise.all([
      getSchema('course'),
      getSchema('config')
    ])
    courseSchema.compiledWithDefaults(this.courseData.course.data)
    configSchema.compiledWithDefaults(this.courseData.config.data)

    for (const type of ['contentObject', 'article', 'block']) {
      const schemaName = type === 'contentObject' ? 'contentobject' : type
      const schema = await getSchema(schemaName)
      for (const item of this.courseData[type].data) {
        schema.compiledWithDefaults(item)
      }
    }

    const componentSchemas = {}
    for (const item of this.courseData.component.data) {
      const schemaName = `${item._component}-component`
      if (!componentSchemas[schemaName]) {
        componentSchemas[schemaName] = await getSchema(schemaName)
      }
      componentSchemas[schemaName].compiledWithDefaults(item)
    }
  }

  /**
   * Writes the language_data_manifest.js for each language dir.
   * Only needed on cache-hit builds where grunt is skipped.
   * @return {Promise}
   */
  async writeLanguageManifest () {
    const langDir = this.courseData.course.dir
    const fileNames = Object.values(this.courseData)
      .filter(d => d.dir === langDir)
      .map(d => d.fileName)
    const manifest = generateLanguageManifest(fileNames)
    await ensureDir(langDir)
    await writeJson(path.join(langDir, 'language_data_manifest.js'), manifest)
  }

  /**
   * Creates a zip file containing all files relevant to the type of build being performed
   * @return {Promise}
   */
  async prepareZip () {
    const zipPath = path.join(this.dir, this.isPublish ? 'build' : '')
    const outputPath = `${this.dir}.zip`
    await zipper.zip(zipPath, outputPath, { removeSource: true })
    return outputPath
  }

  /**
   * Stored metadata about a build attempt in the DB
   * @return {Promise} Resolves with the DB document
   */
  async recordBuildAttempt () {
    const [framework, jsonschema, mongodb] = await App.instance.waitForModule('adaptframework', 'jsonschema', 'mongodb')
    const schema = await jsonschema.getSchema('adaptbuild')
    const validatedData = schema.validate({
      action: this.action,
      courseId: this.courseId,
      location: this.location,
      expiresAt: this.expiresAt,
      createdBy: this.userId,
      versions: this.enabledPlugins.reduce((m, p) => {
        return { ...m, [p.name]: p.version }
      }, { adapt_framework: framework.version })
    })
    return mongodb.insert(this.collectionName, validatedData)
  }

  /**
   * Removes all previous builds of this.action type
   * @return {Promise}
   */
  async removeOldBuilds () {
    const mongodb = await App.instance.waitForModule('mongodb')
    const query = { action: this.action, createdBy: this.userId }
    const oldBuilds = await mongodb.find(this.collectionName, query)
    await Promise.all(oldBuilds.map(async b => {
      try {
        await fs.rm(b.location, { recursive: true })
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
      }
    }))
    return mongodb.deleteMany(this.collectionName, query)
  }
}

export default AdaptFrameworkBuild
