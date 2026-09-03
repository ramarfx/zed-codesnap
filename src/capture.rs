use zed_extension_api as zed;

use crate::render_config::{RenderOptionOverrides, RenderOptions};

pub const DEFAULT_LANGUAGE: &str = "text";
pub const DEFAULT_SOURCE: &str = "slash-command-argument";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureRequest {
    pub code: String,
    pub language: String,
    pub file_name: Option<String>,
    pub title: Option<String>,
    pub worktree_root: Option<String>,
    pub source: String,
    pub render_options: RenderOptions,
}

impl CaptureRequest {
    pub fn from_explicit_code(
        code: String,
        language: Option<String>,
        file_name: Option<String>,
        title: Option<String>,
        worktree_root: Option<String>,
        render_options: RenderOptions,
    ) -> Result<Self, String> {
        let code = normalize_code(code)?;
        let mut render_options = render_options;
        if render_options.window_title.is_none() {
            render_options.window_title = title.clone().or_else(|| file_name.clone());
        }
        Ok(Self {
            code,
            language: normalize_language(language, file_name.as_deref()),
            file_name,
            title,
            worktree_root,
            source: DEFAULT_SOURCE.to_string(),
            render_options,
        })
    }

    pub fn from_worktree_file(
        path: String,
        code: String,
        language: Option<String>,
        title: Option<String>,
        worktree_root: Option<String>,
        render_options: RenderOptions,
    ) -> Result<Self, String> {
        let clean_path = normalize_relative_path(&path)?;
        let code = normalize_code(code)?;
        let mut render_options = render_options;
        if render_options.window_title.is_none() {
            render_options.window_title = title.clone().or_else(|| Some(clean_path.clone()));
        }
        Ok(Self {
            code,
            language: normalize_language(language, Some(&clean_path)),
            file_name: Some(clean_path),
            title,
            worktree_root,
            source: "worktree-file".to_string(),
            render_options,
        })
    }

