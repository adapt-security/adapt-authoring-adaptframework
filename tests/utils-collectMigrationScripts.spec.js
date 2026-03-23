import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { collectMigrationScripts } from '../lib/utils/collectMigrationScripts.js'

describe('collectMigrationScripts()', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-mig-'))
    const srcDir = path.join(tmpDir, 'src')
    await fs.mkdir(path.join(srcDir, 'core', 'migrations'), { recursive: true })
    await fs.mkdir(path.join(srcDir, 'components', 'adapt-contrib-text', 'migrations'), { recursive: true })

    await fs.writeFile(path.join(srcDir, 'core', 'migrations', '6.24.2.js'), '// core migration')
    await fs.writeFile(path.join(srcDir, 'components', 'adapt-contrib-text', 'migrations', '5.0.1.js'), '// text migration')
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true })
  })

  it('should find core and plugin migration scripts', async () => {
    const scripts = await collectMigrationScripts(tmpDir)
    assert.equal(scripts.length, 2)
    assert.ok(scripts.some(s => s.includes('core/migrations/6.24.2.js')))
    assert.ok(scripts.some(s => s.includes('adapt-contrib-text/migrations/5.0.1.js')))
  })

  it('should return absolute paths', async () => {
    const scripts = await collectMigrationScripts(tmpDir)
    scripts.forEach(s => assert.ok(path.isAbsolute(s)))
  })

  it('should return empty array when no migration scripts exist', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-nomig-'))
    await fs.mkdir(path.join(emptyDir, 'src'), { recursive: true })
    const scripts = await collectMigrationScripts(emptyDir)
    assert.deepEqual(scripts, [])
    await fs.rm(emptyDir, { recursive: true })
  })
})
