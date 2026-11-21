@AGENTS.md

## Fork Release & Deployment (wwwppp0801/clash-verge-rev)

- **Distribution**: All release installers are published directly to Cloudflare R2 (bucket `clash-verge-rev`), served at `https://clash.wangp.org/` (with Cloudflare Worker `clash-wangp-index` rewriting `/` to `/index.html`). Do **not** publish release binaries to GitHub Releases.
- **Workflow**: `.github/workflows/release-r2.yml` (`Release to Cloudflare R2`) builds Windows (x64), macOS (aarch64/x64), and Linux (x64) packages on `v*.*.*` tag push or manual `workflow_dispatch`, uploads them to `releases/<tag>/`, and updates the root `index.html` and `releases.json` via `scripts-workflow/generate-r2-index.mjs`.
- **Upstream Release Workflow**: `.github/workflows/release.yml` has its `push.tags` trigger disabled so tag pushes only trigger `release-r2.yml`.
- **Required GitHub Secrets**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
