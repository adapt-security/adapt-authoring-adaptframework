import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { readFrameworkPluginVersions } from '../lib/utils/readFrameworkPluginVersions.js'

describe('readFrameworkPluginVersions()', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-test-'))
    const srcDir = path.join(tmpDir, 'src')
    await fs.mkdir(path.join(srcDir, 'core'), { recursive: true })
    await fs.mkdir(path.join(srcDir, 'components', 'adapt-contrib-text'), { recursive: true })
    await fs.mkdir(path.join(srcDir, 'extensions', 'adapt-contrib-trickle'), { recursive: true })

    await fs.writeFile(path.join(srcDir, 'core', 'bower.json'), JSON.stringify({ name: 'adapt-contrib-core', version: '6.24.1' }))
    await fs.writeFile(path.join(srcDir, 'components', 'adapt-contrib-text', 'bower.json'), JSON.stringify({ name: 'adapt-contrib-text', version: '5.0.0' }))
    await fs.writeFile(path.join(srcDir, 'extensions', 'adapt-contrib-trickle', 'bower.json'), JSON.stringify({ name: 'adapt-contrib-trickle', version: '4.2.1' }))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true })
  })

  it('should return plugin names and versions from bower.json files', async () => {
    const plugins = await readFrameworkPluginVersions(tmpDir)
    assert.equal(plugins.length, 3)
    const names = plugins.map(p => p.name).sort()
    assert.deepEqual(names, ['adapt-contrib-core', 'adapt-contrib-text', 'adapt-contrib-trickle'])
  })

  it('should return name and version for each plugin', async () => {
    const plugins = await readFrameworkPluginVersions(tmpDir)
    const core = plugins.find(p => p.name === 'adapt-contrib-core')
    assert.equal(core.version, '6.24.1')
  })

  it('should return empty array when src dir has no bower files', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-empty-'))
    await fs.mkdir(path.join(emptyDir, 'src'), { recursive: true })
    const plugins = await readFrameworkPluginVersions(emptyDir)
    assert.deepEqual(plugins, [])
    await fs.rm(emptyDir, { recursive: true })
  })
})
