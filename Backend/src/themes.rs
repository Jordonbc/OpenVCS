use directories::ProjectDirs;
use log::warn;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    env,
    fs::{self, File},
    io::{Read, Seek},
    path::{Path, PathBuf},
};
use zip::ZipArchive;

const MANIFEST_NAME: &str = "theme.json";
const BUILT_IN_THEMES_DIR_NAME: &str = "built-in-themes";

pub const DEFAULT_THEME_ID: &str = "default";

fn built_in_theme_dirs() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(explicit) = env::var("OPENVCS_BUILTIN_THEMES") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed));
        }
    }

    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir.join(BUILT_IN_THEMES_DIR_NAME));
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(BUILT_IN_THEMES_DIR_NAME));
            candidates.push(dir.join("resources").join(BUILT_IN_THEMES_DIR_NAME));
            #[cfg(target_os = "macos")]
            if let Some(parent) = dir.parent() {
                candidates.push(parent.join("Resources").join(BUILT_IN_THEMES_DIR_NAME));
            }
        }
    }

    candidates.push(PathBuf::from("Backend").join(BUILT_IN_THEMES_DIR_NAME));
    candidates.push(PathBuf::from(BUILT_IN_THEMES_DIR_NAME));
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(BUILT_IN_THEMES_DIR_NAME));

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

fn themes_dir() -> PathBuf {
    if let Some(pd) = ProjectDirs::from("dev", "OpenVCS", "OpenVCS") {
        pd.config_dir().join("themes")
    } else {
        PathBuf::from("themes")
    }
}

fn is_zip_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
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
        markup: ThemeMarkup::default(),
        scripts: Vec::new(),
    }
}

pub fn list_themes() -> Vec<ThemeSummary> {
    let dir = themes_dir();
    ensure_dir(&dir);

    let mut summaries: Vec<ThemeSummary> = Vec::new();
    let mut seen = HashSet::new();
    seen.insert(DEFAULT_THEME_ID.to_string());

    let built_in_dirs = built_in_theme_dirs();
    if built_in_dirs.is_empty() {
        warn!("themes: no built-in theme directories located");
    }
    for dir in built_in_dirs {
        match fs::read_dir(&dir) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && is_zip_file(&path) {
                        match read_manifest(&path) {
                            Ok(manifest) => {
                                let id_trimmed = manifest.id.trim();
                                if id_trimmed.is_empty() {
                                    warn!(
                                        "themes: theme {} ignored due to empty id",
                                        path.display()
                                    );
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
                                    source: ThemeSource::BuiltIn,
                                });
                            }
                            Err(err) => warn!("themes: failed to read {}: {}", path.display(), err),
                        }
                    } else if path.is_dir() {
                        match read_manifest_from_directory(&path) {
                            Ok(manifest) => {
                                let id_trimmed = manifest.id.trim();
                                if id_trimmed.is_empty() {
                                    warn!(
                                        "themes: theme {} ignored due to empty id",
                                        path.display()
                                    );
                                    continue;
                                }
                                let norm = id_trimmed.to_ascii_lowercase();
                                if seen.contains(&norm) {
                                    warn!(
                                        "themes: duplicate theme id `{}` ignored (dir {})",
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
                                    source: ThemeSource::BuiltIn,
                                });
                            }
                            Err(err) => warn!("themes: failed to read {}: {}", path.display(), err),
                        }
                    }
                }
            }
            Err(err) => warn!("themes: failed to list {}: {}", dir.display(), err),
        }
    }

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !is_zip_file(&path) {
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

    for dir in built_in_theme_dirs() {
        match fs::read_dir(&dir) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && is_zip_file(&path) {
                        match read_manifest(&path) {
                            Ok(manifest) => {
                                if manifest.id.trim().eq_ignore_ascii_case(requested) {
                                    return build_theme_payload_from_path(
                                        &path,
                                        manifest,
                                        ThemeSource::BuiltIn,
                                    );
                                }
                            }
                            Err(err) => warn!("themes: failed to read {}: {}", path.display(), err),
                        }
                    } else if path.is_dir() {
                        match read_manifest_from_directory(&path) {
                            Ok(manifest) => {
                                if manifest.id.trim().eq_ignore_ascii_case(requested) {
                                    return build_theme_payload_from_directory(
                                        &path,
                                        manifest,
                                        ThemeSource::BuiltIn,
                                    );
                                }
                            }
                            Err(err) => warn!("themes: failed to read {}: {}", path.display(), err),
                        }
                    }
                }
            }
            Err(err) => warn!("themes: failed to list {}: {}", dir.display(), err),
        }
    }

    let dir = themes_dir();
    ensure_dir(&dir);

    let entries =
        fs::read_dir(&dir).map_err(|err| format!("list themes in {}: {}", dir.display(), err))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !is_zip_file(&path) {
            continue;
        }

        match read_manifest(&path) {
            Ok(manifest) => {
                if manifest.id.trim().eq_ignore_ascii_case(requested) {
                    return build_theme_payload_from_path(&path, manifest, ThemeSource::User);
                }
            }
            Err(err) => warn!("themes: failed to read {}: {}", path.display(), err),
        }
    }

    Err(format!("theme `{}` not found", requested))
}

