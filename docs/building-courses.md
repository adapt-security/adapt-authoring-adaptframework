# Building courses

The `adaptframework` module turns the content stored in the database back into an Adapt
framework course on disk, then runs the framework's own build tools over it. The same
pipeline powers three user-facing actions:

| Action | Output | Compressed | Runs grunt build |
| --- | --- | --- | --- |
| `preview` | A playable course served in-browser | No | Yes (or cache hit) |
| `publish` | A standalone course zip (no source maps) | Yes | Yes |
| `export` | A source zip (course JSON + assets + plugin list) for re-import | Yes | No |

All three are implemented by `AdaptFrameworkBuild` (`lib/AdaptFrameworkBuild.js`). The
`action` string drives the `isPreview` / `isPublish` / `isExport` flags that branch the
pipeline.

## What a "build" is

A build is one run of `AdaptFrameworkBuild.build()`. It:

1. Removes the previous build of the same `action` for the same user (`removeOldBuilds`).
2. Loads all the course's content, config, assets, tags and plugin data from the database
   (`loadCourseData`).
3. Copies the framework source (minus disabled plugins) into a fresh, timestamped build
   directory, and copies the course's assets in (`copyFrameworkSource`, `copyAssets`).
4. Applies JSON-schema defaults to the in-memory content, then writes it out as the
   Adapt `*.json` files (`applySchemaDefaults`, `writeContentJson`).
5. For `preview`/`publish`, runs the framework build tools via `adapt-cli`
   (`AdaptCli.buildCourse`). `export` skips this — it only emits source.
6. Optionally zips the result (`prepareZip`).
7. Records a metadata document in the `adaptbuilds` MongoDB collection
   (`recordBuildAttempt`).

The DB document (validated against `schema/adaptbuild.schema.json`) stores `action`,
`courseId`, `location` (the on-disk path of the build or zip), `expiresAt`, `createdBy`,
and a `versions` map of `adapt_framework` + every enabled plugin and its version.

## REST endpoints

Routes are declared in `routes.json` under the `adapt` API root, so the full paths are
`/api/adapt/...`. Each action is two steps: a `POST` that runs the build and returns a
URL, then a `GET` against that URL to fetch the result.

| Method + route | Permission | Handler |
| --- | --- | --- |
| `POST /api/adapt/preview/:id` | `preview:adapt` | `postHandler` |
| `POST /api/adapt/publish/:id` | `publish:adapt` | `postHandler` |
| `GET  /api/adapt/publish/:id` | `publish:adapt` | `getHandler` |
| `POST /api/adapt/export/:id`  | `export:adapt`  | `postHandler` |
| `GET  /api/adapt/export/:id`  | `export:adapt`  | `getHandler` |
| `POST /api/adapt/import`      | `import:adapt`  | `importHandler` |
| `GET/POST /api/adapt/update`  | `update:adapt`  | `getUpdateHandler` / `postUpdateHandler` |

`:id` on the `POST` routes is the **course** `_id`. On the `GET` routes it is the
**build** `_id` returned by the matching `POST`. The action is inferred from the URL by
`inferBuildAction` (the first path segment), so a single `postHandler` serves all three.

### POST response shape

`postHandler` calls `framework.buildCourse({ action, courseId, userId })` and responds
with an `<action>_url` key plus the build's `versions` map:

```jsonc
// POST /api/adapt/publish/64f0...c1
{
  "publish_url": "http://localhost/api/adapt/publish/65a1...e9/",
  "versions": { "adapt_framework": "5.43.1", "adapt-contrib-text": "7.2.0", ... }
}
```

The key name tracks the action — `preview_url`, `publish_url` or `export_url`. The URL's
final segment is the **build** `_id`. Previews resolve against the root router
(`framework.rootRouter.url`, i.e. `/adapt/...`), everything else against the API router.

### GET — fetching the result

- **publish / export**: `getHandler` sets `content-disposition: attachment` with a
  filename slugified from the course title and streams the zip from `buildData.location`.
- **preview**: serves files out of the build directory. `GET .../preview/:id/` returns
  `index.html`; any deeper path (`.../preview/:id/adapt/js/...`) maps to the corresponding
  file under the build. Preview requires an authenticated user — `getHandler` returns
  `MISSING_AUTH_HEADER` otherwise. The preview route is registered on the **root** router
  (note the `getHandler` wrapper in `initRoutes` fails silently to a bare status code).

A build is only retrievable until `expiresAt`. After that `getHandler` returns
`FW_BUILD_NOT_FOUND` (404). Lifespan is set by the `buildLifespan` config (default `7d`).

## The build pipeline and where output goes

Output goes under the `buildDir` config directory (default `$TEMP/framework-builds`):

```
<buildDir>/
  <timestamp>_<rand>/        # one per build (preview uncompressed lives here)
    build/                   # the compiled course; preview serves from here
      course/<lang>/*.json   # course.json, contentObjects.json, articles.json, ...
      course/<lang>/assets/  # copied assets
  <timestamp>_<rand>.zip     # publish/export output (source dir removed after zipping)
  cache/<courseId>           # adapt-cli per-course compilation cache
  prebuilt-cache/            # shared preview cache (see below)
```

