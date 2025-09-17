use directories::ProjectDirs;
use log::warn;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Seek},
    path::{Path, PathBuf},
};
use zip::ZipArchive;

const MANIFEST_NAME: &str = "theme.json";

pub const DEFAULT_THEME_ID: &str = "default";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeSource {
    BuiltIn,
    User,
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
    pub source: ThemeSource,
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

#[derive(Debug, Clone, Serialize)]
pub struct ThemePayload {
    pub summary: ThemeSummary,
    pub styles: ThemeStyles,
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
    styles: RawThemeStyles,
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

fn themes_dir() -> PathBuf {
    if let Some(pd) = ProjectDirs::from("dev", "OpenVCS", "OpenVCS") {
        pd.config_dir().join("themes")
    } else {
        PathBuf::from("themes")
    }
}

fn ensure_dir(path: &Path) {
    if let Err(err) = fs::create_dir_all(path) {
        warn!("themes: failed to create {}: {}", path.display(), err);
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

pub fn default_theme_summary() -> ThemeSummary {
    ThemeSummary {
        id: DEFAULT_THEME_ID.to_string(),
        name: "Default".to_string(),
        description: Some("Built-in OpenVCS theme".to_string()),
        version: None,
        author: None,
        source: ThemeSource::BuiltIn,
    }
}

pub fn default_theme_payload() -> ThemePayload {
    ThemePayload {
        summary: default_theme_summary(),
        styles: ThemeStyles::default(),
    }
}

pub fn list_themes() -> Vec<ThemeSummary> {
    let dir = themes_dir();
    ensure_dir(&dir);

    let mut summaries: Vec<ThemeSummary> = Vec::new();
    let mut seen = HashSet::new();
    seen.insert(DEFAULT_THEME_ID.to_string());

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("zip"))
                .unwrap_or(false)
            {
                continue;
            }

            match read_manifest(&path) {
                Ok(manifest) => {
                    let id_trimmed = manifest.id.trim();
                    if id_trimmed.is_empty() {
                        warn!("themes: theme {} ignored due to empty id", path.display());
                        continue;
                    }
                    let norm = id_trimmed.to_ascii_lowercase();
                    if seen.contains(&norm) {
                        warn!(
                            "themes: duplicate theme id `{}` ignored (file {})",
                            id_trimmed,
                            path.display()
                        );
                        continue;
                    }
                    seen.insert(norm);

                    summaries.push(ThemeSummary {
                        id: id_trimmed.to_string(),
                        name: manifest.name.trim().to_string(),
                        description: clean_opt(manifest.description),
                        version: clean_opt(manifest.version),
                        author: clean_opt(manifest.author),
                        source: ThemeSource::User,
                    });
                }
                Err(err) => warn!("themes: failed to read {}: {}", path.display(), err),
            }
        }
    } else {
        warn!("themes: unable to read themes directory {}", dir.display());
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

    let dir = themes_dir();
    ensure_dir(&dir);

    let entries =
        fs::read_dir(&dir).map_err(|err| format!("list themes in {}: {}", dir.display(), err))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("zip"))
            .unwrap_or(false)
        {
            continue;
        }

        match read_manifest(&path) {
            Ok(manifest) => {
                if manifest.id.trim().eq_ignore_ascii_case(requested) {
                    return build_theme_payload(&path, manifest);
                }
            }
            Err(err) => warn!("themes: failed to read {}: {}", path.display(), err),
        }
    }

    Err(format!("theme `{}` not found", requested))
}

fn read_manifest(path: &Path) -> Result<RawThemeManifest, String> {
    let file = File::open(path).map_err(|err| format!("open {}: {}", path.display(), err))?;
    let mut archive =
        ZipArchive::new(file).map_err(|err| format!("read zip {}: {}", path.display(), err))?;

    for idx in 0..archive.len() {
        let mut entry = archive
            .by_index(idx)
            .map_err(|err| format!("read entry {}: {}", path.display(), err))?;
        if !entry.name().ends_with(MANIFEST_NAME) {
            continue;
        }

        let mut buf = String::new();
        entry
            .read_to_string(&mut buf)
            .map_err(|err| format!("read {} in {}: {}", entry.name(), path.display(), err))?;
        let manifest: RawThemeManifest = serde_json::from_str(&buf)
            .map_err(|err| format!("parse manifest in {}: {}", path.display(), err))?;
        if manifest.id.trim().is_empty() {
            return Err(format!("theme {} has an empty id", path.display()));
        }
        if manifest.name.trim().is_empty() {
            return Err(format!("theme {} has an empty name", path.display()));
        }
        return Ok(manifest);
    }

    Err(format!(
        "theme {} is missing {MANIFEST_NAME}",
        path.display()
    ))
}

fn build_theme_payload(path: &Path, manifest: RawThemeManifest) -> Result<ThemePayload, String> {
    let styles = read_styles(path, &manifest)?;
    let summary = ThemeSummary {
        id: manifest.id.trim().to_string(),
        name: manifest.name.trim().to_string(),
        description: clean_opt(manifest.description),
        version: clean_opt(manifest.version),
        author: clean_opt(manifest.author),
        source: ThemeSource::User,
    };

    Ok(ThemePayload { summary, styles })
}

fn read_styles(path: &Path, manifest: &RawThemeManifest) -> Result<ThemeStyles, String> {
    let file = File::open(path).map_err(|err| format!("open {}: {}", path.display(), err))?;
    let mut archive =
        ZipArchive::new(file).map_err(|err| format!("read zip {}: {}", path.display(), err))?;

    let global = read_css_set(path, &mut archive, &manifest.styles.global)?;
    let system = read_css_set(path, &mut archive, &manifest.styles.system)?;
    let light = read_css_set(path, &mut archive, &manifest.styles.light)?;
    let dark = read_css_set(path, &mut archive, &manifest.styles.dark)?;

    Ok(ThemeStyles {
        global,
        system,
        light,
        dark,
    })
}

fn read_css_set<R>(
    path: &Path,
    archive: &mut ZipArchive<R>,
    files: &[String],
) -> Result<Option<String>, String>
where
    R: Read + Seek,
{
    if files.is_empty() {
        return Ok(None);
    }

    let mut combined = String::new();
    for name in files {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut entry = archive
            .by_name(trimmed)
            .map_err(|err| format!("missing `{}` in {}: {}", trimmed, path.display(), err))?;

        let mut buf = String::new();
        entry
            .read_to_string(&mut buf)
            .map_err(|err| format!("read `{}` in {}: {}", trimmed, path.display(), err))?;

        if !buf.trim().is_empty() {
            if !combined.is_empty() && !combined.ends_with('\n') {
                combined.push('\n');
            }
            combined.push_str(&buf);
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
