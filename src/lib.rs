use zed_extension_api as zed;

mod capture;
mod render_config;

use capture::{CaptureArgs, CaptureRequest};
use render_config::RenderOptions;

const PROJECT_CONFIG_PATH: &str = ".zed-codesnap.json";

struct CodeSnapExtension;

impl zed::Extension for CodeSnapExtension {
    fn new() -> Self {
        Self
    }

    fn run_slash_command(
        &self,
        command: zed::SlashCommand,
        args: Vec<String>,
        worktree: Option<&zed::Worktree>,
    ) -> Result<zed::SlashCommandOutput, String> {
        if command.name != "codesnap" {
            return Err(format!("Unsupported CodeSnap slash command: {}", command.name));
        }

        match build_capture_request(&args, worktree) {
            Ok(request) => Ok(render_capture_request(request)),
            Err(message) => Ok(help_output(&message)),
        }
    }
}

zed::register_extension!(CodeSnapExtension);

fn build_capture_request(
    args: &[String],
    worktree: Option<&zed::Worktree>,
) -> Result<CaptureRequest, String> {
    let parsed = CaptureArgs::parse(args)?;
    let worktree_root = worktree.map(|tree| tree.root_path());
    let render_options = load_project_render_options(worktree).with_cli_overrides(parsed.render_overrides);

    if let Some(path) = parsed.path {
        let worktree = worktree.ok_or_else(|| {
            "A worktree is required when using --path. Open a project folder in Zed and retry.".to_string()
        })?;
        let clean_path = capture::normalize_relative_path(&path)?;
        let code = worktree
            .read_text_file(&clean_path)
            .map_err(|err| format!("Failed to read {clean_path}: {err}"))?;
        return CaptureRequest::from_worktree_file(
            clean_path,
            code,
            parsed.language,
            parsed.title,
            worktree_root,
            render_options,
        );
    }

    let code = parsed.code.ok_or_else(|| {
        "No selection/code was supplied. Current public Zed extension APIs do not expose the active editor selection to normal extensions.".to_string()
    })?;

    CaptureRequest::from_explicit_code(
        code,
        parsed.language,
        parsed.file_name,
        parsed.title,
        worktree_root,
        render_options,
    )
}

fn load_project_render_options(worktree: Option<&zed::Worktree>) -> RenderOptions {
    let Some(worktree) = worktree else {
        return RenderOptions::default();
    };

    worktree
        .read_text_file(PROJECT_CONFIG_PATH)
        .map(|json| RenderOptions::from_json_str(&json))
        .unwrap_or_else(|_| RenderOptions::default())
}

fn render_capture_request(request: CaptureRequest) -> zed::SlashCommandOutput {
    let line_count = request.code.lines().count();
    let char_count = request.code.chars().count();
    let file_label = request.file_name.as_deref().unwrap_or("untitled");
    let render_options = &request.render_options;

    let text = format!(
        "CodeSnap capture request prepared.\n\nSource: {}\nFile: {}\nLanguage: {}\nLines: {}\nCharacters: {}\n\nRender options:\n- Theme/style preset: {}\n- Background: {}\n- Padding: {}px\n- Rounded corners: {}px\n- Line numbers: {}\n- Window chrome: {}\n- Window title: {}\n- Font size: {}px\n- Filename pattern: {}\n- Output directory: {}\n\nRenderer handoff JSON:\n```json\n{}\n```\n\nNext boundary: pass this normalized CaptureRequest to the renderer/export module that will create PNG/SVG/HTML and save to the configured output directory.",
        request.source,
        file_label,
        request.language,
        line_count,
        char_count,
        render_options.theme_preset,
        render_options.background,
        render_options.padding,
        render_options.rounded_corners,
        yes_no(render_options.line_numbers),
        yes_no(render_options.window_chrome),
        render_options.window_title.as_deref().unwrap_or("none"),
        render_options.font_size,
        render_options.filename_pattern,
        render_options.output_directory,
        request.to_json()
    );

    zed::SlashCommandOutput {
        text,
        sections: Vec::new(),
    }
}

fn help_output(reason: &str) -> zed::SlashCommandOutput {
    let text = format!(
        "CodeSnap could not capture code yet.\n\nReason: {reason}\n\nUsage examples:\n- /codesnap --lang rust --file src/lib.rs --theme dracula --padding 24 --font-size 14 -- <paste code here>\n- /codesnap --code \"fn main() {{}}\" --lang rust --no-line-numbers\n- /codesnap --path src/lib.rs --output ~/Unduhan\n\nProject configuration: add .zed-codesnap.json at the worktree root. Invalid or missing values fall back safely to built-in defaults, including output_directory = ~/Unduhan.\n\nImportant: current public Zed extension APIs do not expose selected text, active buffer text, current file path, clipboard, custom panels, or image export to normal extensions. This command therefore handles missing selection gracefully and only prepares a normalized capture request from explicit text or an explicit worktree-relative path."
    );

    zed::SlashCommandOutput {
        text,
        sections: Vec::new(),
    }
}

fn yes_no(value: bool) -> &'static str {
    if value { "yes" } else { "no" }
}
