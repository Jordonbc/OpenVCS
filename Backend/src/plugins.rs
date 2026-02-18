// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::plugin_bundles::PluginBundleStore;
use crate::plugin_paths::{built_in_plugin_dirs, ensure_dir, plugins_dir, PLUGIN_MANIFEST_NAME};
use log::{debug, warn};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock, RwLock,
    },
};

const PLUGIN_THEMES_DIR_NAME: &str = "themes";
const MAX_ICON_BYTES: usize = 512 * 1024;

#[derive(Debug, Deserialize)]
struct CurrentPointer {
    version: String,
}

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
    pub source: String,
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

#[derive(Debug, Clone, Deserialize)]
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
}

/// Serde helper for skipping `false` values.
///
/// # Parameters
/// - `v`: Boolean value.
///
/// # Returns
/// - `true` when value is false.
fn is_false(v: &bool) -> bool {
    !*v
}

/// Trims optional strings and removes empties.
///
/// # Parameters
/// - `value`: Optional string.
///
/// # Returns
/// - Trimmed non-empty string or `None`.
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

/// Trims, deduplicates, and normalizes tag lists.
///
/// # Parameters
/// - `tags`: Raw tag list.
///
/// # Returns
/// - Deduplicated normalized tag list.
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

#[derive(Debug, Copy, Clone)]
enum PluginOrigin {
    BuiltIn,
    User,
}

impl PluginOrigin {
    /// Returns serialized source label.
    ///
    /// # Returns
    /// - Source label string.
    fn as_str(&self) -> &'static str {
        match self {
            PluginOrigin::BuiltIn => "built-in",
            PluginOrigin::User => "user",
        }
    }
}

#[derive(Clone)]
struct CachedPlugin {
    resolved: PathBuf,
    manifest: RawPluginManifest,
    origin: PluginOrigin,
}

#[derive(Default)]
struct CacheData {
    list: Vec<PluginSummary>,
    entries: HashMap<String, CachedPlugin>,
    loaded: bool,
}

