#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Parse a SemVer 2.0.0 version string (with optional leading `v`).
 * Returns null if the string is not a valid SemVer core + optional prerelease.
 */
export function parseSemver(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/^v/i, '')
  const withoutBuild = trimmed.split('+')[0]
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(withoutBuild)
  if (!match) return null

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  const prerelease = match[4]
    ? match[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id))
    : []

  return { major, minor, patch, prerelease }
}

/**
 * Compare two SemVer 2.0.0 strings.
 * Returns -1 if a < b, 0 if a == b, 1 if a > b.
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) {
    throw new Error(`Invalid SemVer comparison: "${a}" vs "${b}"`)
  }

  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) {
      return pa[key] < pb[key] ? -1 : 1
    }
  }

  const aPre = pa.prerelease
  const bPre = pb.prerelease
  if (aPre.length === 0 && bPre.length === 0) return 0
  if (aPre.length === 0) return 1
  if (bPre.length === 0) return -1

  const len = Math.max(aPre.length, bPre.length)
  for (let i = 0; i < len; i += 1) {
    if (i >= aPre.length) return -1
    if (i >= bPre.length) return 1
    const ai = aPre[i]
    const bi = bPre[i]
    if (ai === bi) continue

    const aNum = typeof ai === 'number'
    const bNum = typeof bi === 'number'
    if (aNum && bNum) return ai < bi ? -1 : 1
    if (aNum && !bNum) return -1
    if (!aNum && bNum) return 1
    return ai < bi ? -1 : 1
  }

  return 0
}

/**
 * Map a release artifact filename to Tauri v2 updater platform keys.
 * Returns null for manual-only installers (e.g. .dmg, .msi) or non-updater files.
 */
export function mapArtifactToPlatformKeys(filename) {
  const lower = filename.toLowerCase()

  if (lower.endsWith('x64-setup.exe')) {
    return ['windows-x86_64', 'windows-x86_64-nsis']
  }
  if (lower.endsWith('arm64-setup.exe')) {
    return ['windows-aarch64', 'windows-aarch64-nsis']
  }
  if (lower.endsWith('x86-setup.exe')) {
    return ['windows-i686', 'windows-i686-nsis']
  }

  if (lower.endsWith('.app.tar.gz')) {
    if (lower.includes('aarch64') || lower.includes('arm64')) {
      return ['darwin-aarch64', 'darwin-aarch64-app']
    }
    if (lower.includes('x86_64') || lower.includes('x64')) {
      return ['darwin-x86_64', 'darwin-x86_64-app']
    }
    throw new Error(
      `Ambiguous macOS updater archive without architecture in filename: ${filename}`,
    )
  }

  if (lower.endsWith('amd64.deb')) {
    return ['linux-x86_64', 'linux-x86_64-deb']
  }
  if (lower.endsWith('arm64.deb')) {
    return ['linux-aarch64', 'linux-aarch64-deb']
  }
  if (lower.endsWith('x86_64.rpm')) {
    return ['linux-x86_64-rpm']
  }
  if (lower.endsWith('aarch64.rpm')) {
    return ['linux-aarch64-rpm']
  }
  if (lower.endsWith('amd64.appimage') || lower.endsWith('x86_64.appimage')) {
    return ['linux-x86_64-appimage']
  }
  if (lower.endsWith('aarch64.appimage') || lower.endsWith('arm64.appimage')) {
    return ['linux-aarch64-appimage']
  }

  return null
}

function isRequiredSignedUpdaterArtifact(filename) {
  const lower = filename.toLowerCase()
  return lower.endsWith('-setup.exe') || lower.endsWith('.app.tar.gz')
}

