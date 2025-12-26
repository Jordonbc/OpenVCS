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
    #[serde(default)]
    pub theme_dirs: u32,
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
    themes: Vec<String>,
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

fn manifest_to_summary(manifest: RawPluginManifest) -> PluginSummary {
    let theme_dirs = manifest.themes.len() as u32;
    PluginSummary {
        id: manifest.id.trim().to_string(),
        name: manifest.name.trim().to_string(),
        description: clean_opt(manifest.description),
        category: clean_opt(manifest.category),
        tags: clean_tags(manifest.tags),
        version: clean_opt(manifest.version),
        author: clean_opt(manifest.author),
        entry: clean_opt(manifest.entry),
        theme_dirs,
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
                            out.push(manifest_to_summary(manifest));
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

            let summary = manifest_to_summary(manifest);
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
