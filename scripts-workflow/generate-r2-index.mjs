#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const INSTALLER_EXTENSIONS = [
  '.exe',
  '.msi',
  '.dmg',
  '.deb',
  '.rpm',
  '.AppImage',
];

function parseArgs(argv) {
  const args = {
    artifactsDir: 'artifacts',
    outDir: 'site',
    tag: process.env.RELEASE_TAG || 'dev',
    version: process.env.RELEASE_VERSION || '',
    baseUrl: process.env.R2_BASE_URL || 'https://clash.wangp.org',
    buildTime: process.env.BUILD_TIME || new Date().toISOString(),
  };

  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (!next) continue;
    if (key === '--artifacts-dir') {
      args.artifactsDir = next;
      i += 1;
    } else if (key === '--out-dir') {
      args.outDir = next;
      i += 1;
    } else if (key === '--tag') {
      args.tag = next;
      i += 1;
    } else if (key === '--version') {
      args.version = next;
      i += 1;
    } else if (key === '--base-url') {
      args.baseUrl = next;
      i += 1;
    } else if (key === '--build-time') {
      args.buildTime = next;
      i += 1;
    }
  }

  if (!args.version) {
    args.version = args.tag.replace(/^v/, '');
  }
  args.baseUrl = args.baseUrl.replace(/\/+$/, '');
  return args;
}

function getExtension(filename) {
  for (const ext of INSTALLER_EXTENSIONS) {
    if (filename.toLowerCase().endsWith(ext.toLowerCase())) {
      return ext;
    }
  }
  return null;
}

function classifyPlatform(ext) {
  const lower = ext.toLowerCase();
  if (lower === '.exe' || lower === '.msi') return 'windows';
  if (lower === '.dmg') return 'macos';
  if (lower === '.deb' || lower === '.rpm' || lower === '.appimage') {
    return 'linux';
  }
  return 'other';
}

function detectArch(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('aarch64') || lower.includes('arm64')) return 'ARM64';
  if (lower.includes('armv7') || lower.includes('armhf') || lower.includes('armhfp')) {
    return 'ARMv7';
  }
  if (lower.includes('x86_64') || lower.includes('amd64') || lower.includes('x64')) {
    return 'x64';
  }
  if (lower.includes('universal')) return 'Universal';
  return 'Standard';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** idx;
  return `${value.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

function computeSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function collectAssets(artifactsDir, baseUrl, tag) {
  if (!fs.existsSync(artifactsDir)) {
    throw new Error(`Artifacts directory does not exist: ${artifactsDir}`);
  }

  const entries = fs
    .readdirSync(artifactsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const assets = [];
  for (const name of entries) {
    const ext = getExtension(name);
    if (!ext) continue;

    const fullPath = path.join(artifactsDir, name);
    const stat = fs.statSync(fullPath);
    const sha256 = computeSha256(fullPath);
    const platform = classifyPlatform(ext);
    const arch = detectArch(name);
    const url = `${baseUrl}/releases/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;

    assets.push({
      name,
      platform,
      arch,
      ext: ext.replace(/^\./, '').toUpperCase(),
      size: stat.size,
      sizeFormatted: formatBytes(stat.size),
      sha256,
      url,
    });
  }

  return assets;
}

function renderPlatformSection(title, subtitle, items) {
  if (items.length === 0) {
    return `
      <section class="platform-card">
        <div class="platform-header">
          <h2>${escapeHtml(title)}</h2>
          <span class="platform-sub">${escapeHtml(subtitle)}</span>
        </div>
        <p class="empty">No artifacts available for this platform in this build.</p>
      </section>`;
  }

  const rows = items
    .map(
      (item) => `
        <div class="artifact-row">
          <div class="artifact-main">
            <div class="artifact-title">
              <a class="artifact-link" href="${escapeHtml(item.url)}">${escapeHtml(item.name)}</a>
              <span class="badge">${escapeHtml(item.arch)}</span>
              <span class="badge badge-muted">${escapeHtml(item.ext)}</span>
            </div>
            <div class="artifact-meta">
              <span>Size: <strong>${escapeHtml(item.sizeFormatted)}</strong></span>
              <span class="sha-wrap">SHA256: <code class="sha">${escapeHtml(item.sha256)}</code></span>
            </div>
          </div>
          <a class="download-btn" href="${escapeHtml(item.url)}">Download</a>
        </div>`,
    )
    .join('\n');

  return `
      <section class="platform-card">
        <div class="platform-header">
          <h2>${escapeHtml(title)}</h2>
          <span class="platform-sub">${escapeHtml(subtitle)}</span>
        </div>
        <div class="artifact-list">
          ${rows}
        </div>
      </section>`;
}

