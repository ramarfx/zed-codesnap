#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const DEFAULTS = Object.freeze({
  output_directory: '~/Unduhan',
  format: 'svg',
  theme_preset: 'zed-dark',
  background: '#0f1117',
  padding: 24,
  rounded_corners: 12,
  line_numbers: false,
  window_chrome: true,
  window_title: null,
  font_size: 14,
  filename_pattern: 'codesnap-{timestamp}-{slug}.{ext}',
});

function parseArgs(argv) {
  const args = {
    fromClipboard: false,
    fromStdin: false,
    file: null,
    language: null,
    outputDirectory: null,
    format: null,
    config: '.zed-codesnap.json',
    title: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--from-clipboard':
        args.fromClipboard = true;
        break;
      case '--from-stdin':
        args.fromStdin = true;
        break;
      case '--file':
      case '--path':
        args.file = takeValue(argv, ++i, arg);
        break;
      case '--language':
      case '--lang':
        args.language = takeValue(argv, ++i, arg);
        break;
      case '--output-dir':
      case '--output-directory':
      case '--output':
        args.outputDirectory = takeValue(argv, ++i, arg);
        break;
      case '--format':
        args.format = takeValue(argv, ++i, arg);
        break;
      case '--config':
        args.config = takeValue(argv, ++i, arg);
        break;
      case '--title':
      case '--window-title':
        args.title = takeValue(argv, ++i, arg);
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`CodeSnap: unknown option \`${arg}\`. Use --help for supported options.`);
    }
  }

  return args;
}

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.trim() === '') {
    throw new Error(`CodeSnap: ${flag} requires a value.`);
  }
  return value;
}

