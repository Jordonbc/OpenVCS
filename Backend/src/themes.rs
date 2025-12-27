use log::warn;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use crate::plugins;

const MANIFEST_NAME: &str = "theme.json";

pub const DEFAULT_THEME_ID: &str = "default";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeSource {
    BuiltIn,
    User,
    Plugin,
}

#[derive(Debug, Clone, Serialize)]
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
pub struct ThemeStyles {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub global: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub light: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dark: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ThemeMarkup {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

fn markup_is_empty(markup: &ThemeMarkup) -> bool {
    markup.head.is_none() && markup.body.is_none()
}

#[derive(Debug, Clone, Serialize)]
pub struct ThemePayload {
    pub summary: ThemeSummary,
    pub styles: ThemeStyles,
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
    #[serde(default)]
    styles: RawThemeStyles,
    #[serde(default)]
    markup: RawThemeMarkup,
    #[serde(default)]
    scripts: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct RawThemeStyles {
    #[serde(default, deserialize_with = "string_or_vec")]
    global: Vec<String>,
    #[serde(default, deserialize_with = "string_or_vec")]
    system: Vec<String>,
    #[serde(default, deserialize_with = "string_or_vec")]
    light: Vec<String>,
    #[serde(default, deserialize_with = "string_or_vec")]
    dark: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct RawThemeMarkup {
    #[serde(default, deserialize_with = "string_or_vec")]
    head: Vec<String>,
    #[serde(default, deserialize_with = "string_or_vec")]
    body: Vec<String>,
}

fn string_or_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct StringOrVecVisitor;

    impl<'de> serde::de::Visitor<'de> for StringOrVecVisitor {
        type Value = Vec<String>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a string or a sequence of strings")
        }

        fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(vec![v.to_string()])
        }

        fn visit_string<E>(self, v: String) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(vec![v])
        }

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

fn clean_mode(value: Option<String>) -> Option<String> {
    let raw = clean_opt(value)?;
    let norm = raw.to_ascii_lowercase();
    match norm.as_str() {
        "light" | "dark" | "both" => Some(norm),
        _ => None,
    }
}

fn infer_mode_from_manifest(manifest: &RawThemeManifest) -> Option<String> {
    let has_light = !manifest.styles.light.is_empty();
    let has_dark = !manifest.styles.dark.is_empty();
    let has_system = !manifest.styles.system.is_empty();
    match (has_light, has_dark, has_system) {
        (true, false, false) => Some("light".to_string()),
        (false, true, false) => Some("dark".to_string()),
        _ => Some("both".to_string()),
    }
}

fn namespaced_plugin_theme_id(plugin_id: &str, theme_id: &str) -> String {
    format!("{}.{}", plugin_id.trim(), theme_id.trim())
}

fn namespaced_plugin_paired_with(plugin_id: &str, paired_with: &str) -> String {
    let trimmed = paired_with.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let prefix = format!("{}.", plugin_id.trim());
    if trimmed.starts_with(&prefix) {
        trimmed.to_string()
    } else if trimmed.contains('.') {
        trimmed.to_string()
    } else {
        namespaced_plugin_theme_id(plugin_id, trimmed)
    }
}

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

pub fn default_theme_payload() -> ThemePayload {
    ThemePayload {
        summary: default_theme_summary(),
        styles: ThemeStyles::default(),
        markup: ThemeMarkup::default(),
        scripts: Vec::new(),
    }
}

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

                let appearance = clean_mode(manifest.appearance.clone())
                    .or_else(|| infer_mode_from_manifest(&manifest));
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

    summaries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let mut out = Vec::with_capacity(summaries.len() + 1);
    out.push(default_theme_summary());
    out.extend(summaries);
    out
}

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

                // Back-compat: allow loading a plugin theme by its raw `theme.json` id iff it is unambiguous.
                if !requested.contains('.') && theme_id.eq_ignore_ascii_case(requested) {
                    let mut matches = 0usize;
                    for other in plugins::plugin_theme_dirs() {
                        if !other
                            .plugin_id
                            .trim()
                            .eq_ignore_ascii_case(theme_dir.plugin_id.trim())
                        {
                            if let Ok(other_manifest) = read_manifest_from_directory(&other.path) {
                                if other_manifest.id.trim().eq_ignore_ascii_case(requested) {
                                    matches += 1;
                                    if matches > 0 {
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    if matches > 0 {
                        return Err(format!(
                            "theme id `{}` is ambiguous; use `{}` instead",
                            requested, namespaced_id
                        ));
                    }

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

fn build_theme_payload_from_directory(
    path: &Path,
    manifest: RawThemeManifest,
    source: ThemeSource,
    plugin_id: Option<String>,
) -> Result<ThemePayload, String> {
    let (styles, markup, scripts) = read_assets_from_directory(path, &manifest)?;
    let appearance =
        clean_mode(manifest.appearance.clone()).or_else(|| infer_mode_from_manifest(&manifest));
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

fn read_assets_from_directory(
    base: &Path,
    manifest: &RawThemeManifest,
) -> Result<(ThemeStyles, ThemeMarkup, Vec<String>), String> {
    let global = read_css_set_from_directory(base, &manifest.styles.global)?;
    let system = read_css_set_from_directory(base, &manifest.styles.system)?;
    let light = read_css_set_from_directory(base, &manifest.styles.light)?;
    let dark = read_css_set_from_directory(base, &manifest.styles.dark)?;
    let markup = read_markup_from_directory(base, &manifest.markup)?;
    let scripts = read_scripts_from_directory(base, &manifest.scripts)?;

    Ok((
        ThemeStyles {
            global,
            system,
            light,
            dark,
        },
        markup,
        scripts,
    ))
}

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

fn read_markup_from_directory(base: &Path, markup: &RawThemeMarkup) -> Result<ThemeMarkup, String> {
    Ok(ThemeMarkup {
        head: read_css_set_from_directory(base, &markup.head)?,
        body: read_css_set_from_directory(base, &markup.body)?,
    })
}

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