function renderHtml(manifest) {
  const { version, tag, buildTime, platforms } = manifest;
  const sections = [
    renderPlatformSection('Windows', 'x64 (.exe / .msi)', platforms.windows),
    renderPlatformSection('macOS', 'Apple Silicon & Intel (.dmg)', platforms.macos),
    renderPlatformSection('Linux', 'Debian / RPM / AppImage', platforms.linux),
  ].join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clash Verge Rev ${escapeHtml(tag)} — Downloads</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f8fa;
      --card: #ffffff;
      --border: #d8dee4;
      --text: #1f2328;
      --muted: #656d76;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;
      --badge-bg: #eff6ff;
      --badge-text: #1d4ed8;
      --code-bg: #f3f4f6;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0d1117;
        --card: #161b22;
        --border: #30363d;
        --text: #e6edf3;
        --muted: #8b949e;
        --accent: #3b82f6;
        --accent-hover: #60a5fa;
        --badge-bg: #1e293b;
        --badge-text: #93c5fd;
        --code-bg: #21262d;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
      padding: 2rem 1rem 3rem;
    }
    header {
      margin-bottom: 2rem;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: baseline;
      gap: 0.75rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.25rem;
    }
    header h1 {
      margin: 0;
      font-size: 1.75rem;
      letter-spacing: -0.02em;
    }
    .version-pill {
      display: inline-block;
      padding: 0.2rem 0.65rem;
      border-radius: 999px;
      background: var(--badge-bg);
      color: var(--badge-text);
      font-weight: 600;
      font-size: 0.9rem;
      vertical-align: middle;
      margin-left: 0.5rem;
    }
    .build-info {
      color: var(--muted);
      font-size: 0.875rem;
    }
    .platform-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.25rem;
    }
    .platform-header {
      display: flex;
      align-items: baseline;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .platform-header h2 {
      margin: 0;
      font-size: 1.2rem;
    }
    .platform-sub {
      color: var(--muted);
      font-size: 0.875rem;
    }
    .artifact-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .artifact-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.85rem 1rem;
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .artifact-main {
      min-width: 0;
      flex: 1 1 320px;
    }
    .artifact-title {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.45rem;
      margin-bottom: 0.35rem;
    }
    .artifact-link {
      color: var(--text);
      font-weight: 600;
      text-decoration: none;
      word-break: break-all;
    }
    .artifact-link:hover {
      color: var(--accent);
      text-decoration: underline;
    }
    .badge {
      display: inline-block;
      padding: 0.1rem 0.45rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      background: var(--badge-bg);
      color: var(--badge-text);
    }
    .badge-muted {
      background: var(--code-bg);
      color: var(--muted);
    }
    .artifact-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      font-size: 0.8rem;
      color: var(--muted);
    }
    .sha-wrap {
      word-break: break-all;
    }
    code.sha {
      background: var(--code-bg);
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .download-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      background: var(--accent);
      color: #ffffff;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.875rem;
      white-space: nowrap;
    }
    .download-btn:hover {
      background: var(--accent-hover);
    }
    .empty {
      color: var(--muted);
      font-size: 0.9rem;
      margin: 0;
    }
    footer {
      margin-top: 2rem;
      text-align: center;
      color: var(--muted);
      font-size: 0.85rem;
    }
    footer a {
      color: var(--accent);
      text-decoration: none;
    }
    footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <main class="container">
    <header>
      <div>
        <h1>Clash Verge Rev <span class="version-pill">${escapeHtml(tag)}</span></h1>
      </div>
      <div class="build-info">
        Version ${escapeHtml(version)} &middot; Built ${escapeHtml(buildTime)}
      </div>
    </header>
    ${sections}
    <footer>
      Machine-readable manifest: <a href="./releases.json">releases.json</a>
    </footer>
  </main>
</body>
</html>
`;
}

function main() {
  const args = parseArgs(process.argv);
  const assets = collectAssets(args.artifactsDir, args.baseUrl, args.tag);

  if (assets.length === 0) {
    throw new Error(
      `No installer artifacts found in ${args.artifactsDir} (expected ${INSTALLER_EXTENSIONS.join(', ')})`,
    );
  }

  const platforms = {
    windows: assets.filter((a) => a.platform === 'windows'),
    macos: assets.filter((a) => a.platform === 'macos'),
    linux: assets.filter((a) => a.platform === 'linux'),
  };

  const manifest = {
    version: args.version,
    tag: args.tag,
    buildTime: args.buildTime,
    baseUrl: args.baseUrl,
    platforms,
    assets,
  };

  fs.mkdirSync(args.outDir, { recursive: true });
  const jsonPath = path.join(args.outDir, 'releases.json');
  const htmlPath = path.join(args.outDir, 'index.html');

  fs.writeFileSync(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(htmlPath, renderHtml(manifest), 'utf8');

  console.log(
    `Generated ${htmlPath} and ${jsonPath} for ${args.tag} (${assets.length} artifacts)`,
  );
}

main();
