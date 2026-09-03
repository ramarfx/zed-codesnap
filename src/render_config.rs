use zed_extension_api as zed;

pub const DEFAULT_THEME_PRESET: &str = "one-dark-pro";
pub const DEFAULT_BACKGROUND: &str = "#282c34";
pub const DEFAULT_PADDING: u32 = 32;
pub const DEFAULT_ROUNDED_CORNERS: u32 = 12;
pub const DEFAULT_LINE_NUMBERS: bool = false;
pub const DEFAULT_WINDOW_CHROME: bool = false;
pub const DEFAULT_FONT_SIZE: u32 = 16;
pub const DEFAULT_FILENAME_PATTERN: &str = "codesnap-{timestamp}-{slug}.{ext}";
pub const DEFAULT_OUTPUT_DIRECTORY: &str = "~/Unduhan";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderOptions {
    pub theme_preset: String,
    pub background: String,
    pub padding: u32,
    pub rounded_corners: u32,
    pub line_numbers: bool,
    pub window_chrome: bool,
    pub window_title: Option<String>,
    pub font_size: u32,
    pub filename_pattern: String,
    pub output_directory: String,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct RenderOptionOverrides {
    pub theme_preset: Option<String>,
    pub background: Option<String>,
    pub padding: Option<String>,
    pub rounded_corners: Option<String>,
    pub line_numbers: Option<bool>,
    pub window_chrome: Option<bool>,
    pub window_title: Option<String>,
    pub font_size: Option<String>,
    pub filename_pattern: Option<String>,
    pub output_directory: Option<String>,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            theme_preset: DEFAULT_THEME_PRESET.to_string(),
            background: DEFAULT_BACKGROUND.to_string(),
            padding: DEFAULT_PADDING,
            rounded_corners: DEFAULT_ROUNDED_CORNERS,
            line_numbers: DEFAULT_LINE_NUMBERS,
            window_chrome: DEFAULT_WINDOW_CHROME,
            window_title: None,
            font_size: DEFAULT_FONT_SIZE,
            filename_pattern: DEFAULT_FILENAME_PATTERN.to_string(),
            output_directory: DEFAULT_OUTPUT_DIRECTORY.to_string(),
        }
    }
}

impl RenderOptions {
    pub fn from_json_str(json: &str) -> Self {
        let mut options = Self::default();
        let Ok(value) = zed::serde_json::from_str::<zed::serde_json::Value>(json) else {
            return options;
        };
        let Some(object) = value.as_object() else {
            return options;
        };

        if let Some(value) = string_value(object.get("theme_preset").or_else(|| object.get("theme"))) {
            options.theme_preset = sanitize_theme_preset(value, &options.theme_preset);
        }
        if let Some(value) = string_value(object.get("background")) {
            options.background = sanitize_color(value, &options.background);
        }
        if let Some(value) = u32_value(object.get("padding")) {
            options.padding = clamp_u32(value, 0, 128, DEFAULT_PADDING);
        }
        if let Some(value) = u32_value(object.get("rounded_corners").or_else(|| object.get("radius"))) {
            options.rounded_corners = clamp_u32(value, 0, 64, DEFAULT_ROUNDED_CORNERS);
        }
        if let Some(value) = bool_value(object.get("line_numbers")) {
            options.line_numbers = value;
        }
        if let Some(value) = bool_value(object.get("window_chrome")) {
            options.window_chrome = value;
        }
        if let Some(value) = optional_string_value(object.get("window_title")) {
            options.window_title = value;
        }
        if let Some(value) = u32_value(object.get("font_size")) {
            options.font_size = clamp_u32(value, 8, 48, DEFAULT_FONT_SIZE);
        }
        if let Some(value) = string_value(object.get("filename_pattern")) {
            options.filename_pattern = sanitize_pattern(value, &options.filename_pattern);
        }
        if let Some(value) = string_value(object.get("output_directory")) {
            options.output_directory = sanitize_directory(value, &options.output_directory);
        }

        options
    }

    pub fn apply_cli_overrides(&mut self, overrides: RenderOptionOverrides) {
        if let Some(value) = overrides.theme_preset {
            self.theme_preset = sanitize_theme_preset(&value, &self.theme_preset);
        }
        if let Some(value) = overrides.background {
            self.background = sanitize_color(&value, &self.background);
        }
        if let Some(value) = overrides.padding {
            self.padding = parse_bounded_u32(&value, 0, 128, self.padding);
        }
        if let Some(value) = overrides.rounded_corners {
            self.rounded_corners = parse_bounded_u32(&value, 0, 64, self.rounded_corners);
        }
        if let Some(value) = overrides.line_numbers {
            self.line_numbers = value;
        }
        if let Some(value) = overrides.window_chrome {
            self.window_chrome = value;
        }
        if let Some(value) = overrides.window_title {
            self.window_title = normalize_optional_string(&value);
        }
        if let Some(value) = overrides.font_size {
            self.font_size = parse_bounded_u32(&value, 8, 48, self.font_size);
        }
        if let Some(value) = overrides.filename_pattern {
            self.filename_pattern = sanitize_pattern(&value, &self.filename_pattern);
        }
        if let Some(value) = overrides.output_directory {
            self.output_directory = sanitize_directory(&value, &self.output_directory);
        }
    }

    pub fn with_cli_overrides(mut self, overrides: RenderOptionOverrides) -> Self {
        self.apply_cli_overrides(overrides);
        self
    }

