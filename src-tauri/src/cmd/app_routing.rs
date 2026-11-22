use super::CmdResult;

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct InstalledAppInfo {
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
}

#[cfg(target_os = "macos")]
mod macos {
    use super::InstalledAppInfo;
    use std::collections::HashSet;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    fn read_info_plist(app_path: &Path) -> (Option<String>, Option<String>) {
        let plist_path = app_path.join("Contents").join("Info.plist");
        if !plist_path.is_file() {
            return (None, None);
        }

        let output = match Command::new("plutil")
            .args(["-convert", "json", "-o", "-"])
            .arg(&plist_path)
            .output()
        {
            Ok(out) if out.status.success() => out,
            _ => return (None, None),
        };

        let json: serde_json::Value = match serde_json::from_slice(&output.stdout) {
            Ok(val) => val,
            Err(_) => return (None, None),
        };

        let name = json
            .get("CFBundleDisplayName")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .or_else(|| {
                json.get("CFBundleName")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
            })
            .map(|s| s.trim().to_owned());

        let bundle_id = json
            .get("CFBundleIdentifier")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_owned());

        (name, bundle_id)
    }

    pub fn scan_installed_apps() -> Vec<InstalledAppInfo> {
        let mut search_dirs: Vec<PathBuf> = vec![
            PathBuf::from("/Applications"),
            PathBuf::from("/System/Applications"),
            PathBuf::from("/System/Applications/Utilities"),
        ];

        if let Some(home) = dirs::home_dir() {
            search_dirs.push(home.join("Applications"));
        }

        let mut seen = HashSet::new();
        let mut apps = Vec::new();

        for dir in search_dirs {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };

            for entry in entries.flatten() {
                let path = entry.path();
                let is_app = path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("app"));
                if !is_app {
                    continue;
                }

                let canonical = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
                let path_str = canonical.to_string_lossy().into_owned();
                if !seen.insert(path_str.clone()) {
                    continue;
                }

                let (plist_name, bundle_id) = read_info_plist(&canonical);
                let fallback_name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&path_str)
                    .to_owned();
                let name = plist_name.unwrap_or(fallback_name);

                apps.push(InstalledAppInfo {
                    name,
                    path: path_str,
                    bundle_id,
                });
            }
        }

        apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        apps
    }
}

#[tauri::command]
#[specta::specta]
pub async fn list_installed_apps() -> CmdResult<Vec<InstalledAppInfo>> {
    #[cfg(target_os = "macos")]
    {
        use super::StringifyErr as _;
        tokio::task::spawn_blocking(macos::scan_installed_apps)
            .await
            .stringify_err()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}