struct PluginCache {
    data: RwLock<CacheData>,
    dirty: AtomicBool,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl PluginCache {
    fn initialize() -> Arc<Self> {
        let cache = Arc::new(Self {
            data: RwLock::new(CacheData::default()),
            dirty: AtomicBool::new(true),
            watcher: Mutex::new(None),
        });
        cache.ensure_fresh();
        cache.watch_directories();
        cache
    }

    fn list(&self) -> Vec<PluginSummary> {
        self.ensure_fresh();
        self.data.read().unwrap().list.clone()
    }

    fn load_cached_plugin(&self, id: &str) -> Option<CachedPlugin> {
        self.ensure_fresh();
        self.data.read().unwrap().entries.get(id).cloned()
    }

    fn mark_dirty(&self) {
        self.dirty.store(true, Ordering::SeqCst);
    }

    fn ensure_fresh(&self) {
        let needs_reload = self.dirty.swap(false, Ordering::SeqCst) || {
            let data = self.data.read().unwrap();
            !data.loaded
        };
        if needs_reload {
            self.reload();
        }
    }

    fn reload(&self) {
        let built_in_ids = crate::plugin_bundles::built_in_plugin_ids();
        let bundle_store = PluginBundleStore::new_default();
        let mut seen = HashSet::new();
        let mut summaries: Vec<PluginSummary> = Vec::new();
        let mut entries: HashMap<String, CachedPlugin> = HashMap::new();

        for (root, origin) in plugin_roots() {
            match fs::read_dir(&root) {
                Ok(iter) => {
                    for entry in iter.flatten() {
                        let path = entry.path();
                        if !path.is_dir() {
                            continue;
                        }
                        if let Ok((resolved, manifest)) = read_manifest_from_directory(&path) {
                            let norm = manifest.id.trim().to_ascii_lowercase();
                            if !seen.insert(norm.clone()) {
                                continue;
                            }

                            let is_built_in = built_in_ids.contains(&norm);

                            if !is_built_in {
                                if bundle_store.get_current_dir(&norm).ok().flatten().is_none() {
                                    debug!("plugins: skipping '{}' - not properly installed (no current version)", norm);
                                    continue;
                                }
                            }

                            let effective_origin = if is_built_in {
                                PluginOrigin::BuiltIn
                            } else {
                                origin
                            };
                            let summary =
                                manifest_to_summary(&resolved, manifest.clone(), effective_origin);
                            summaries.push(summary);
                            entries.insert(
                                norm,
                                CachedPlugin {
                                    resolved: resolved.clone(),
                                    manifest,
                                    origin: effective_origin,
                                },
                            );
                        }
                    }
                }
                Err(err) => warn!("plugins: failed to list {}: {}", root.display(), err),
            }
        }

        summaries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        let mut data = self.data.write().unwrap();
        data.list = summaries;
        data.entries = entries;
        data.loaded = true;
    }

    fn watch_directories(self: &Arc<Self>) {
        let cache = Arc::clone(self);
        let mut watcher = match RecommendedWatcher::new(
            move |res: notify::Result<Event>| match res {
                Ok(_) => cache.mark_dirty(),
                Err(err) => warn!("plugins: watcher error: {}", err),
            },
            Config::default(),
        ) {
            Ok(w) => w,
            Err(err) => {
                warn!("plugins: failed to start directory watcher: {}", err);
                return;
            }
        };

        for (root, _) in plugin_roots() {
            if let Err(err) = watcher.watch(&root, RecursiveMode::Recursive) {
                warn!("plugins: failed to watch {}: {}", root.display(), err);
            }
        }

        let mut guard = self.watcher.lock().unwrap();
        *guard = Some(watcher);
    }
}

static PLUGIN_CACHE: OnceLock<Arc<PluginCache>> = OnceLock::new();

fn plugin_cache() -> &'static Arc<PluginCache> {
    PLUGIN_CACHE.get_or_init(PluginCache::initialize)
}

/// Resolves plugin root directories (user + built-in).
///
/// # Returns
/// - Unique list of plugin root paths with origin metadata.
fn plugin_roots() -> Vec<(PathBuf, PluginOrigin)> {
    let mut roots: Vec<(PathBuf, PluginOrigin)> = Vec::new();
    let mut seen = HashSet::new();

    let dir = plugins_dir();
    ensure_dir(&dir);
    if seen.insert(dir.clone()) {
        roots.push((dir, PluginOrigin::User));
    }

    for path in built_in_plugin_dirs() {
        if !seen.insert(path.clone()) {
            continue;
        }
        roots.push((path, PluginOrigin::BuiltIn));
    }

    roots
}

/// Resolves plugin directory for flat or versioned layouts.
///
/// # Parameters
/// - `path`: Candidate plugin directory.
///
/// # Returns
/// - `Some(PathBuf)` resolved plugin content directory.
/// - `None` when unresolved.
fn resolve_plugin_dir(path: &Path) -> Option<PathBuf> {
    let direct = path.join(PLUGIN_MANIFEST_NAME);
    if direct.is_file() {
        return Some(path.to_path_buf());
    }

    let current_path = path.join("current.json");
    if !current_path.is_file() {
        return None;
    }
    let text = fs::read_to_string(&current_path).ok()?;
    let cur: CurrentPointer = serde_json::from_str(&text).ok()?;
    let ver = cur.version.trim();
    if ver.is_empty() {
        return None;
    }
    let version_dir = path.join(ver);
    let manifest = version_dir.join(PLUGIN_MANIFEST_NAME);
    if manifest.is_file() {
        Some(version_dir)
    } else {
        None
    }
}