    pub fn to_json_value(&self) -> zed::serde_json::Value {
        zed::serde_json::json!({
            "theme_preset": self.theme_preset,
            "background": self.background,
            "padding": self.padding,
            "rounded_corners": self.rounded_corners,
            "line_numbers": self.line_numbers,
            "window_chrome": self.window_chrome,
            "window_title": self.window_title,
            "font_size": self.font_size,
            "filename_pattern": self.filename_pattern,
            "output_directory": self.output_directory,
        })
    }

    pub fn to_json(&self) -> String {
        zed::serde_json::to_string_pretty(&self.to_json_value())
            .unwrap_or_else(|_| "{\"error\":\"failed to serialize render options\"}".to_string())
    }
}

pub fn clamp_u32(value: u32, min: u32, max: u32, fallback: u32) -> u32 {
    if value < min || value > max {
        fallback
    } else {
        value
    }
}

pub fn parse_bounded_u32(value: &str, min: u32, max: u32, fallback: u32) -> u32 {
    value
        .trim()
        .parse::<u32>()
        .ok()
        .map(|number| clamp_u32(number, min, max, fallback))
        .unwrap_or(fallback)
}

pub fn sanitize_color(value: &str, fallback: &str) -> String {
    let clean = value.trim();
    if clean.eq_ignore_ascii_case("transparent") {
        return "transparent".to_string();
    }
    if is_hex_color(clean) || is_safe_css_name(clean) {
        return clean.to_string();
    }
    fallback.to_string()
}

fn sanitize_theme_preset(value: &str, fallback: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "zed-dark" | "zed-light" | "github-dark" | "github-light" | "dracula" | "nord" | "one-dark" | "one-dark-pro" => value.trim().to_ascii_lowercase(),
        _ => fallback.to_string(),
    }
}

fn sanitize_pattern(value: &str, fallback: &str) -> String {
    let clean = value.trim();
    if clean.is_empty() || clean.contains('/') || clean.contains('\\') || !clean.contains("{ext}") {
        fallback.to_string()
    } else {
        clean.to_string()
    }
}

fn sanitize_directory(value: &str, fallback: &str) -> String {
    let clean = value.trim();
    if clean.is_empty() || clean.contains('\0') {
        fallback.to_string()
    } else {
        clean.to_string()
    }
}

fn is_hex_color(value: &str) -> bool {
    let hex = value.strip_prefix('#').unwrap_or_default();
    matches!(hex.len(), 3 | 6) && hex.chars().all(|char| char.is_ascii_hexdigit())
}

fn is_safe_css_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || char == '-' || char == '_')
}

fn string_value(value: Option<&zed::serde_json::Value>) -> Option<&str> {
    value.and_then(|value| value.as_str()).map(str::trim).filter(|value| !value.is_empty())
}

fn optional_string_value(value: Option<&zed::serde_json::Value>) -> Option<Option<String>> {
    match value {
        Some(zed::serde_json::Value::Null) => Some(None),
        Some(value) => value.as_str().map(normalize_optional_string),
        None => None,
    }
}

fn normalize_optional_string(value: &str) -> Option<String> {
    let clean = value.trim();
    if clean.is_empty() {
        None
    } else {
        Some(clean.to_string())
    }
}

fn bool_value(value: Option<&zed::serde_json::Value>) -> Option<bool> {
    value.and_then(|value| value.as_bool())
}

fn u32_value(value: Option<&zed::serde_json::Value>) -> Option<u32> {
    let number = value?.as_u64()?;
    u32::try_from(number).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_save_to_downloads_with_codesnap_style() {
        let options = RenderOptions::default();
        assert_eq!(options.output_directory, "~/Unduhan");
        assert_eq!(options.theme_preset, "one-dark-pro");
        assert!(!options.line_numbers);
        assert!(!options.window_chrome);
    }

    #[test]
    fn reads_json_config_and_falls_back_for_invalid_values() {
        let options = RenderOptions::from_json_str(
            r##"{
                "theme_preset": "dracula",
                "background": "#282a36",
                "padding": 24,
                "rounded_corners": 999,
                "line_numbers": false,
                "window_chrome": false,
                "window_title": "demo.rs",
                "font_size": 14,
                "filename_pattern": "snap-{slug}.{ext}",
                "output_directory": "~/Pictures"
            }"##,
        );

        assert_eq!(options.theme_preset, "dracula");
        assert_eq!(options.background, "#282a36");
        assert_eq!(options.padding, 24);
        assert_eq!(options.rounded_corners, DEFAULT_ROUNDED_CORNERS);
        assert!(!options.line_numbers);
        assert!(!options.window_chrome);
        assert_eq!(options.window_title, Some("demo.rs".to_string()));
        assert_eq!(options.font_size, 14);
        assert_eq!(options.filename_pattern, "snap-{slug}.{ext}");
        assert_eq!(options.output_directory, "~/Pictures");
    }

    #[test]
    fn cli_overrides_win_over_config_without_accepting_bad_values() {
        let mut options = RenderOptions::from_json_str(r#"{"theme_preset":"nord","padding":20}"#);
        options.apply_cli_overrides(RenderOptionOverrides {
            theme_preset: Some("unknown".to_string()),
            padding: Some("48".to_string()),
            font_size: Some("999".to_string()),
            ..RenderOptionOverrides::default()
        });

        assert_eq!(options.theme_preset, "nord");
        assert_eq!(options.padding, 48);
        assert_eq!(options.font_size, DEFAULT_FONT_SIZE);
    }
}