fn read_manifest(path: &Path) -> Result<RawThemeManifest, String> {
    let file = File::open(path).map_err(|err| format!("open {}: {}", path.display(), err))?;
    read_manifest_from_reader(&path.display().to_string(), file)
}

fn read_manifest_from_reader<R>(name: &str, reader: R) -> Result<RawThemeManifest, String>
where
    R: Read + Seek,
{
    let mut archive =
        ZipArchive::new(reader).map_err(|err| format!("read zip {}: {}", name, err))?;
    read_manifest_from_archive(name, &mut archive)
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

fn read_manifest_from_archive<R>(
    name: &str,
    archive: &mut ZipArchive<R>,
) -> Result<RawThemeManifest, String>
where
    R: Read + Seek,
{
    for idx in 0..archive.len() {
        let mut entry = archive
            .by_index(idx)
            .map_err(|err| format!("read entry {}: {}", name, err))?;
        if !entry.name().ends_with(MANIFEST_NAME) {
            continue;
        }

        let mut buf = String::new();
        entry
            .read_to_string(&mut buf)
            .map_err(|err| format!("read {} in {}: {}", entry.name(), name, err))?;
        let manifest: RawThemeManifest = serde_json::from_str(&buf)
            .map_err(|err| format!("parse manifest in {}: {}", name, err))?;
        if manifest.id.trim().is_empty() {
            return Err(format!("theme {} has an empty id", name));
        }
        if manifest.name.trim().is_empty() {
            return Err(format!("theme {} has an empty name", name));
        }
        return Ok(manifest);
    }

    Err(format!("theme {} is missing {MANIFEST_NAME}", name))
}

fn build_theme_payload_from_path(
    path: &Path,
    manifest: RawThemeManifest,
    source: ThemeSource,
) -> Result<ThemePayload, String> {
    let file = File::open(path).map_err(|err| format!("open {}: {}", path.display(), err))?;
    build_theme_payload_from_reader(&path.display().to_string(), file, manifest, source)
}

fn build_theme_payload_from_reader<R>(
    name: &str,
    reader: R,
    manifest: RawThemeManifest,
    source: ThemeSource,
) -> Result<ThemePayload, String>
where
    R: Read + Seek,
{
    let (styles, markup, scripts) = read_assets_from_reader(name, reader, &manifest)?;
    let summary = ThemeSummary {
        id: manifest.id.trim().to_string(),
        name: manifest.name.trim().to_string(),
        description: clean_opt(manifest.description),
        version: clean_opt(manifest.version),
        author: clean_opt(manifest.author),
        source,
    };

    Ok(ThemePayload {
        summary,
        styles,
        markup,
        scripts,
    })
}

fn read_assets_from_reader<R>(
    name: &str,
    reader: R,
    manifest: &RawThemeManifest,
) -> Result<(ThemeStyles, ThemeMarkup, Vec<String>), String>
where
    R: Read + Seek,
{
    let mut archive =
        ZipArchive::new(reader).map_err(|err| format!("read zip {}: {}", name, err))?;
    read_assets_from_archive(name, &mut archive, manifest)
}

fn read_assets_from_archive<R>(
    name: &str,
    archive: &mut ZipArchive<R>,
    manifest: &RawThemeManifest,
) -> Result<(ThemeStyles, ThemeMarkup, Vec<String>), String>
where
    R: Read + Seek,
{
    let global = read_css_set(name, archive, &manifest.styles.global)?;
    let system = read_css_set(name, archive, &manifest.styles.system)?;
    let light = read_css_set(name, archive, &manifest.styles.light)?;
    let dark = read_css_set(name, archive, &manifest.styles.dark)?;
    let markup = read_markup_sets(name, archive, &manifest.markup)?;
    let scripts = read_script_set(name, archive, &manifest.scripts)?;

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

fn read_css_set<R>(
    display: &str,
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
            .map_err(|err| format!("missing `{}` in {}: {}", trimmed, display, err))?;

        let mut buf = String::new();
        entry
            .read_to_string(&mut buf)
            .map_err(|err| format!("read `{}` in {}: {}", trimmed, display, err))?;

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

fn read_markup_sets<R>(
    display: &str,
    archive: &mut ZipArchive<R>,
    markup: &RawThemeMarkup,
) -> Result<ThemeMarkup, String>
where
    R: Read + Seek,
{
    Ok(ThemeMarkup {
        head: read_css_set(display, archive, &markup.head)?,
        body: read_css_set(display, archive, &markup.body)?,
    })
}

fn read_script_set<R>(
    display: &str,
    archive: &mut ZipArchive<R>,
    files: &[String],
) -> Result<Vec<String>, String>
where
    R: Read + Seek,
{
    if files.is_empty() {
        return Ok(Vec::new());
    }

    let mut scripts = Vec::new();
    for name in files {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut entry = archive
            .by_name(trimmed)
            .map_err(|err| format!("missing `{}` in {}: {}", trimmed, display, err))?;

        let mut buf = String::new();
        entry
            .read_to_string(&mut buf)
            .map_err(|err| format!("read `{}` in {}: {}", trimmed, display, err))?;

        if !buf.trim().is_empty() {
            scripts.push(buf);
        }
    }

    Ok(scripts)
}

fn build_theme_payload_from_directory(
    path: &Path,
    manifest: RawThemeManifest,
    source: ThemeSource,
) -> Result<ThemePayload, String> {
    let (styles, markup, scripts) = read_assets_from_directory(path, &manifest)?;
    let summary = ThemeSummary {
        id: manifest.id.trim().to_string(),
        name: manifest.name.trim().to_string(),
        description: clean_opt(manifest.description),
        version: clean_opt(manifest.version),
        author: clean_opt(manifest.author),
        source,
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

fn read_css_set_from_directory(
    base: &Path,
    files: &[String],
) -> Result<Option<String>, String> {
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

    Ok(if combined.trim().is_empty() { None } else { Some(combined) })
}

fn read_markup_from_directory(
    base: &Path,
    markup: &RawThemeMarkup,
) -> Result<ThemeMarkup, String> {
    Ok(ThemeMarkup {
        head: read_css_set_from_directory(base, &markup.head)?,
        body: read_css_set_from_directory(base, &markup.body)?,
    })
}

fn read_scripts_from_directory(
    base: &Path,
    files: &[String],
) -> Result<Vec<String>, String> {
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
