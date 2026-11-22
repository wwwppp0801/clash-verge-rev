import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildUpdaterManifest,
  compareSemver,
} from './generate-r2-updater-manifest.mjs'

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'r2-updater-test-'))
}

test('compareSemver orders numeric prereleases wp.9 < wp.10 < stable', () => {
  assert.equal(compareSemver('2.6.0-wp.9', '2.6.0-wp.10'), -1)
  assert.equal(compareSemver('2.6.0-wp.10', '2.6.0-wp.9'), 1)
  assert.equal(compareSemver('2.6.0-wp.10', '2.6.0-wp.10'), 0)
  assert.equal(compareSemver('2.6.0-wp.10', '2.6.0'), -1)
  assert.equal(compareSemver('2.6.0', '2.6.0-wp.10'), 1)
})

test('buildUpdaterManifest maps signed Windows NSIS and macOS tar.gz while ignoring manual DMG', () => {
  const dir = makeTempDir()
  try {
    fs.writeFileSync(path.join(dir, 'Clash.Verge_2.6.0-wp.10_x64-setup.exe'), 'exe')
    fs.writeFileSync(
      path.join(dir, 'Clash.Verge_2.6.0-wp.10_x64-setup.exe.sig'),
      'WIN_SIG\n',
    )
    fs.writeFileSync(
      path.join(dir, 'Clash.Verge_2.6.0-wp.10_aarch64.app.tar.gz'),
      'tgz',
    )
    fs.writeFileSync(
      path.join(dir, 'Clash.Verge_2.6.0-wp.10_aarch64.app.tar.gz.sig'),
      'MAC_SIG\n',
    )
    fs.writeFileSync(path.join(dir, 'Clash.Verge_2.6.0-wp.10_aarch64.dmg'), 'dmg')

    const { manifest, action } = buildUpdaterManifest({
      artifactsDir: dir,
      tag: 'v2.6.0-wp.10',
      version: '2.6.0-wp.10',
      baseUrl: 'https://clash.wangp.org',
      updaterPrefix: 'updater/artifacts/v2.6.0-wp.10/999-1',
      pubDate: '2026-04-16T00:00:00Z',
    })

    assert.equal(action, 'created-new-version')
    assert.equal(manifest.version, '2.6.0-wp.10')
    assert.deepEqual(manifest.platforms['windows-x86_64'], {
      signature: 'WIN_SIG',
      url: 'https://clash.wangp.org/updater/artifacts/v2.6.0-wp.10/999-1/Clash.Verge_2.6.0-wp.10_x64-setup.exe',
    })
    assert.deepEqual(
      manifest.platforms['windows-x86_64-nsis'],
      manifest.platforms['windows-x86_64'],
    )
    assert.deepEqual(manifest.platforms['darwin-aarch64'], {
      signature: 'MAC_SIG',
      url: 'https://clash.wangp.org/updater/artifacts/v2.6.0-wp.10/999-1/Clash.Verge_2.6.0-wp.10_aarch64.app.tar.gz',
    })
    assert.deepEqual(
      manifest.platforms['darwin-aarch64-app'],
      manifest.platforms['darwin-aarch64'],
    )
    assert.equal(Object.keys(manifest.platforms).length, 4)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('buildUpdaterManifest rejects missing or empty signatures', () => {
  const dir = makeTempDir()
  try {
    fs.writeFileSync(path.join(dir, 'Clash.Verge_2.6.0-wp.10_x64-setup.exe'), 'exe')
    assert.throws(
      () =>
        buildUpdaterManifest({
          artifactsDir: dir,
          tag: 'v2.6.0-wp.10',
          version: '2.6.0-wp.10',
          baseUrl: 'https://clash.wangp.org',
          pubDate: '2026-04-16T00:00:00Z',
        }),
      /Missing required signature file/,
    )

    fs.writeFileSync(
      path.join(dir, 'Clash.Verge_2.6.0-wp.10_x64-setup.exe.sig'),
      '   \n',
    )
    assert.throws(
      () =>
        buildUpdaterManifest({
          artifactsDir: dir,
          tag: 'v2.6.0-wp.10',
          version: '2.6.0-wp.10',
          baseUrl: 'https://clash.wangp.org',
          pubDate: '2026-04-16T00:00:00Z',
        }),
      /Empty signature file/,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('buildUpdaterManifest handles same-version merge, higher-version preservation, and version bump', () => {
  const dir = makeTempDir()
  try {
    fs.writeFileSync(path.join(dir, 'Clash.Verge_2.6.0-wp.10_x64-setup.exe'), 'exe')
    fs.writeFileSync(
      path.join(dir, 'Clash.Verge_2.6.0-wp.10_x64-setup.exe.sig'),
      'WIN_SIG',
    )

    const existingSame = {
      version: '2.6.0-wp.10',
      notes: 'existing',
      pub_date: '2026-04-15T00:00:00Z',
      platforms: {
        'darwin-aarch64': { signature: 'MAC_SIG', url: 'https://clash.wangp.org/mac' },
      },
    }
    const merged = buildUpdaterManifest({
      artifactsDir: dir,
      tag: 'v2.6.0-wp.10',
      version: '2.6.0-wp.10',
      baseUrl: 'https://clash.wangp.org',
      pubDate: '2026-04-16T00:00:00Z',
      existingManifest: existingSame,
    })
    assert.equal(merged.action, 'merged-same-version')
    assert.ok(merged.manifest.platforms['darwin-aarch64'])
    assert.ok(merged.manifest.platforms['windows-x86_64'])

    const existingHigher = {
      version: '2.6.0-wp.11',
      notes: 'newer',
      pub_date: '2026-04-17T00:00:00Z',
      platforms: {
        'darwin-aarch64': { signature: 'MAC_SIG', url: 'https://clash.wangp.org/mac11' },
      },
    }
    const preserved = buildUpdaterManifest({
      artifactsDir: dir,
      tag: 'v2.6.0-wp.10',
      version: '2.6.0-wp.10',
      baseUrl: 'https://clash.wangp.org',
      pubDate: '2026-04-16T00:00:00Z',
      existingManifest: existingHigher,
    })
    assert.equal(preserved.action, 'preserved-higher')
    assert.equal(preserved.manifest.version, '2.6.0-wp.11')

    const existingLower = {
      version: '2.6.0-wp.9',
      notes: 'older',
      pub_date: '2026-04-14T00:00:00Z',
      platforms: {
        'darwin-aarch64': { signature: 'OLD_MAC', url: 'https://clash.wangp.org/mac9' },
      },
    }
    const partialNewer = buildUpdaterManifest({
      artifactsDir: dir,
      tag: 'v2.6.0-wp.10',
      version: '2.6.0-wp.10',
      baseUrl: 'https://clash.wangp.org',
      pubDate: '2026-04-16T00:00:00Z',
      existingManifest: existingLower,
    })
    assert.equal(partialNewer.action, 'preserved-incomplete-partial')
    assert.equal(partialNewer.manifest.version, '2.6.0-wp.9')
    assert.deepEqual(partialNewer.omittedPlatforms, ['darwin-aarch64'])

    fs.writeFileSync(
      path.join(dir, 'Clash.Verge_2.6.0-wp.10_aarch64.app.tar.gz'),
      'tgz',
    )
    fs.writeFileSync(
      path.join(dir, 'Clash.Verge_2.6.0-wp.10_aarch64.app.tar.gz.sig'),
      'MAC_SIG_10',
    )
    const completeNewer = buildUpdaterManifest({
      artifactsDir: dir,
      tag: 'v2.6.0-wp.10',
      version: '2.6.0-wp.10',
      baseUrl: 'https://clash.wangp.org',
      pubDate: '2026-04-16T00:00:00Z',
      existingManifest: existingLower,
    })
    assert.equal(completeNewer.action, 'created-new-version')
    assert.equal(completeNewer.manifest.version, '2.6.0-wp.10')
    assert.ok(completeNewer.manifest.platforms['darwin-aarch64'])
    assert.ok(completeNewer.manifest.platforms['windows-x86_64'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