/// Reads and validates plugin manifest from a directory.
///
/// # Parameters
/// - `path`: Plugin directory.
///
/// # Returns
/// - `Ok((PathBuf, RawPluginManifest))` resolved directory and manifest.
/// - `Err(String)` when missing or invalid.
fn read_manifest_from_directory(path: &Path) -> Result<(PathBuf, RawPluginManifest), String> {
    let resolved = resolve_plugin_dir(path).unwrap_or_else(|| path.to_path_buf());
    let manifest_path = resolved.join(PLUGIN_MANIFEST_NAME);
    let text = match fs::read_to_string(&manifest_path) {
        Ok(text) => text,
        Err(err) => {
            if err.kind() == std::io::ErrorKind::NotFound {
                return Err(format!(
                    "plugin {} is missing {PLUGIN_MANIFEST_NAME}",
                    resolved.display()
                ));
            }
            return Err(format!("read {}: {}", manifest_path.display(), err));
        }
    };

    let manifest: RawPluginManifest = serde_json::from_str(&text)
        .map_err(|err| format!("parse plugin manifest in {}: {}", resolved.display(), err))?;
    if manifest.id.trim().is_empty() {
        return Err(format!("plugin {} has an empty id", resolved.display()));
    }
    if manifest.name.trim().is_empty() {
        return Err(format!("plugin {} has an empty name", resolved.display()));
    }
    Ok((resolved, manifest))
}

/// Returns icon MIME type from file extension.
///
/// # Parameters
/// - `path`: Icon file path.
///
/// # Returns
/// - `Some(&str)` MIME type for supported extensions.
/// - `None` for unsupported extensions.
fn icon_mime_for_path(path: &Path) -> Option<&'static str> {
    let ext = path
        .extension()?
        .to_string_lossy()
        .trim()
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// Finds a supported icon file within a plugin directory.
///
/// # Parameters
/// - `plugin_dir`: Plugin directory path.
///
/// # Returns
/// - `Some(PathBuf)` icon path.
/// - `None` when no supported icon exists.
fn find_icon_path(plugin_dir: &Path) -> Option<PathBuf> {
    for ext in ["png", "jpg", "jpeg", "webp", "avif", "svg"] {
        let candidate = plugin_dir.join(format!("icon.{ext}"));
        if candidate.is_file() && icon_mime_for_path(&candidate).is_some() {
            return Some(candidate);
        }
    }
    None
}

/// Loads icon bytes and returns a data URL for UI use.
///
/// # Parameters
/// - `plugin_dir`: Plugin directory path.
///
/// # Returns
/// - `Some(String)` icon data URL.
/// - `None` when icon is missing/invalid.
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

/// Encodes SVG bytes as percent-escaped UTF-8 data URL content.
///
/// # Parameters
/// - `data`: SVG bytes.
///
/// # Returns
/// - Percent-encoded UTF-8 string.
fn encode_svg_utf8_data(data: &[u8]) -> String {
    // Some WebViews are flaky with base64-encoded SVG data URLs; percent-encoded UTF-8 tends to be more reliable.
    let text = String::from_utf8_lossy(data);
    percent_encode_uri_component(text.trim())
}

