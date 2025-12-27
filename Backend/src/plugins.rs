use directories::ProjectDirs;
use log::warn;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    env,
    fs,
    path::{Path, PathBuf},
};

const PLUGIN_MANIFEST_NAME: &str = "openvcs.plugin.json";
const BUILT_IN_PLUGINS_DIR_NAME: &str = "built-in-plugins";
const MAX_ICON_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct PluginSummary {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
    /// When true, the plugin is enabled by default (unless overridden in settings).
    #[serde(default, skip_serializing_if = "is_false")]
    pub default_enabled: bool,
    #[serde(default)]
    pub theme_dirs: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginPayload {
    pub summary: PluginSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PluginThemeDir {
    pub plugin_id: String,
    pub path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct RawPluginManifest {
    id: String,
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    entry: Option<String>,
    #[serde(default)]
    default_enabled: bool,
    #[serde(default)]
    themes: Vec<String>,
}

fn is_false(v: &bool) -> bool {
    !*v
}

fn plugins_dir() -> PathBuf {
    if let Some(pd) = ProjectDirs::from("dev", "OpenVCS", "OpenVCS") {
        pd.config_dir().join("plugins")
    } else {
        PathBuf::from("plugins")
    }
}

fn ensure_dir(path: &Path) {
    if let Err(err) = fs::create_dir_all(path) {
        warn!("plugins: failed to create {}: {}", path.display(), err);
    }
}

fn clean_opt(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn clean_tags(tags: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for tag in tags {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = trimmed.to_ascii_lowercase();
        if !seen.insert(key) {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

fn built_in_plugin_dirs() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(explicit) = env::var("OPENVCS_BUILTIN_PLUGINS") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed));
        }
    }

    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir.join(BUILT_IN_PLUGINS_DIR_NAME));
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(BUILT_IN_PLUGINS_DIR_NAME));
            candidates.push(dir.join("resources").join(BUILT_IN_PLUGINS_DIR_NAME));
            #[cfg(target_os = "macos")]
            if let Some(parent) = dir.parent() {
                candidates.push(parent.join("Resources").join(BUILT_IN_PLUGINS_DIR_NAME));
            }
        }
    }

    candidates.push(PathBuf::from("Backend").join(BUILT_IN_PLUGINS_DIR_NAME));
    candidates.push(PathBuf::from(BUILT_IN_PLUGINS_DIR_NAME));
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(BUILT_IN_PLUGINS_DIR_NAME));

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter_map(|path| {
            if !seen.insert(path.clone()) {
                return None;
            }
            if path.is_dir() {
                Some(path)
            } else {
                None
            }
        })
        .collect()
}

fn read_manifest_from_directory(path: &Path) -> Result<RawPluginManifest, String> {
    let manifest_path = path.join(PLUGIN_MANIFEST_NAME);
    let text = match fs::read_to_string(&manifest_path) {
        Ok(text) => text,
        Err(err) => {
            if err.kind() == std::io::ErrorKind::NotFound {
                return Err(format!(
                    "plugin {} is missing {PLUGIN_MANIFEST_NAME}",
                    path.display()
                ));
            }
            return Err(format!("read {}: {}", manifest_path.display(), err));
        }
    };

    let manifest: RawPluginManifest = serde_json::from_str(&text)
        .map_err(|err| format!("parse plugin manifest in {}: {}", path.display(), err))?;
    if manifest.id.trim().is_empty() {
        return Err(format!("plugin {} has an empty id", path.display()));
    }
    if manifest.name.trim().is_empty() {
        return Err(format!("plugin {} has an empty name", path.display()));
    }
    Ok(manifest)
}

fn icon_mime_for_path(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_string_lossy().trim().to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

fn find_icon_path(plugin_dir: &Path) -> Option<PathBuf> {
    for ext in ["png", "jpg", "jpeg", "webp", "avif", "svg"] {
        let candidate = plugin_dir.join(format!("icon.{ext}"));
        if candidate.is_file() && icon_mime_for_path(&candidate).is_some() {
            return Some(candidate);
        }
    }
    None
}

fn icon_data_url(plugin_dir: &Path) -> Option<String> {
    let path = find_icon_path(plugin_dir)?;
    let mime = icon_mime_for_path(&path)?;

    let data = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(err) => {
            warn!("plugins: failed to read icon {}: {}", path.display(), err);
            return None;
        }
    };

    if data.len() > MAX_ICON_BYTES {
        warn!(
            "plugins: icon {} too large ({} bytes, max {})",
            path.display(),
            data.len(),
            MAX_ICON_BYTES
        );
        return None;
    }

    if mime == "image/svg+xml" {
        let encoded = encode_svg_utf8_data(&data);
        return Some(format!("data:{mime};charset=utf-8,{encoded}"));
    }

    let encoded = encode_base64(&data);
    Some(format!("data:{mime};base64,{encoded}"))
}

fn encode_svg_utf8_data(data: &[u8]) -> String {
    // Some WebViews are flaky with base64-encoded SVG data URLs; percent-encoded UTF-8 tends to be more reliable.
    let text = String::from_utf8_lossy(data);
    percent_encode_uri_component(text.trim())
}

