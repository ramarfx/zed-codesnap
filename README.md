# Zed CodeSnap

A practical CodeSnap-style helper for Zed. The reliable workflow is intentionally simple and native-feeling:

1. Select code in Zed.
2. Copy the selection with Zed's normal copy command.
3. Run the Zed task `CodeSnap: Capture Copied Selection`.
4. Read the concise terminal feedback.
5. Paste the copied PNG/JPG file where supported, or open the generated image from `~/Unduhan`.

Current public Zed extension APIs do not expose direct active-selection, clipboard, custom panel, or native image-export APIs to normal extensions. Because of that Crimson Barrier, this project avoids heavy custom UI and uses Zed's normal task/terminal interaction pattern instead.

## What is included

- `scripts/zed-codesnap.mjs` — Node CLI renderer/export helper. It reads clipboard, stdin, or a file; renders a restrained Zed-like CodeSnap output with lightweight syntax highlighting; creates the output folder when permitted; avoids filename collisions; can copy the rendered file to the OS clipboard; and prints the saved path.
- `.zed/tasks.json` — native-feeling Zed task entry point named `CodeSnap: Capture Copied Selection`.
- `extension.toml`, `Cargo.toml`, `src/*.rs` — experimental Zed slash-command wrapper that validates explicit input or worktree files and prepares a normalized render request for future extension-side integration.
- `scripts/test-cli.mjs` — functional workflow tests for save-to-Unduhan behavior, collisions, config overrides, and common errors.
- `scripts/validate-scaffold.mjs` — static scaffold and UX validation for environments without Rust/Zed.

## Install and load locally

Prerequisites:

- Zed, for running the included project task or experimenting with the slash-command wrapper.
- Node.js 18+ on your `PATH`, for `scripts/zed-codesnap.mjs`.
- Optional: Rust with the `wasm32-wasip2` target if you want to compile the experimental extension wrapper.

Local loading workflow:

1. Clone or copy this repository onto the machine where you run Zed.
2. Open the repository in Zed.
3. Use the included `.zed/tasks.json`, or copy the `CodeSnap: Capture Copied Selection` task into another project's `.zed/tasks.json`.
4. Run `node scripts/test-cli.mjs` to confirm the helper can save files on your machine.
5. For the experimental wrapper, open Zed's extension development flow and load this folder as a dev extension. The dependable day-to-day capture path remains the task/CLI helper because current public Zed APIs cannot directly read the active selection.

## Recommended Zed workflow

The repository includes this Zed task:

```json
[
  {
    "label": "CodeSnap: Capture Copied Selection",
    "command": "node scripts/zed-codesnap.mjs --from-clipboard --copy --format png --output-dir ~/Unduhan",
    "use_new_terminal": false,
    "allow_concurrent_runs": false,
    "reveal": "always"
  }
]
```

In Zed:

1. Open this project or copy the task into your own project `.zed/tasks.json`.
2. Select the code you want to capture.
3. Copy it.
4. Run `task: spawn` and choose `CodeSnap: Capture Copied Selection`.

On success, the task prints:

```text
CodeSnap saved: /home/<user>/Unduhan/codesnap-20260903-092400-rust.png
CodeSnap file copied to clipboard.
```

The default save directory is `~/Unduhan`. The helper creates it if it does not already exist and permissions allow it. If a generated filename already exists, it appends `-2`, `-3`, etc. Clipboard copy uses OS file clipboard formats, so it copies the generated `.png` or `.jpg` file reference instead of raw SVG/XML text. On Linux this requires `wl-copy` or `xclip`; otherwise the file is still saved and the terminal reports that file clipboard copy is unavailable.

Optional keybinding example:

```json
[
  {
    "context": "Editor",
    "bindings": {
      "ctrl-alt-c": ["task::Spawn", { "task_name": "CodeSnap: Capture Copied Selection" }]
    }
  }
]
```

## CLI usage

```sh
node scripts/zed-codesnap.mjs --from-clipboard --copy
node scripts/zed-codesnap.mjs --from-stdin --language rust < src/main.rs
node scripts/zed-codesnap.mjs --file src/main.rs --format jpg --output-dir ~/Unduhan
node scripts/zed-codesnap.mjs --from-stdin --format html --language typescript
```

Supported formats are `png`, `jpg`, `svg`, and `html`. The default is `png`. PNG/JPG export renders the highlighted SVG internally, then converts it with `rsvg-convert` or ImageMagick `magick`.

```text
CodeSnap: unsupported format `<format>`. Use png, jpg, svg, or html.
```

## UI copy and feedback

Messages are short and Zed-like:

Success:

```text
CodeSnap saved: ~/Unduhan/codesnap-20260903-092400.png
```

No copied code or empty input:

```text
CodeSnap: no code found. Select code in Zed, copy it, then run “CodeSnap: Capture Copied Selection”.
```

Clipboard unavailable:

```text
CodeSnap: clipboard is unavailable. Try piping code with `zed-codesnap --from-stdin`.
```

Save failure:

```text
CodeSnap: failed to save to ~/Unduhan. Check that the folder exists and is writable, or set `output_dir`.
```

Unsupported format:

```text
CodeSnap: unsupported format `<format>`. Use png, jpg, svg, or html.
```

## Configuration

Lookup order for the CLI helper:

1. CLI flags.
2. Project config file: `.zed-codesnap.json`.
3. Built-in defaults.

The experimental Zed slash-command wrapper reads project `.zed-codesnap.json` when a worktree is available, then applies slash-command CLI-style overrides. It does not read arbitrary home-directory files because the current public Zed extension API does not provide that general access.

Example `.zed-codesnap.json`:

