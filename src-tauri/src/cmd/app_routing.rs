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

#[cfg(target_os = "windows")]
mod windows {
    use super::InstalledAppInfo;
    use std::collections::HashSet;
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::{Path, PathBuf};
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile,
        STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    use windows::core::{Interface, PCWSTR};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
    };

    const MAX_SHORTCUT_DEPTH: usize = 4;

    struct ComGuard {
        should_uninit: bool,
    }

    impl ComGuard {
        fn init() -> Option<Self> {
            let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            if hr.is_ok() {
                Some(Self { should_uninit: true })
            } else if hr == RPC_E_CHANGED_MODE {
                Some(Self { should_uninit: false })
            } else {
                None
            }
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.should_uninit {
                unsafe { CoUninitialize() };
            }
        }
    }

    fn normalize_exe_path(path: &Path) -> Option<String> {
        let canonical = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        if !canonical.is_file() {
            return None;
        }
        let is_exe = canonical
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
        if !is_exe {
            return None;
        }
        let raw = canonical.to_string_lossy();
        let cleaned = raw.strip_prefix(r"\\?\").unwrap_or(&raw);
        Some(cleaned.to_owned())
    }

    fn resolve_shortcut_target(lnk_path: &Path) -> Option<PathBuf> {
        let wide_path: Vec<u16> = lnk_path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
            let persist_file: IPersistFile = shell_link.cast().ok()?;
            persist_file.Load(PCWSTR(wide_path.as_ptr()), STGM_READ).ok()?;

            // Read target path without calling Resolve() so broken shortcuts never trigger UI or MSI repair.
            let mut target_buf = vec![0u16; 1024];
            shell_link.GetPath(&mut target_buf, std::ptr::null_mut(), 0).ok()?;

            let len = target_buf.iter().position(|&c| c == 0).unwrap_or(target_buf.len());
            if len == 0 {
                return None;
            }
            Some(PathBuf::from(OsString::from_wide(&target_buf[..len])))
        }
    }

    fn walk_start_menu(
        dir: &Path,
        depth: usize,
        seen: &mut HashSet<String>,
        apps: &mut Vec<InstalledAppInfo>,
    ) {
        if depth > MAX_SHORTCUT_DEPTH {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                walk_start_menu(&path, depth + 1, seen, apps);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let is_lnk = path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("lnk"));
            if !is_lnk {
                continue;
            }

            let Some(target) = resolve_shortcut_target(&path) else {
                continue;
            };
            let Some(path_str) = normalize_exe_path(&target) else {
                continue;
            };
            if !seen.insert(path_str.to_lowercase()) {
                continue;
            }

            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(&path_str)
                .to_owned();

            apps.push(InstalledAppInfo {
                name,
                path: path_str,
                bundle_id: None,
            });
        }
    }

    fn scan_start_menu(seen: &mut HashSet<String>, apps: &mut Vec<InstalledAppInfo>) {
        let Some(_com) = ComGuard::init() else {
            return;
        };

        let mut roots = Vec::new();
        if let Ok(program_data) = std::env::var("ProgramData") {
            roots.push(PathBuf::from(program_data).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
        if let Some(roaming) = dirs::data_dir() {
            roots.push(roaming.join(r"Microsoft\Windows\Start Menu\Programs"));
        }

        for root in roots {
            walk_start_menu(&root, 0, seen, apps);
        }
    }

    fn is_windows_system_exe(path_lower: &str, system_roots: &[String]) -> bool {
        system_roots.iter().any(|prefix| path_lower.starts_with(prefix))
    }

    fn scan_running_processes(seen: &mut HashSet<String>, apps: &mut Vec<InstalledAppInfo>) {
        let system_roots: Vec<String> = std::env::var("SystemRoot")
            .map(|root| {
                let base = root.trim_end_matches('\\').to_lowercase();
                vec![
                    format!(r"{base}\system32\"),
                    format!(r"{base}\syswow64\"),
                    format!(r"{base}\winsxs\"),
                ]
            })
            .unwrap_or_default();

        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE || snapshot.is_null() {
                return;
            }

            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

            let mut ok = Process32FirstW(snapshot, &mut entry);
            let mut path_buf = vec![0u16; 1024];

            while ok != 0 {
                let pid = entry.th32ProcessID;
                if pid > 4 {
                    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                    if !handle.is_null() {
                        let mut len = path_buf.len() as u32;
                        if QueryFullProcessImageNameW(handle, 0, path_buf.as_mut_ptr(), &mut len) != 0 && len > 0 {
                            let raw_path = PathBuf::from(OsString::from_wide(&path_buf[..len as usize]));
                            if let Some(path_str) = normalize_exe_path(&raw_path) {
                                let lower = path_str.to_lowercase();
                                if !is_windows_system_exe(&lower, &system_roots) && seen.insert(lower) {
                                    let name = Path::new(&path_str)
                                        .file_stem()
                                        .and_then(|s| s.to_str())
                                        .unwrap_or(&path_str)
                                        .to_owned();
                                    apps.push(InstalledAppInfo {
                                        name,
                                        path: path_str,
                                        bundle_id: None,
                                    });
                                }
                            }
                        }
                        CloseHandle(handle);
                    }
                }
                ok = Process32NextW(snapshot, &mut entry);
            }

            CloseHandle(snapshot);
        }
    }

    pub fn scan_installed_apps() -> Vec<InstalledAppInfo> {
        let mut seen = HashSet::new();
        let mut apps = Vec::new();

        scan_start_menu(&mut seen, &mut apps);
        scan_running_processes(&mut seen, &mut apps);

        apps.sort_by_key(|a| a.name.to_lowercase());
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

    #[cfg(target_os = "windows")]
    {
        use super::StringifyErr as _;
        tokio::task::spawn_blocking(windows::scan_installed_apps)
            .await
            .stringify_err()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(Vec::new())
    }
}
