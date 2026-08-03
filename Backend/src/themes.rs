// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use log::warn;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::Path};

use crate::plugins;

const MANIFEST_NAME: &str = "theme.json";

pub const DEFAULT_THEME_ID: &str = "default";

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeSource {
    BuiltIn,
    User,
    Plugin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeSummary {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub appearance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paired_with: Option<String>,
    pub source: ThemeSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ThemeMarkup {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

/// Returns whether markup payload has no head/body content.
///
/// # Parameters
/// - `markup`: Markup payload.
///
/// # Returns
/// - `true` when both fields are `None`.
/// - `false` otherwise.
fn markup_is_empty(markup: &ThemeMarkup) -> bool {
    markup.head.is_none() && markup.body.is_none()
}

#[derive(Debug, Clone, Serialize)]
pub struct ThemePayload {
    pub summary: ThemeSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub styles: Option<String>,
    #[serde(skip_serializing_if = "markup_is_empty")]
    pub markup: ThemeMarkup,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub scripts: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct RawThemeManifest {
    id: String,
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    appearance: Option<String>,
    #[serde(default)]
    paired_with: Option<String>,
    #[serde(default, deserialize_with = "string_or_vec")]
    styles: Vec<String>,
    #[serde(default)]
    markup: RawThemeMarkup,
    #[serde(default)]
    scripts: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct RawThemeMarkup {
    #[serde(default, deserialize_with = "string_or_vec")]
    head: Vec<String>,
    #[serde(default, deserialize_with = "string_or_vec")]
    body: Vec<String>,
}

/// Serde helper that accepts either a string or string array.
///
/// # Parameters
/// - `deserializer`: Input deserializer.
///
/// # Returns
/// - `Ok(Vec<String>)` parsed values.
/// - `Err(D::Error)` when deserialization fails.
fn string_or_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct StringOrVecVisitor;

    impl<'de> serde::de::Visitor<'de> for StringOrVecVisitor {
        type Value = Vec<String>;

        /// Describes expected input for this serde visitor.
        ///
        /// # Parameters
        /// - `formatter`: Formatter to write expectation text into.
        ///
        /// # Returns
        /// - `std::fmt::Result` formatting result.
        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a string or a sequence of strings")
        }

        /// Handles string slice input.
        ///
        /// # Parameters
        /// - `v`: Input string slice.
        ///
        /// # Returns
        /// - Single-element vector containing `v`.
        fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(vec![v.to_string()])
        }

        /// Handles owned string input.
        ///
        /// # Parameters
        /// - `v`: Input string.
        ///
        /// # Returns
        /// - Single-element vector containing `v`.
        fn visit_string<E>(self, v: String) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(vec![v])
        }

        /// Handles sequence input.
        ///
        /// # Parameters
        /// - `seq`: Sequence access over string elements.
        ///
        /// # Returns
        /// - Vector of collected strings.
        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: serde::de::SeqAccess<'de>,
        {
            let mut items = Vec::new();
            while let Some(item) = seq.next_element::<String>()? {
                items.push(item);
            }
            Ok(items)
        }
    }

    deserializer.deserialize_any(StringOrVecVisitor)
}

/// Normalizes an optional string by trimming and dropping empties.
///
/// # Parameters
/// - `value`: Optional string.
///
/// # Returns
/// - Trimmed non-empty value or `None`.
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

/// Normalizes appearance mode values to `light|dark|both`.
///
/// # Parameters
/// - `value`: Optional appearance string.
///
/// # Returns
/// - Normalized appearance mode or `None`.
fn clean_mode(value: Option<String>) -> Option<String> {
    let raw = clean_opt(value)?;
    let norm = raw.to_ascii_lowercase();
    match norm.as_str() {
        "light" | "dark" | "both" => Some(norm),
        _ => None,
    }
}

/// Prefixes a plugin theme id with plugin namespace.
///
/// # Parameters
/// - `plugin_id`: Plugin id.
/// - `theme_id`: Theme id.
///
/// # Returns
/// - Namespaced theme id.
fn namespaced_plugin_theme_id(plugin_id: &str, theme_id: &str) -> String {
    format!("{}.{}", plugin_id.trim(), theme_id.trim())
}

/// Normalizes `paired_with` references for plugin themes.
///
/// # Parameters
/// - `plugin_id`: Plugin id.
/// - `paired_with`: Raw paired theme id.
///
/// # Returns
/// - Namespaced paired theme id or empty string.
fn namespaced_plugin_paired_with(plugin_id: &str, paired_with: &str) -> String {
    let trimmed = paired_with.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let prefix = format!("{}.", plugin_id.trim());
    if trimmed.starts_with(&prefix) || trimmed.contains('.') {
        trimmed.to_string()
    } else {
        namespaced_plugin_theme_id(plugin_id, trimmed)
    }
}

/// Returns the built-in default theme summary.
///
/// # Returns
/// - Summary metadata for the default theme.
pub fn default_theme_summary() -> ThemeSummary {
    ThemeSummary {
        id: DEFAULT_THEME_ID.to_string(),
        name: "Default".to_string(),
        description: Some("Built-in OpenVCS theme".to_string()),
        version: None,
        author: None,
        appearance: None,
        paired_with: None,
        source: ThemeSource::BuiltIn,
        plugin_id: None,
    }
}

/// Returns the built-in default theme payload.
///
/// # Returns
/// - Theme payload for the default theme.
pub fn default_theme_payload() -> ThemePayload {
    ThemePayload {
        summary: default_theme_summary(),
        styles: None,
        markup: ThemeMarkup::default(),
        scripts: Vec::new(),
    }
}

/// Lists available themes from built-in and plugin theme directories.
///
/// # Returns
/// - Theme summaries sorted by name, prefixed with the default theme.
pub fn list_themes() -> Vec<ThemeSummary> {
    let mut summaries: Vec<ThemeSummary> = Vec::new();
    let mut seen = HashSet::new();
    seen.insert(DEFAULT_THEME_ID.to_string());

    for theme_dir in plugins::plugin_theme_dirs() {
        match read_manifest_from_directory(&theme_dir.path) {
            Ok(manifest) => {
                let theme_id = manifest.id.trim();
                if theme_id.is_empty() {
                    warn!(
                        "themes: theme {} ignored due to empty id",
                        theme_dir.path.display()
                    );
                    continue;
                }

                let namespaced_id = namespaced_plugin_theme_id(&theme_dir.plugin_id, theme_id);
                let norm = namespaced_id.to_ascii_lowercase();
                if seen.contains(&norm) {
                    continue;
                }
                seen.insert(norm);

                let appearance = clean_mode(manifest.appearance.clone());
                let paired_with = clean_opt(manifest.paired_with.clone())
                    .filter(|p| !p.eq_ignore_ascii_case(theme_id))
                    .map(|p| namespaced_plugin_paired_with(&theme_dir.plugin_id, &p))
                    .filter(|p| !p.is_empty());

                summaries.push(ThemeSummary {
                    id: namespaced_id,
                    name: manifest.name.trim().to_string(),
                    description: clean_opt(manifest.description),
                    version: clean_opt(manifest.version),
                    author: clean_opt(manifest.author),
                    appearance,
                    paired_with,
                    source: ThemeSource::Plugin,
                    plugin_id: Some(theme_dir.plugin_id.clone()),
                });
            }
            Err(err) => warn!(
                "themes: failed to read {}: {}",
                theme_dir.path.display(),
                err
            ),
        }
    }

    summaries.sort_by_key(|a| a.name.to_lowercase());

    let mut out = Vec::with_capacity(summaries.len() + 1);
    out.push(default_theme_summary());
    out.extend(summaries);
    out
}

/// Loads a theme payload by id.
///
/// # Parameters
/// - `id`: Theme id (supports plugin namespaced ids).
///
/// # Returns
/// - `Ok(ThemePayload)` when found.
/// - `Err(String)` when the id is missing.
pub fn load_theme(id: &str) -> Result<ThemePayload, String> {
    let requested = id.trim();
    if requested.is_empty() || requested.eq_ignore_ascii_case(DEFAULT_THEME_ID) {
        return Ok(default_theme_payload());
    }

    for theme_dir in plugins::plugin_theme_dirs() {
        match read_manifest_from_directory(&theme_dir.path) {
            Ok(manifest) => {
                let theme_id = manifest.id.trim();
                let namespaced_id = namespaced_plugin_theme_id(&theme_dir.plugin_id, theme_id);
                if namespaced_id.eq_ignore_ascii_case(requested) {
                    return build_theme_payload_from_directory(
                        &theme_dir.path,
                        manifest,
                        ThemeSource::Plugin,
                        Some(theme_dir.plugin_id.clone()),
                    );
                }

            }
            Err(err) => warn!(
                "themes: failed to read {}: {}",
                theme_dir.path.display(),
                err
            ),
        }
    }

    Err(format!("theme `{}` not found", requested))
}

/// Reads and validates a theme manifest from a directory.
///
/// # Parameters
/// - `path`: Theme directory path.
///
/// # Returns
/// - `Ok(RawThemeManifest)` parsed manifest.
/// - `Err(String)` when file is missing/invalid.
fn read_manifest_from_directory(path: &Path) -> Result<RawThemeManifest, String> {
    let manifest_path = path.join(MANIFEST_NAME);
    let text = match fs::read_to_string(&manifest_path) {
        Ok(text) => text,
        Err(err) => {
            if err.kind() == std::io::ErrorKind::NotFound {
                return Err(format!(
                    "theme {} is missing {MANIFEST_NAME}",
                    path.display()
                ));
            }
            return Err(format!("read {}: {}", manifest_path.display(), err));
        }
    };

    let manifest: RawThemeManifest = serde_json::from_str(&text)
        .map_err(|err| format!("parse manifest in {}: {}", path.display(), err))?;
    if manifest.id.trim().is_empty() {
        return Err(format!("theme {} has an empty id", path.display()));
    }
    if manifest.name.trim().is_empty() {
        return Err(format!("theme {} has an empty name", path.display()));
    }
    Ok(manifest)
}

/// Builds a complete theme payload from manifest and on-disk assets.
///
/// # Parameters
/// - `path`: Theme directory.
/// - `manifest`: Parsed manifest.
/// - `source`: Theme source kind.
/// - `plugin_id`: Optional owning plugin id.
///
/// # Returns
/// - `Ok(ThemePayload)` on success.
/// - `Err(String)` when asset loading fails.
fn build_theme_payload_from_directory(
    path: &Path,
    manifest: RawThemeManifest,
    source: ThemeSource,
    plugin_id: Option<String>,
) -> Result<ThemePayload, String> {
    let (styles, markup, scripts) = read_assets_from_directory(path, &manifest)?;
    let appearance = clean_mode(manifest.appearance.clone());
    let paired_with = clean_opt(manifest.paired_with.clone())
        .filter(|p| !p.eq_ignore_ascii_case(manifest.id.trim()))
        .map(|p| match source {
            ThemeSource::Plugin => plugin_id
                .as_deref()
                .map(|pid| namespaced_plugin_paired_with(pid, &p))
                .unwrap_or(p),
            _ => p,
        })
        .filter(|p| !p.is_empty());
    let id = match source {
        ThemeSource::Plugin => plugin_id
            .as_deref()
            .map(|pid| namespaced_plugin_theme_id(pid, manifest.id.trim()))
            .unwrap_or_else(|| manifest.id.trim().to_string()),
        _ => manifest.id.trim().to_string(),
    };
    let summary = ThemeSummary {
        id,
        name: manifest.name.trim().to_string(),
        description: clean_opt(manifest.description),
        version: clean_opt(manifest.version),
        author: clean_opt(manifest.author),
        appearance,
        paired_with,
        source,
        plugin_id,
    };

    Ok(ThemePayload {
        summary,
        styles,
        markup,
        scripts,
    })
}

/// Reads style/markup/script assets described by a theme manifest.
///
/// # Parameters
/// - `base`: Theme base directory.
/// - `manifest`: Parsed manifest.
///
/// # Returns
/// - `Ok((Option<String>, ThemeMarkup, Vec<String>))` loaded assets.
/// - `Err(String)` when asset loading fails.
fn read_assets_from_directory(
    base: &Path,
    manifest: &RawThemeManifest,
) -> Result<(Option<String>, ThemeMarkup, Vec<String>), String> {
    let styles = read_css_set_from_directory(base, &manifest.styles)?;
    let markup = read_markup_from_directory(base, &manifest.markup)?;
    let scripts = read_scripts_from_directory(base, &manifest.scripts)?;

    Ok((styles, markup, scripts))
}

/// Reads and concatenates CSS files.
///
/// # Parameters
/// - `base`: Theme base directory.
/// - `files`: CSS file names.
///
/// # Returns
/// - `Ok(Some(String))` concatenated CSS when files exist.
/// - `Ok(None)` when list is empty.
/// - `Err(String)` when reads fail.
fn read_css_set_from_directory(base: &Path, files: &[String]) -> Result<Option<String>, String> {
    if files.is_empty() {
        return Ok(None);
    }

    let mut combined = String::new();
    for name in files {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        let text = read_text_file_from_directory(base, trimmed)?;
        if !text.trim().is_empty() {
            if !combined.is_empty() && !combined.ends_with('\n') {
                combined.push('\n');
            }
            combined.push_str(&text);
            if !combined.ends_with('\n') {
                combined.push('\n');
            }
        }
    }

    Ok(if combined.trim().is_empty() {
        None
    } else {
        Some(combined)
    })
}

/// Reads markup fragments for head/body sections.
///
/// # Parameters
/// - `base`: Theme base directory.
/// - `markup`: Raw markup file declarations.
///
/// # Returns
/// - `Ok(ThemeMarkup)` loaded markup payload.
/// - `Err(String)` when reads fail.
fn read_markup_from_directory(base: &Path, markup: &RawThemeMarkup) -> Result<ThemeMarkup, String> {
    Ok(ThemeMarkup {
        head: read_css_set_from_directory(base, &markup.head)?,
        body: read_css_set_from_directory(base, &markup.body)?,
    })
}

/// Reads script file contents in declared order.
///
/// # Parameters
/// - `base`: Theme base directory.
/// - `files`: Script file names.
///
/// # Returns
/// - `Ok(Vec<String>)` script contents.
/// - `Err(String)` when reads fail.
fn read_scripts_from_directory(base: &Path, files: &[String]) -> Result<Vec<String>, String> {
    if files.is_empty() {
        return Ok(Vec::new());
    }

    let mut scripts = Vec::new();
    for name in files {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        let text = read_text_file_from_directory(base, trimmed)?;
        if !text.trim().is_empty() {
            scripts.push(text);
        }
    }

    Ok(scripts)
}

/// Reads a UTF-8 text file relative to a base directory.
///
/// # Parameters
/// - `base`: Base directory.
/// - `name`: Relative file name.
///
/// # Returns
/// - `Ok(String)` file contents.
/// - `Err(String)` when path validation or read fails.
fn read_text_file_from_directory(base: &Path, name: &str) -> Result<String, String> {
    let relative = name.trim_start_matches("./");
    let path = base.join(relative);
    match fs::read_to_string(&path) {
        Ok(text) => Ok(text),
        Err(err) => {
            if err.kind() == std::io::ErrorKind::NotFound {
                Err(format!("missing `{}` in {}", name, base.display()))
            } else {
                Err(format!("read `{}` in {}: {}", name, base.display(), err))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    include!("../tests/modules/themes.rs");
}
