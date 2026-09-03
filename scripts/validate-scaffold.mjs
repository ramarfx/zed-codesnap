import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'extension.toml',
  'Cargo.toml',
  'src/lib.rs',
  'src/capture.rs',
  'src/render_config.rs',
  'scripts/validate-scaffold.mjs',
  'scripts/zed-codesnap.mjs',
  'scripts/test-cli.mjs',
  '.zed/tasks.json',
  'README.md',
];

let failures = 0;

function check(condition, message) {
  if (condition) {
    console.log(`ok - ${message}`);
  } else {
    console.error(`not ok - ${message}`);
    failures += 1;
  }
}

function read(file) {
  return readFileSync(join(root, file), 'utf8');
}

for (const file of requiredFiles) {
  check(existsSync(join(root, file)), `${file} exists`);
}

const manifest = read('extension.toml');
check(/id\s*=\s*"zed-codesnap"/.test(manifest), 'extension id is zed-codesnap');
check(/schema_version\s*=\s*1/.test(manifest), 'manifest schema_version is 1');
check(/\[slash_commands\.codesnap\]/.test(manifest), 'manifest declares codesnap slash command');

const cargo = read('Cargo.toml');
check(/crate-type\s*=\s*\["cdylib"\]/.test(cargo), 'cargo builds a cdylib for Zed');
check(/zed_extension_api\s*=\s*"0\.7\.0"/.test(cargo), 'cargo depends on zed_extension_api 0.7.0');

const lib = read('src/lib.rs');
check(/impl\s+zed::Extension\s+for\s+CodeSnapExtension/.test(lib), 'extension trait is implemented');
check(/fn\s+run_slash_command/.test(lib), 'run_slash_command entry point exists');
check(/zed::register_extension!\(CodeSnapExtension\)/.test(lib), 'extension is registered');
check(/build_capture_request/.test(lib), 'command passes into capture boundary');
check(/help_output/.test(lib), 'missing input has a graceful help path');
check(/render_config/.test(lib), 'render configuration module is wired into the command path');
check(/\.zed-codesnap\.json/.test(lib), 'project .zed-codesnap.json is read at runtime when a worktree is available');

const capture = read('src/capture.rs');
check(/struct\s+CaptureRequest/.test(capture), 'CaptureRequest data boundary exists');
check(/pub\s+code:\s+String/.test(capture), 'CaptureRequest stores code');
check(/pub\s+language:\s+String/.test(capture), 'CaptureRequest stores language');
check(/pub\s+file_name:\s+Option<String>/.test(capture), 'CaptureRequest stores file metadata');
check(/pub\s+render_options:\s+RenderOptions/.test(capture), 'CaptureRequest stores render options');
check(/normalize_code/.test(capture), 'capture input validation exists');
check(/normalize_language/.test(capture), 'language normalization exists');
check(/--theme/.test(capture) && /--padding/.test(capture) && /--font-size/.test(capture), 'slash command accepts rendering option overrides');

const config = read('src/render_config.rs');
check(/pub\s+struct\s+RenderOptions/.test(config), 'RenderOptions struct exists');
check(/DEFAULT_OUTPUT_DIRECTORY:\s*&str\s*=\s*"~\/Unduhan"/.test(config), 'default output directory is ~/Unduhan');
check(/theme_preset/.test(config), 'theme/style preset option exists');
check(/background/.test(config), 'background option exists');
check(/padding/.test(config), 'padding option exists');
check(/rounded_corners/.test(config), 'rounded corners option exists');
check(/line_numbers/.test(config), 'line numbers option exists');
check(/window_chrome/.test(config), 'window chrome option exists');
check(/window_title/.test(config), 'window title option exists');
check(/font_size/.test(config), 'font size option exists');
check(/filename_pattern/.test(config), 'output filename pattern option exists');
check(/output_directory/.test(config), 'output directory option exists');
check(/from_json_str/.test(config), 'JSON configuration parsing exists');
check(/apply_cli_overrides/.test(config), 'CLI override merging exists');
check(/clamp_u32/.test(config), 'invalid numeric settings fall back safely');
check(/sanitize_color/.test(config), 'invalid background values fall back safely');
check(/to_json/.test(config), 'render options serialize into renderer handoff JSON');

const readme = read('README.md');
check(/\.zed-codesnap\.json/.test(readme), 'README documents project configuration file');
check(/~\/Unduhan/.test(readme), 'README documents ~/Unduhan default');
check(/theme_preset/.test(readme), 'README documents render settings schema');
check(/Invalid or missing values fall back/.test(readme), 'README documents safe fallback behavior');
check(/CodeSnap: Capture Copied Selection/.test(readme), 'README documents the native-feeling Zed task command');
check(/CodeSnap saved:/.test(readme), 'README documents success feedback copy');
check(/CodeSnap: no code found/.test(readme), 'README documents empty selection feedback copy');
check(/Install and load locally/.test(readme), 'README documents local installation/loading instructions');
check(/Verification checklist/.test(readme), 'README includes a verification checklist');
check(/Known limitations/.test(readme), 'README documents known limitations');
check(/Troubleshooting/.test(readme), 'README documents troubleshooting notes');
check(/unsupported language metadata/.test(readme), 'README documents unsupported language metadata handling');
check(/failed save/.test(readme), 'README documents failed save handling');

const cli = read('scripts/zed-codesnap.mjs');
check(/--from-clipboard/.test(cli), 'CLI supports copied-selection clipboard flow');
check(/--from-stdin/.test(cli), 'CLI supports stdin fallback');
check(/mkdirSync\(options\.output_directory, \{ recursive: true \}\)/.test(cli), 'CLI creates output directory recursively');
check(/CodeSnap saved:/.test(cli), 'CLI reports saved output path');
check(/existsSync\(candidate\)/.test(cli), 'CLI checks filename collisions');
check(/unsupported format/.test(cli), 'CLI reports unsupported formats');
check(/normalizeLanguage/.test(cli), 'CLI normalizes unsupported language metadata safely');

const tasks = read('.zed/tasks.json');
check(/CodeSnap: Capture Copied Selection/.test(tasks), 'Zed task uses native-feeling command title');
check(/--from-clipboard/.test(tasks) && /--copy/.test(tasks) && /--format png/.test(tasks), 'Zed task captures clipboard as a png image');

if (failures > 0) {
  console.error(`\n${failures} scaffold/configuration validation checks failed.`);
  process.exit(1);
}

console.log('\nConfiguration validation passed. The render ritual is armed.');