```json
{
  "theme_preset": "one-dark-pro",
  "background": "#282c34",
  "padding": 24,
  "rounded_corners": 12,
  "line_numbers": false,
  "window_chrome": false,
  "window_title": null,
  "font_size": 14,
  "filename_pattern": "codesnap-{timestamp}-{slug}.{ext}",
  "output_directory": "~/Unduhan",
  "format": "png",
  "copy_to_clipboard": true
}
```

Settings schema:

- `output_directory` / CLI `--output-dir`, `--output-directory`, `--output`: destination directory. Default: `~/Unduhan`.
- `format` / CLI `--format`: `png`, `jpg`, `svg`, or `html`. Default: `png`.
- `copy_to_clipboard` / CLI `--copy`, `--copy-to-clipboard`, `--no-copy`: copy the rendered file after saving. Default: `true` in the CLI helper.
- `theme_preset` / alias `theme`: style metadata. Default: `one-dark-pro`.
- `background`: safe CSS color name, `transparent`, `#rgb`, or `#rrggbb`. Default: `#282c34`.
- `padding`: integer pixels from 0 to 128. Default: `24` in CLI helper, `32` in the experimental extension boundary.
- `rounded_corners` / alias `corner_radius`: integer pixels from 0 to 64. Default: `12`.
- `line_numbers` / alias `show_line_numbers`: boolean. Default: `false`.
- `window_chrome`: accepted for compatibility, but the current renderer intentionally omits the three-dot window chrome.
- `window_title`: optional title metadata for future renderers; the current minimal image renderer does not draw a title bar.
- `font_size`: integer pixels from 8 to 48. Default: `14` in CLI helper, `16` in the experimental extension boundary.
- `filename_pattern`: must include `{ext}` and must not contain path separators. Supported tokens: `{timestamp}`, `{language}`, `{filename}`, `{slug}`, `{ext}`.

Invalid or missing values fall back safely to the current config value or built-in defaults. Do not edit source code to change routine appearance or output location.

## Experimental slash-command usage

The Zed extension wrapper is included as an experimental boundary only. In assistant slash-command contexts:

```text
/codesnap --lang rust --file src/lib.rs -- fn main() {}
/codesnap --path src/lib.rs --theme dracula --padding 24 --output ~/Unduhan
```

If no explicit code or path is provided, it returns a capability warning and usage help instead of claiming it captured the selection.

## Local development and verification

If Rust is available, Zed uses the `wasm32-wasip2` target when compiling procedural extensions:

```sh
rustup target add wasm32-wasip2
cargo check --target wasm32-wasip2
```

This worker environment only has Node available, so the verified checks are:

```sh
node scripts/test-cli.mjs
node scripts/validate-scaffold.mjs
```

The CLI test covers the happy path, PNG/JPG export, syntax-highlighted SVG source output, missing `~/Unduhan` creation, collision-safe names, changed configuration values, empty/no-selection input, unsupported language metadata, unsupported format feedback, clipboard-copy feedback, and failed save feedback. Full native Zed loading and Rust compilation still require a machine with Zed and Rust installed.

## Verification checklist

Run:

```sh
node scripts/test-cli.mjs
node scripts/validate-scaffold.mjs
```

Manual smoke test in Zed:

1. Select a small code block.
2. Copy it.
3. Run `task: spawn` → `CodeSnap: Capture Copied Selection`.
4. Confirm the terminal prints `CodeSnap saved: ...`, then either `CodeSnap file copied to clipboard.` or a clipboard-tool warning.

Acceptance coverage confirmed by the automated checklist:

- Working CodeSnap-style output generation from stdin/file/clipboard helper paths.
- Native-feeling Zed task entry point: `CodeSnap: Capture Copied Selection`.
- Practical workflow: select, copy, run task, paste copied PNG/JPG file or open saved output.
- One Dark Pro-style syntax-highlighted image output for common code tokens.
- Minimal image frame: code only, with no three-dot window ornament.
- Configurable render settings via `.zed-codesnap.json` and CLI overrides.
- Default save location is `~/Unduhan`; missing directories are created recursively.
- Filename collisions receive numeric suffixes instead of overwriting existing output.
- Optional clipboard output reports success or a non-fatal tooling warning.
- Empty selection/no input fails with actionable guidance.
- Unsupported language metadata falls back safely and cannot escape the filename pattern.
- Unsupported formats fail clearly.
- Failed saves return a non-zero exit and filesystem error context.

## Known limitations

- Current public Zed extension APIs do not expose direct active-selection capture, arbitrary clipboard access, custom panels/webviews, or native image export for normal extensions.
- PNG/JPG export requires `rsvg-convert` or ImageMagick `magick` on the machine running the helper.
- Clipboard file support depends on the receiving app and installed OS clipboard tooling. Linux file clipboard copy requires `wl-copy` or `xclip`.
- The experimental slash command is an integration boundary, not the recommended daily workflow.

## Troubleshooting

- `CodeSnap: no code found...` — copy the selected text first, or use `--from-stdin` / `--file`.
- `CodeSnap: clipboard is unavailable...` — install a supported clipboard tool (`wl-paste`, `xclip`, or `xsel`) or pipe code via stdin.
- `CodeSnap: unsupported format ...` — set `"format": "png"`, `"format": "jpg"`, `"format": "svg"`, or `"format": "html"`.
- Save errors under `~/Unduhan` — check write permissions, remove conflicting files that block directory creation, or set `--output-dir <writable-folder>`.
- Configuration changes seem ignored — validate that `.zed-codesnap.json` is in the project root and contains valid JSON; invalid values intentionally fall back to safe defaults.