Content JSON is split into `course.json`, `config.json`, `contentObjects.json` (pages and
menus), `articles.json`, `blocks.json`, `components.json`, written into a per-language
directory. `sortContentItems` rebuilds the framework's expected ordering from
`_sortOrder`/`_parentId`; `transformContentItems` swaps DB `ObjectId`s for `_friendlyId`s,
rewrites asset `_id`s to relative `course/...` paths, and nests plugin globals under
`_extensions` etc. as the framework expects.

For `export`, `writeContentJson` additionally emits an `assets.json` manifest (title,
description, filename, tags) and the asset binaries, so the zip round-trips through import.

## Adapt framework + adapt-cli integration

The module never shells out to the framework directly — it consumes `adapt-cli`
(`package.json` depends on `adapt-cli`) in two ways:

- **Framework lifecycle** via `runCliCommand` (`lib/utils/runCliCommand.js`), a thin
  wrapper that injects `cwd: frameworkDir`, `repository: frameworkRepository` and a logger,
  then calls the named `AdaptCli` method. Used for `installFramework`, `updateFramework`,
  `getCurrentFrameworkVersion`, `getLatestFrameworkVersion`, `getInstalledPlugins`,
  `getSchemaPaths`. Unknown commands throw `FW_CLI_UNKNOWN_CMD`.
- **Compilation** via `AdaptCli.buildCourse(...)` called directly in
  `AdaptFrameworkBuild.build()` with `{ cwd, sourceMaps, outputDir, cachePath, logger }`.
  `sourceMaps` is on for everything except publish. A failure throws `FW_CLI_BUILD_FAILED`
  (carrying `cmd` and `raw` output).

On startup `init()` runs `installFramework()` (a no-op if a copy already exists unless
forced), records the installed version, and loads the framework's **core** schemas into the
`jsonschema` module. The framework is installed into `frameworkDir`
(default `$TEMP/adapt_framework`). `targetVersion` in `adapt-authoring.json`
(currently `5`) constrains installs/updates to that major via `checkVersionCompatibility`;
out-of-range versions throw `FW_VERSION_NOT_ALLOWED`.

Pass `--update-framework` at startup, or `POST /api/adapt/update` (only when
`enableUpdateApi` is true), to update. Update re-installs the framework, restores plugins,
and migrates existing courses across plugin version changes.

### Preview build cache

Previews are sped up by a shared `prebuilt-cache` (`lib/BuildCache.js`). Because a preview
bundles *all* installed plugins (`getBundledPlugins` — minus inactive themes/menus), the
compiled framework output is reusable across courses keyed by `(pluginHash, theme, menu,
varsHash)`. On a cache hit, grunt is skipped: the cached `build/` is restored and only the
content JSON, assets and language manifest are written. The cache is invalidated whenever a
content plugin is inserted/updated/deleted, or the framework is updated. With
`prebuildCache: true`, every `(theme, menu)` combination is rebuilt eagerly in the
background after invalidation.

## Extension point: `preBuildHook`

`AdaptFrameworkModule` exposes a mutable `preBuildHook` (and `postBuildHook`, and a
middleware `buildHook` wrapping the whole lifecycle). The module wires its `preBuildHook`
to fire inside `AdaptFrameworkBuild` just before the content JSON is written / grunt runs;
observers receive the live `AdaptFrameworkBuild` instance:

```javascript
const framework = await this.app.waitForModule('adaptframework')

framework.preBuildHook.tap(async builder => {
  // builder.action, builder.courseId, builder.userId
  // builder.courseData.course.data — the in-memory course (mutable)
  // builder.enabledPlugins / builder.disabledPlugins
})
```

Because the hook is **mutable**, observers run in series and receive the real instance (no
deep clone), so an observer can:

- **inspect or mutate** the course data before it is written
  (`builder.courseData.<type>.data`); useful for last-mile transforms; or
- **block the build** by throwing — the error rejects `build()`, which rejects the
  originating `POST` and surfaces to the client. This is the seam a pre-build validation
  module uses to refuse a build (e.g. empty containers, missing tracking IDs) before any
  framework work happens.

> The hook fires on the cache-hit path too, so observers run on every preview, not only on
> a full compile. Avoid heavy work; keep validation/mutation cheap and idempotent.

`postBuildHook` fires after the output (and zip) is in place but before the response, with
the same instance — `builder.location` is then populated.

## Configuration

From `conf/config.schema.json`, namespaced `adapt-authoring-adaptframework.*`:

| Key | Default | Purpose |
| --- | --- | --- |
| `buildDir` | `$TEMP/framework-builds` | Where builds, zips and caches are written |
| `frameworkDir` | `$TEMP/adapt_framework` | Local framework source install location |
| `frameworkRepository` | _(unset)_ | Git repo URL the framework is installed from |
| `buildLifespan` | `7d` | How long a build stays retrievable before 404 |
| `enableUpdateApi` | `true` | Gate the `GET`/`POST /api/adapt/update` routes |
| `prebuildCache` | `false` | Eagerly warm the shared preview cache in the background |
| `importMaxFileSize` | `1gb` | Max upload size for course import |

`targetVersion` is **not** a config option — it lives in `adapt-authoring.json` under
`framework.targetVersion` and pins the supported framework major version.