/// Encodes bytes as base64 text.
///
/// # Parameters
/// - `data`: Raw bytes.
///
/// # Returns
/// - Base64-encoded string.
fn encode_base64(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    if data.is_empty() {
        return String::new();
    }

    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
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

/// Percent-encodes bytes for URI component contexts.
///
/// # Parameters
/// - `input`: Raw text.
///
/// # Returns
/// - Percent-encoded output string.
fn percent_encode_uri_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for &b in input.as_bytes() {
        let is_unreserved =
            matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~');
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

/// Converts a nibble value to uppercase hexadecimal character.
///
/// # Parameters
/// - `v`: Nibble value.
///
/// # Returns
/// - Hex digit char.
fn nibble_hex(v: u8) -> char {
    match v {
        0..=9 => (b'0' + v) as char,
        10..=15 => (b'A' + (v - 10)) as char,
        _ => '0',
    }
}

/// Converts a raw manifest into a plugin summary payload.
///
/// # Parameters
/// - `plugin_dir`: Resolved plugin directory.
/// - `manifest`: Raw manifest payload.
/// - `source`: Plugin source.
///
/// # Returns
/// - Normalized plugin summary.
fn manifest_to_summary(
    plugin_dir: &Path,
    manifest: RawPluginManifest,
    source: PluginOrigin,
) -> PluginSummary {
    let theme_dirs = discover_theme_dirs(plugin_dir).len() as u32;
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
        source: source.as_str().to_string(),
    }
}

/// Discovers theme directories under a plugin.
///
/// # Parameters
/// - `plugin_dir`: Plugin directory path.
///
/// # Returns
/// - Deduplicated theme directory list.
fn discover_theme_dirs(plugin_dir: &Path) -> Vec<PathBuf> {
    let root = plugin_dir.join(PLUGIN_THEMES_DIR_NAME);
    let mut out: Vec<PathBuf> = Vec::new();
    if !root.is_dir() {
        return out;
    }

    discover_theme_dirs_recursive(&root, 4, &mut out);

    out.sort();
    out.dedup();
    out
}

/// Recursively discovers theme directories to a fixed depth.
///
/// # Parameters
/// - `dir`: Directory to scan.
/// - `depth`: Remaining recursion depth.
/// - `out`: Accumulator for discovered directories.
///
/// # Returns
/// - `()`.
fn discover_theme_dirs_recursive(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth == 0 {
        return;
    }

    if dir.join("theme.json").is_file() {
        out.push(dir.to_path_buf());
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            warn!("plugins: failed to list {}: {}", dir.display(), err);
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        discover_theme_dirs_recursive(&path, depth - 1, out);
    }
}

/// Returns cached plugin summaries, refreshing only when watched directories change.
pub fn list_plugins() -> Vec<PluginSummary> {
    plugin_cache().list()
}

/// Loads plugin metadata and optional entry script text by plugin id.
///
/// # Parameters
/// - `id`: Plugin id to load (case-insensitive).
///
/// # Returns
/// - `Ok(PluginPayload)` when a matching plugin is found.
/// - `Err(String)` if the id is empty or no plugin matches.
pub fn load_plugin(id: &str) -> Result<PluginPayload, String> {
    let requested = id.trim();
    if requested.is_empty() {
        return Err("plugin id is empty".to_string());
    }
    let normalized = requested.to_ascii_lowercase();
    let cached = plugin_cache()
        .load_cached_plugin(&normalized)
        .ok_or_else(|| format!("plugin `{}` not found", requested))?;

    let summary = manifest_to_summary(&cached.resolved, cached.manifest.clone(), cached.origin);
    let entry_path = clean_opt(cached.manifest.entry.clone());
    let entry_code = entry_path.and_then(|entry| {
        let target = cached.resolved.join(entry.trim());
        match fs::read_to_string(&target) {
            Ok(text) => Some(text),
            Err(err) => {
                warn!(
                    "plugins: failed to read entry {} for {}: {}",
                    target.display(),
                    summary.id,
                    err
                );
                None
            }
        }
    });

    Ok(PluginPayload {
        summary,
        entry: entry_code,
    })
}

/// Lists all discovered theme directories grouped by plugin id.
///
/// # Returns
/// - A flat list of plugin/theme directory pairs.
pub fn plugin_theme_dirs() -> Vec<PluginThemeDir> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for (root, _) in plugin_roots() {
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
            let (resolved, manifest) = match read_manifest_from_directory(&plugin_dir) {
                Ok(m) => m,
                Err(_) => continue,
            };
            let plugin_id = manifest.id.trim().to_string();
            let plugin_id_lower = plugin_id.to_ascii_lowercase();
            if !seen.insert(plugin_id_lower) {
                continue;
            }

            for theme_dir in discover_theme_dirs(&resolved) {
                out.push(PluginThemeDir {
                    plugin_id: plugin_id.clone(),
                    path: theme_dir,
                });
            }
        }
    }

    out
}