export function buildUpdaterManifest({
  artifactsDir,
  tag,
  version,
  baseUrl,
  pubDate,
  notes,
  existingManifest = null,
}) {
  if (!fs.existsSync(artifactsDir)) {
    throw new Error(`Artifacts directory does not exist: ${artifactsDir}`)
  }

  const normalizedVersion = version.trim().replace(/^v/i, '')
  if (!parseSemver(normalizedVersion)) {
    throw new Error(`Release version is not valid SemVer: "${version}"`)
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const files = fs
    .readdirSync(artifactsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  const fileSet = new Set(files)

  // Fail on orphaned .sig files whose target artifact is missing.
  for (const name of files) {
    if (!name.endsWith('.sig')) continue
    const targetName = name.slice(0, -4)
    if (!fileSet.has(targetName)) {
      throw new Error(
        `Orphaned signature file without matching artifact: ${name}`,
      )
    }
  }

  const platforms = {}
  for (const name of files) {
    if (name.endsWith('.sig')) continue
    const keys = mapArtifactToPlatformKeys(name)
    if (!keys) continue

    const sigName = `${name}.sig`
    const hasSig = fileSet.has(sigName)

    if (!hasSig) {
      if (isRequiredSignedUpdaterArtifact(name)) {
        throw new Error(`Missing required signature file for ${name}`)
      }
      continue
    }

    const signature = fs
      .readFileSync(path.join(artifactsDir, sigName), 'utf8')
      .trim()
    if (!signature) {
      throw new Error(`Empty signature file: ${sigName}`)
    }

    const url = `${normalizedBaseUrl}/releases/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`
    for (const key of keys) {
      platforms[key] = { signature, url }
    }
  }

  if (
    existingManifest &&
    typeof existingManifest.version === 'string' &&
    parseSemver(existingManifest.version)
  ) {
    const cmp = compareSemver(normalizedVersion, existingManifest.version)
    if (cmp < 0) {
      return {
        manifest: existingManifest,
        action: 'preserved-higher',
      }
    }
    if (cmp === 0 && existingManifest.platforms) {
      const mergedPlatforms = {
        ...existingManifest.platforms,
        ...platforms,
      }
      if (Object.keys(mergedPlatforms).length === 0) {
        throw new Error(
          `No signed updater artifacts found in ${artifactsDir} for ${tag}`,
        )
      }
      return {
        manifest: {
          version: normalizedVersion,
          notes: notes || existingManifest.notes || `Clash Verge Rev ${tag}`,
          pub_date: pubDate,
          platforms: mergedPlatforms,
        },
        action: 'merged-same-version',
      }
    }
  }

  if (Object.keys(platforms).length === 0) {
    throw new Error(
      `No signed updater artifacts found in ${artifactsDir} for ${tag}`,
    )
  }

  return {
    manifest: {
      version: normalizedVersion,
      notes: notes || `Clash Verge Rev ${tag}`,
      pub_date: pubDate,
      platforms,
    },
    action: 'created-new-version',
  }
}

function parseArgs(argv) {
  const args = {
    artifactsDir: 'artifacts',
    out: 'site/updater/latest.json',
    tag: process.env.RELEASE_TAG || '',
    version: process.env.RELEASE_VERSION || '',
    baseUrl: process.env.R2_BASE_URL || 'https://clash.wangp.org',
    pubDate: process.env.BUILD_TIME || new Date().toISOString(),
    notes: '',
    existingManifest: '',
  }

  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i]
    const next = argv[i + 1]
    if (!next) continue
    if (key === '--artifacts-dir') {
      args.artifactsDir = next
      i += 1
    } else if (key === '--out') {
      args.out = next
      i += 1
    } else if (key === '--tag') {
      args.tag = next
      i += 1
    } else if (key === '--version') {
      args.version = next
      i += 1
    } else if (key === '--base-url') {
      args.baseUrl = next
      i += 1
    } else if (key === '--pub-date') {
      args.pubDate = next
      i += 1
    } else if (key === '--notes') {
      args.notes = next
      i += 1
    } else if (key === '--existing-manifest') {
      args.existingManifest = next
      i += 1
    }
  }

  if (!args.version && args.tag) {
    args.version = args.tag.replace(/^v/i, '')
  }
  return args
}

function loadExistingManifest(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null
  const raw = fs.readFileSync(filePath, 'utf8').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (err) {
    console.warn(
      `Warning: ignoring invalid existing manifest at ${filePath}: ${err.message}`,
    )
    return null
  }
}

function main() {
  const args = parseArgs(process.argv)
  const existingManifest = loadExistingManifest(args.existingManifest)
  const { manifest, action } = buildUpdaterManifest({
    artifactsDir: args.artifactsDir,
    tag: args.tag,
    version: args.version,
    baseUrl: args.baseUrl,
    pubDate: args.pubDate,
    notes: args.notes,
    existingManifest,
  })

  fs.mkdirSync(path.dirname(args.out), { recursive: true })
  fs.writeFileSync(args.out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(
    `Generated updater manifest ${args.out} (${action}, version=${manifest.version}, platforms=${Object.keys(manifest.platforms).length})`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
