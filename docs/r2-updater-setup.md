# First-Party R2 Auto-Updater Setup (`clash.wangp.org`)

This fork (`wwwppp0801/clash-verge-rev`) publishes signed Tauri v2 updater artifacts and `updater/latest.json` to Cloudflare R2 via `.github/workflows/release-r2.yml`.

## 1. Signing Key Provisioning (One-Time)

Generate a Tauri minisign keypair locally (never commit the private key):

```bash
pnpm tauri signer generate -w ~/.tauri/clash-verge-rev.key
```

Configure the GitHub repository (`wwwppp0801/clash-verge-rev`):

| Kind | Name | Value |
| --- | --- | --- |
| Actions Secret | `TAURI_SIGNING_PRIVATE_KEY` | Full contents of `~/.tauri/clash-verge-rev.key` |
| Actions Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password (or empty string if unencrypted) |
| Actions Variable | `TAURI_UPDATER_PUBLIC_KEY` | Single-line base64 public key from `~/.tauri/clash-verge-rev.key.pub` |

## 2. How the Build Overlay Works

`src-tauri/tauri.conf.json` is kept untouched (`endpoints: []`, upstream `pubkey`), so upstream workflows (`release.yml`, `updater.yml`, `autobuild.yml`) are unaffected.

During `.github/workflows/release-r2.yml`:
1. The build job verifies `TAURI_UPDATER_PUBLIC_KEY` and `TAURI_SIGNING_PRIVATE_KEY` are present.
2. It generates a temporary `tauri.r2-updater.conf.json` overlay setting:
   - `version`: resolved SemVer (e.g. `2.6.0-wp.10`)
   - `bundle.createUpdaterArtifacts`: `true`
   - `plugins.updater.pubkey`: `vars.TAURI_UPDATER_PUBLIC_KEY`
   - `plugins.updater.endpoints`: `["https://clash.wangp.org/updater/latest.json"]`
3. Tauri signs Windows NSIS (`*-setup.exe` + `.sig`) and macOS app bundles (`*.app.tar.gz` + `.sig`). Manual installers (`.dmg`, `.msi`, `.exe`) are preserved on `index.html`.
4. `publish-r2` uploads all `releases/<tag>/*` files first, then `index.html` and `releases.json` (`Cache-Control: no-store`), and finally uploads `updater/latest.json` atomically last with `Cache-Control: no-store`.

## 3. Cloudflare Cache Configuration

`release-r2.yml` sets `Cache-Control: no-store` on `updater/latest.json`, `index.html`, and `releases.json`. If a Cloudflare Cache Rule overrides origin headers on `clash.wangp.org`, add a Cache Rule matching `URI Path equals /updater/latest.json` with **Bypass cache** so clients always see the latest manifest immediately.

## 4. Bootstrap & Upgrade Path

- **Existing clients** built before this change have empty updater endpoints and the upstream public key. They require **one manual upgrade** from `https://clash.wangp.org` to a build produced by the updated `release-r2.yml`.
- **Subsequent releases** are picked up automatically by the client's background updater (when `auto_check_update` is enabled) and staged for user-confirmed installation on next startup, or via Settings -> Check for Updates.