function loadConfig(configPath) {
  const path = resolve(configPath);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeOptions(config, args) {
  const options = { ...DEFAULTS };
  const map = {
    output_dir: 'output_directory',
    theme: 'theme_preset',
    show_line_numbers: 'line_numbers',
    corner_radius: 'rounded_corners',
  };
  for (const [key, value] of Object.entries(config)) {
    const normalizedKey = map[key] ?? key;
    if (!(normalizedKey in options)) continue;
    options[normalizedKey] = value;
  }

  if (args.outputDirectory) options.output_directory = args.outputDirectory;
  if (args.format) options.format = args.format;
  if (args.title) options.window_title = args.title;
  if (args.language && !options.language) options.language = args.language;

  options.output_directory = expandHome(stringOr(options.output_directory, DEFAULTS.output_directory));
  options.format = stringOr(options.format, DEFAULTS.format).toLowerCase();
  options.theme_preset = stringOr(options.theme_preset, DEFAULTS.theme_preset);
  options.background = sanitizeColor(options.background, DEFAULTS.background);
  options.padding = boundedNumber(options.padding, 0, 128, DEFAULTS.padding);
  options.rounded_corners = boundedNumber(options.rounded_corners, 0, 64, DEFAULTS.rounded_corners);
  options.line_numbers = Boolean(options.line_numbers);
  options.window_chrome = options.window_chrome !== false;
  options.window_title = typeof options.window_title === 'string' && options.window_title.trim() ? options.window_title.trim() : null;
  options.font_size = boundedNumber(options.font_size, 8, 48, DEFAULTS.font_size);
  options.filename_pattern = sanitizePattern(options.filename_pattern, DEFAULTS.filename_pattern);
  return options;
}

function stringOr(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? Math.round(number) : fallback;
}

function sanitizeColor(value, fallback) {
  const clean = stringOr(value, fallback);
  if (clean === 'transparent' || /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(clean) || /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(clean)) {
    return clean;
  }
  return fallback;
}

function sanitizePattern(value, fallback) {
  const clean = stringOr(value, fallback);
  if (!clean.includes('{ext}') || clean.includes('/') || clean.includes('\\')) return fallback;
  return clean;
}

function expandHome(path) {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return resolve(path);
}

function readInput(args) {
  if (args.fromClipboard) {
    return readClipboard();
  }
  if (args.file) {
    return readFileSync(resolve(args.file), 'utf8');
  }
  if (args.fromStdin || !process.stdin.isTTY) {
    return readFileSync(0, 'utf8');
  }
  throw new Error('CodeSnap: no code found. Select code in Zed, copy it, then run “CodeSnap: Capture Copied Selection”.');
}

function readClipboard() {
  const commands = process.platform === 'darwin'
    ? [['pbpaste']]
    : process.platform === 'win32'
      ? [['powershell.exe', '-NoProfile', '-Command', 'Get-Clipboard']]
      : [['wl-paste', '--no-newline'], ['xclip', '-selection', 'clipboard', '-out'], ['xsel', '--clipboard', '--output']];

  for (const command of commands) {
    const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8' });
    if (result.status === 0) return result.stdout;
  }
  throw new Error('CodeSnap: clipboard is unavailable. Try piping code with `zed-codesnap --from-stdin`.');
}

function inferLanguage(args) {
  if (args.language?.trim()) return normalizeLanguage(args.language);
  if (!args.file) return 'text';
  const ext = extname(args.file).slice(1).toLowerCase();
  return ({ rs: 'rust', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', go: 'go', java: 'java', html: 'html', css: 'css', json: 'json', md: 'markdown', sh: 'shell' }[ext]) ?? 'text';
}

function normalizeLanguage(value) {
  const clean = String(value).trim().replace(/^\./, '').toLowerCase();
  return /^[a-z][a-z0-9_+-]{0,31}$/.test(clean) ? clean : 'text';
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/T/, '-').slice(0, 15);
}

function slugify(value) {
  return (value || 'untitled').toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'untitled';
}

function buildPath(options, language, sourceName) {
  mkdirSync(options.output_directory, { recursive: true });
  const pattern = options.filename_pattern
    .replaceAll('{timestamp}', timestamp())
    .replaceAll('{language}', slugify(language))
    .replaceAll('{filename}', basename(sourceName || 'untitled'))
    .replaceAll('{slug}', slugify(sourceName || language))
    .replaceAll('{ext}', options.format);
  const dotExt = `.${options.format}`;
  const baseName = pattern.endsWith(dotExt) ? pattern.slice(0, -dotExt.length) : pattern;
  let candidate = join(options.output_directory, `${baseName}${dotExt}`);
  for (let index = 2; existsSync(candidate) && index <= 999; index += 1) {
    candidate = join(options.output_directory, `${baseName}-${index}${dotExt}`);
  }
  if (existsSync(candidate)) {
    throw new Error(`CodeSnap: failed to save to ${options.output_directory}. Could not find a collision-free filename.`);
  }
  return candidate;
}

function renderSvg(code, language, options) {
  const lines = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd().split('\n');
  const escaped = lines.map(escapeXml);
  const fontSize = options.font_size;
  const lineHeight = Math.round(fontSize * 1.55);
  const numberWidth = options.line_numbers ? String(lines.length).length * 10 + 22 : 0;
  const contentWidth = Math.max(...lines.map((line) => line.length), 12) * Math.round(fontSize * 0.62);
  const cardWidth = options.padding * 2 + numberWidth + contentWidth;
  const chromeHeight = options.window_chrome ? 34 : 0;
  const cardHeight = options.padding * 2 + chromeHeight + Math.max(lines.length, 1) * lineHeight;
  const outerPadding = 28;
  const width = cardWidth + outerPadding * 2;
  const height = cardHeight + outerPadding * 2;
  const codeTop = outerPadding + options.padding + chromeHeight + fontSize;

  const lineNodes = escaped.map((line, index) => {
    const y = codeTop + index * lineHeight;
    const number = options.line_numbers ? `<text x="${outerPadding + options.padding}" y="${y}" fill="#6b7280" font-family="Zed Mono, JetBrains Mono, monospace" font-size="${fontSize}">${index + 1}</text>` : '';
    const textX = outerPadding + options.padding + numberWidth;
    return `${number}<text x="${textX}" y="${y}" fill="#e5e7eb" font-family="Zed Mono, JetBrains Mono, monospace" font-size="${fontSize}" xml:space="preserve">${line || ' '}</text>`;
  }).join('\n');

  const chrome = options.window_chrome ? `<circle cx="${outerPadding + 22}" cy="${outerPadding + 20}" r="5" fill="#ff5f57"/><circle cx="${outerPadding + 40}" cy="${outerPadding + 20}" r="5" fill="#febc2e"/><circle cx="${outerPadding + 58}" cy="${outerPadding + 20}" r="5" fill="#28c840"/><text x="${outerPadding + 82}" y="${outerPadding + 25}" fill="#9ca3af" font-family="Zed Mono, JetBrains Mono, monospace" font-size="12">${escapeXml(options.window_title || language)}</text>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="CodeSnap ${escapeXml(language)} snippet">
  <metadata>zed-codesnap ${escapeXml(options.theme_preset)}</metadata>
  <rect width="100%" height="100%" rx="18" fill="${escapeXml(options.background)}"/>
  <rect x="${outerPadding}" y="${outerPadding}" width="${cardWidth}" height="${cardHeight}" rx="${options.rounded_corners}" fill="#111827" stroke="#273244"/>
  ${chrome}
  ${lineNodes}
</svg>
`;
}

function renderHtml(code, language, options) {
  return `<!doctype html><meta charset="utf-8"><title>CodeSnap</title><body style="margin:0;background:${escapeHtml(options.background)};padding:28px"><pre data-theme="${escapeHtml(options.theme_preset)}" data-language="${escapeHtml(language)}" style="background:#111827;color:#e5e7eb;border:1px solid #273244;border-radius:${options.rounded_corners}px;padding:${options.padding}px;font:${options.font_size}px/1.55 'Zed Mono','JetBrains Mono',monospace;white-space:pre-wrap">${escapeHtml(code)}</pre></body>\n`;
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function escapeHtml(value) {
  return escapeXml(value).replaceAll("'", '&#39;');
}

function printHelp() {
  console.log(`CodeSnap: Capture Copied Selection\n\nUsage:\n  zed-codesnap --from-clipboard\n  zed-codesnap --from-stdin --language rust\n  zed-codesnap --file src/main.rs\n\nDefault output: ~/Unduhan\nSupported formats: svg, html\nZed task title: CodeSnap: Capture Copied Selection`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const config = loadConfig(args.config);
  const options = normalizeOptions(config, args);
  if (!['svg', 'html'].includes(options.format)) {
    throw new Error(`CodeSnap: unsupported format \`${options.format}\`. Use svg or html.`);
  }
  const rawCode = readInput(args);
  const code = rawCode.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
  if (!code.trim()) {
    throw new Error('CodeSnap: no code found. Select code in Zed, copy it, then run “CodeSnap: Capture Copied Selection”.');
  }
  const language = inferLanguage(args);
  const outputPath = buildPath(options, language, args.file || options.window_title || language);
  const rendered = options.format === 'html' ? renderHtml(code, language, options) : renderSvg(code, language, options);
  writeFileSync(outputPath, rendered, 'utf8');
  console.log(`CodeSnap saved: ${outputPath}`);
} catch (error) {
  console.error(error?.message || String(error));
  process.exit(1);
}