    pub fn to_json(&self) -> String {
        let value = zed::serde_json::json!({
            "code": self.code,
            "language": self.language,
            "file_name": self.file_name,
            "title": self.title,
            "worktree_root": self.worktree_root,
            "source": self.source,
            "render_options": self.render_options.to_json_value(),
        });

        zed::serde_json::to_string_pretty(&value)
            .unwrap_or_else(|_| "{\"error\":\"failed to serialize capture request\"}".to_string())
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct CaptureArgs {
    pub code: Option<String>,
    pub path: Option<String>,
    pub language: Option<String>,
    pub file_name: Option<String>,
    pub title: Option<String>,
    pub render_overrides: RenderOptionOverrides,
}

impl CaptureArgs {
    pub fn parse(args: &[String]) -> Result<Self, String> {
        let mut parsed = CaptureArgs::default();
        let mut rest = Vec::new();
        let mut i = 0;

        while i < args.len() {
            match args[i].as_str() {
                "--code" => {
                    i += 1;
                    parsed.code = Some(take_value(args, i, "--code")?);
                }
                "--path" => {
                    i += 1;
                    parsed.path = Some(take_value(args, i, "--path")?);
                }
                "--lang" | "--language" => {
                    i += 1;
                    parsed.language = Some(take_value(args, i, "--lang")?);
                }
                "--file" | "--file-name" => {
                    i += 1;
                    parsed.file_name = Some(take_value(args, i, "--file")?);
                }
                "--title" => {
                    i += 1;
                    parsed.title = Some(take_value(args, i, "--title")?);
                }
                "--theme" | "--theme-preset" => {
                    i += 1;
                    parsed.render_overrides.theme_preset = Some(take_value(args, i, "--theme")?);
                }
                "--background" => {
                    i += 1;
                    parsed.render_overrides.background = Some(take_value(args, i, "--background")?);
                }
                "--padding" => {
                    i += 1;
                    parsed.render_overrides.padding = Some(take_value(args, i, "--padding")?);
                }
                "--rounded-corners" | "--radius" => {
                    i += 1;
                    parsed.render_overrides.rounded_corners = Some(take_value(args, i, "--rounded-corners")?);
                }
                "--line-numbers" => parsed.render_overrides.line_numbers = Some(true),
                "--no-line-numbers" => parsed.render_overrides.line_numbers = Some(false),
                "--window-chrome" => parsed.render_overrides.window_chrome = Some(true),
                "--no-window-chrome" => parsed.render_overrides.window_chrome = Some(false),
                "--window-title" => {
                    i += 1;
                    parsed.render_overrides.window_title = Some(take_value(args, i, "--window-title")?);
                }
                "--font-size" => {
                    i += 1;
                    parsed.render_overrides.font_size = Some(take_value(args, i, "--font-size")?);
                }
                "--filename-pattern" => {
                    i += 1;
                    parsed.render_overrides.filename_pattern = Some(take_value(args, i, "--filename-pattern")?);
                }
                "--output" | "--output-directory" => {
                    i += 1;
                    parsed.render_overrides.output_directory = Some(take_value(args, i, "--output")?);
                }
                "--" => {
                    rest.extend(args[i + 1..].iter().cloned());
                    break;
                }
                value => rest.push(value.to_string()),
            }
            i += 1;
        }

        if parsed.code.is_none() && !rest.is_empty() {
            parsed.code = Some(rest.join(" "));
        }

        if parsed.code.is_some() && parsed.path.is_some() {
            return Err("Use either --code/text input or --path, not both.".to_string());
        }

        Ok(parsed)
    }
}

pub fn normalize_code(code: String) -> Result<String, String> {
    let normalized = code.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalized.trim_matches('\n').to_string();
    if trimmed.trim().is_empty() {
        return Err("No code was provided. Copy a selection and pass it with --code, paste it after --, or provide --path <relative-file>.".to_string());
    }
    Ok(trimmed)
}

pub fn normalize_language(language: Option<String>, file_name: Option<&str>) -> String {
    if let Some(language) = language {
        let language = language.trim().trim_start_matches('.').to_ascii_lowercase();
        if !language.is_empty() {
            return language;
        }
    }

    file_name
        .and_then(language_from_file_name)
        .unwrap_or(DEFAULT_LANGUAGE)
        .to_string()
}

pub fn normalize_relative_path(path: &str) -> Result<String, String> {
    let clean = path.trim().trim_start_matches("./");
    if clean.is_empty() {
        return Err("--path requires a non-empty relative path.".to_string());
    }
    if clean.starts_with('/') || clean.contains("..") {
        return Err("--path must be a relative path inside the current Zed worktree.".to_string());
    }
    Ok(clean.to_string())
}

fn language_from_file_name(file_name: &str) -> Option<&'static str> {
    let ext = file_name.rsplit('.').next()?;
    match ext.to_ascii_lowercase().as_str() {
        "rs" => Some("rust"),
        "js" | "jsx" => Some("javascript"),
        "ts" | "tsx" => Some("typescript"),
        "py" => Some("python"),
        "go" => Some("go"),
        "java" => Some("java"),
        "kt" | "kts" => Some("kotlin"),
        "c" | "h" => Some("c"),
        "cc" | "cpp" | "cxx" | "hpp" => Some("cpp"),
        "cs" => Some("csharp"),
        "php" => Some("php"),
        "rb" => Some("ruby"),
        "swift" => Some("swift"),
        "html" | "htm" => Some("html"),
        "css" => Some("css"),
        "scss" | "sass" => Some("scss"),
        "json" => Some("json"),
        "toml" => Some("toml"),
        "yaml" | "yml" => Some("yaml"),
        "md" | "markdown" => Some("markdown"),
        "sh" | "bash" | "zsh" => Some("shell"),
        _ => None,
    }
}

fn take_value(args: &[String], index: usize, flag: &str) -> Result<String, String> {
    args.get(index)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or_else(|| format!("{flag} requires a value."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rest_as_code() {
        let args = vec!["--lang".into(), "rs".into(), "--".into(), "fn".into(), "main()".into()];
        let parsed = CaptureArgs::parse(&args).unwrap();
        assert_eq!(parsed.language, Some("rs".into()));
        assert_eq!(parsed.code, Some("fn main()".into()));
    }

    #[test]
    fn parses_render_overrides() {
        let args = vec![
            "--theme".into(),
            "dracula".into(),
            "--padding".into(),
            "24".into(),
            "--no-line-numbers".into(),
            "--font-size".into(),
            "14".into(),
            "--".into(),
            "fn main() {}".into(),
        ];
        let parsed = CaptureArgs::parse(&args).unwrap();
        assert_eq!(parsed.render_overrides.theme_preset, Some("dracula".into()));
        assert_eq!(parsed.render_overrides.padding, Some("24".into()));
        assert_eq!(parsed.render_overrides.line_numbers, Some(false));
        assert_eq!(parsed.render_overrides.font_size, Some("14".into()));
    }

    #[test]
    fn detects_language_from_file_name() {
        assert_eq!(normalize_language(None, Some("src/lib.rs")), "rust");
    }

    #[test]
    fn rejects_empty_code() {
        assert!(normalize_code("  \n".into()).is_err());
    }

    #[test]
    fn request_serializes_render_options() {
        let request = CaptureRequest::from_explicit_code(
            "fn main() {}".into(),
            Some("rust".into()),
            Some("main.rs".into()),
            None,
            None,
            RenderOptions::default(),
        )
        .unwrap();
        let json = request.to_json();
        assert!(json.contains("render_options"));
        assert!(json.contains("~/Unduhan"));
    }
}