fn encode_base64(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    if data.is_empty() {
        return String::new();
    }

    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    let mut i = 0usize;
    while i < data.len() {
        let b0 = data[i];
        let b1 = if i + 1 < data.len() { data[i + 1] } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] } else { 0 };

        let n0 = (b0 >> 2) as usize;
        let n1 = (((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize;
        let n2 = (((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize;
        let n3 = (b2 & 0b0011_1111) as usize;

        out.push(TABLE[n0] as char);
        out.push(TABLE[n1] as char);

        if i + 1 < data.len() {
            out.push(TABLE[n2] as char);
        } else {
            out.push('=');
        }

        if i + 2 < data.len() {
            out.push(TABLE[n3] as char);
        } else {
            out.push('=');
        }

        i += 3;
    }
    out
}

fn percent_encode_uri_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for &b in input.as_bytes() {
        let is_unreserved = matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~');
        if is_unreserved {
            out.push(b as char);
            continue;
        }
        out.push('%');
        out.push(nibble_hex((b >> 4) & 0xF));
        out.push(nibble_hex(b & 0xF));
    }
    out
}

fn nibble_hex(v: u8) -> char {
    match v {
        0..=9 => (b'0' + v) as char,
        10..=15 => (b'A' + (v - 10)) as char,
        _ => '0',
    }
}

fn manifest_to_summary(plugin_dir: &Path, manifest: RawPluginManifest) -> PluginSummary {
    let theme_dirs = manifest.themes.len() as u32;
    let icon_data_url = icon_data_url(plugin_dir);
    PluginSummary {
        id: manifest.id.trim().to_string(),
        name: manifest.name.trim().to_string(),
        description: clean_opt(manifest.description),
        category: clean_opt(manifest.category),
        tags: clean_tags(manifest.tags),
        version: clean_opt(manifest.version),
        author: clean_opt(manifest.author),
        entry: clean_opt(manifest.entry),
        default_enabled: manifest.default_enabled,
        theme_dirs,
        icon_data_url,
    }
}

pub fn list_plugins() -> Vec<PluginSummary> {
    let dir = plugins_dir();
    ensure_dir(&dir);

    let mut out: Vec<PluginSummary> = Vec::new();
    let mut seen = HashSet::new();

    let roots = built_in_plugin_dirs()
        .into_iter()
        .chain(std::iter::once(dir))
        .collect::<Vec<_>>();

    for root in roots {
        match fs::read_dir(&root) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_dir() {
                        continue;
                    }
                    match read_manifest_from_directory(&path) {
                        Ok(manifest) => {
                            let norm = manifest.id.trim().to_ascii_lowercase();
                            if !seen.insert(norm) {
                                continue;
                            }
                            out.push(manifest_to_summary(&path, manifest));
                        }
                        Err(_) => {}
                    }
                }
            }
            Err(err) => warn!("plugins: failed to list {}: {}", root.display(), err),
        }
    }

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

pub fn load_plugin(id: &str) -> Result<PluginPayload, String> {
    let requested = id.trim();
    if requested.is_empty() {
        return Err("plugin id is empty".to_string());
    }
    let requested_lower = requested.to_ascii_lowercase();

    let dir = plugins_dir();
    ensure_dir(&dir);

    let roots = built_in_plugin_dirs()
        .into_iter()
        .chain(std::iter::once(dir))
        .collect::<Vec<_>>();

    for root in roots {
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(err) => {
                warn!("plugins: failed to list {}: {}", root.display(), err);
                continue;
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let manifest = match read_manifest_from_directory(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if manifest.id.trim().to_ascii_lowercase() != requested_lower {
                continue;
            }

            let summary = manifest_to_summary(&path, manifest);
            let entry_text = if let Some(entry) = summary.entry.as_deref() {
                let entry_path = path.join(entry.trim_start_matches("./"));
                match fs::read_to_string(&entry_path) {
                    Ok(text) => Some(text),
                    Err(err) => {
                        return Err(format!(
                            "read plugin entry {}: {}",
                            entry_path.display(),
                            err
                        ));
                    }
                }
            } else {
                None
            };

            return Ok(PluginPayload {
                summary,
                entry: entry_text,
            });
        }
    }

    Err(format!("plugin `{}` not found", requested))
}

pub fn plugin_theme_dirs() -> Vec<PluginThemeDir> {
    let dir = plugins_dir();
    ensure_dir(&dir);

    let roots = built_in_plugin_dirs()
        .into_iter()
        .chain(std::iter::once(dir))
        .collect::<Vec<_>>();

    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for root in roots {
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(err) => {
                warn!("plugins: failed to list {}: {}", root.display(), err);
                continue;
            }
        };

        for entry in entries.flatten() {
            let plugin_dir = entry.path();
            if !plugin_dir.is_dir() {
                continue;
            }
            let manifest = match read_manifest_from_directory(&plugin_dir) {
                Ok(m) => m,
                Err(_) => continue,
            };
            let plugin_id = manifest.id.trim().to_string();
            let plugin_id_lower = plugin_id.to_ascii_lowercase();
            if !seen.insert(plugin_id_lower) {
                continue;
            }

            for theme_rel in manifest.themes {
                let rel = theme_rel.trim();
                if rel.is_empty() {
                    continue;
                }
                let theme_dir = plugin_dir.join(rel.trim_start_matches("./"));
                if theme_dir.is_dir() {
                    out.push(PluginThemeDir {
                        plugin_id: plugin_id.clone(),
                        path: theme_dir,
                    });
                }
            }
        }
    }

    out
}
