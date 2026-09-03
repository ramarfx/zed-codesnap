#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn, spawnSync } from "node:child_process";

const DEFAULTS = Object.freeze({
  output_directory: "~/Unduhan",
  format: "png",
  theme_preset: "one-dark-pro",
  background: "#282c34",
  padding: 24,
  rounded_corners: 12,
  line_numbers: false,
  window_chrome: false,
  window_title: null,
  font_size: 14,
  filename_pattern: "codesnap-{timestamp}-{slug}.{ext}",
  copy_to_clipboard: true,
});

function parseArgs(argv) {
  const args = {
    fromClipboard: false,
    fromStdin: false,
    file: null,
    language: null,
    outputDirectory: null,
    format: null,
    config: ".zed-codesnap.json",
    title: null,
    copy: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--from-clipboard":
        args.fromClipboard = true;
        break;
      case "--from-stdin":
        args.fromStdin = true;
        break;
      case "--file":
      case "--path":
        args.file = takeValue(argv, ++i, arg);
        break;
      case "--language":
      case "--lang":
        args.language = takeValue(argv, ++i, arg);
        break;
      case "--output-dir":
      case "--output-directory":
      case "--output":
        args.outputDirectory = takeValue(argv, ++i, arg);
        break;
      case "--format":
        args.format = takeValue(argv, ++i, arg);
        break;
      case "--config":
        args.config = takeValue(argv, ++i, arg);
        break;
      case "--title":
      case "--window-title":
        args.title = takeValue(argv, ++i, arg);
        break;
      case "--copy":
      case "--copy-to-clipboard":
        args.copy = true;
        break;
      case "--no-copy":
      case "--no-copy-to-clipboard":
        args.copy = false;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(
          `CodeSnap: unknown option \`${arg}\`. Use --help for supported options.`,
        );
    }
  }

  return args;
}

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.trim() === "") {
    throw new Error(`CodeSnap: ${flag} requires a value.`);
  }
  return value;
}

function loadConfig(configPath) {
  const path = resolve(configPath);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function normalizeOptions(config, args) {
  const options = { ...DEFAULTS };
  const map = {
    output_dir: "output_directory",
    theme: "theme_preset",
    show_line_numbers: "line_numbers",
    corner_radius: "rounded_corners",
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
  if (args.copy !== null) options.copy_to_clipboard = args.copy;

  options.output_directory = expandHome(
    stringOr(options.output_directory, DEFAULTS.output_directory),
  );
  options.format = stringOr(options.format, DEFAULTS.format).toLowerCase();
  if (options.format === "jpeg") options.format = "jpg";
  options.theme_preset = stringOr(options.theme_preset, DEFAULTS.theme_preset);
  options.background = sanitizeColor(options.background, DEFAULTS.background);
  options.padding = boundedNumber(options.padding, 0, 128, DEFAULTS.padding);
  options.rounded_corners = boundedNumber(
    options.rounded_corners,
    0,
    64,
    DEFAULTS.rounded_corners,
  );
  options.line_numbers = Boolean(options.line_numbers);
  options.window_chrome = options.window_chrome !== false;
  options.window_title =
    typeof options.window_title === "string" && options.window_title.trim()
      ? options.window_title.trim()
      : null;
  options.font_size = boundedNumber(
    options.font_size,
    8,
    48,
    DEFAULTS.font_size,
  );
  options.filename_pattern = sanitizePattern(
    options.filename_pattern,
    DEFAULTS.filename_pattern,
  );
  options.copy_to_clipboard = Boolean(options.copy_to_clipboard);
  return options;
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? Math.round(number)
    : fallback;
}

function sanitizeColor(value, fallback) {
  const clean = stringOr(value, fallback);
  if (
    clean === "transparent" ||
    /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(clean) ||
    /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(clean)
  ) {
    return clean;
  }
  return fallback;
}

function sanitizePattern(value, fallback) {
  const clean = stringOr(value, fallback);
  if (!clean.includes("{ext}") || clean.includes("/") || clean.includes("\\"))
    return fallback;
  return clean;
}

function expandHome(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return resolve(path);
}

function readInput(args) {
  if (args.fromClipboard) {
    return readClipboard();
  }
  if (args.file) {
    return readFileSync(resolve(args.file), "utf8");
  }
  if (args.fromStdin || !process.stdin.isTTY) {
    return readFileSync(0, "utf8");
  }
  throw new Error(
    "CodeSnap: no code found. Select code in Zed, copy it, then run “CodeSnap: Capture Copied Selection”.",
  );
}

function readClipboard() {
  const commands =
    process.platform === "darwin"
      ? [["pbpaste"]]
      : process.platform === "win32"
        ? [["powershell.exe", "-NoProfile", "-Command", "Get-Clipboard"]]
        : [
            ["wl-paste", "--no-newline"],
            ["xclip", "-selection", "clipboard", "-out"],
            ["xsel", "--clipboard", "--output"],
          ];

  for (const command of commands) {
    const result = spawnSync(command[0], command.slice(1), {
      encoding: "utf8",
    });
    if (result.status === 0) return result.stdout;
  }
  throw new Error(
    "CodeSnap: clipboard is unavailable. Try piping code with `zed-codesnap --from-stdin`.",
  );
}

function copyFileToClipboard(path) {
  const fileUri = pathToFileUri(path);
  if (process.platform === "darwin") {
    const script = `set the clipboard to POSIX file ${JSON.stringify(path)}`;
    return (
      spawnSync("osascript", ["-e", script], {
        encoding: "utf8",
        timeout: 1000,
      }).status === 0
    );
  }
  if (process.platform === "win32") {
    const script = `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; $files = New-Object System.Collections.Specialized.StringCollection; $files.Add(${JSON.stringify(path)}) | Out-Null; [System.Windows.Forms.Clipboard]::SetFileDropList($files)`;
    return (
      spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
        encoding: "utf8",
        timeout: 1000,
      }).status === 0
    );
  }

  const copiedFilesTarget = {
    command: ["wl-copy", "--type", "x-special/gnome-copied-files"],
    input: `copy\n${fileUri}\n`,
  };
  const uriListTarget = {
    command: ["wl-copy", "--type", "text/uri-list"],
    input: `${fileUri}\n`,
  };
  const isKde = /kde/i.test(process.env.XDG_CURRENT_DESKTOP || "");
  const linuxTargets = isKde
    ? [uriListTarget, copiedFilesTarget]
    : [copiedFilesTarget, uriListTarget];

  for (const target of linuxTargets) {
    const result = spawnSync(target.command[0], target.command.slice(1), {
      input: target.input,
      encoding: "utf8",
      timeout: 1000,
    });
    if (result.status === 0) return true;
  }

  const xclipTarget = isKde ? "text/uri-list" : "x-special/gnome-copied-files";
  const xclipInput = xclipTarget === "text/uri-list" ? `${fileUri}\n` : `copy\n${fileUri}\n`;
  if (copyWithDetachedXclip(xclipTarget, xclipInput)) return true;

  return false;
}

function copyWithDetachedXclip(target, input) {
  try {
    const child = spawn("xclip", ["-selection", "clipboard", "-target", target], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.stdin.end(input);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function pathToFileUri(path) {
  return `file://${path.split("/").map(encodeURIComponent).join("/")}`;
}

function inferLanguage(args) {
  if (args.language?.trim()) return normalizeLanguage(args.language);
  if (!args.file) return "text";
  const ext = extname(args.file).slice(1).toLowerCase();
  return (
    {
      rs: "rust",
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      py: "python",
      go: "go",
      java: "java",
      html: "html",
      css: "css",
      json: "json",
      md: "markdown",
      sh: "shell",
    }[ext] ?? "text"
  );
}

function normalizeLanguage(value) {
  const clean = String(value).trim().replace(/^\./, "").toLowerCase();
  return /^[a-z][a-z0-9_+-]{0,31}$/.test(clean) ? clean : "text";
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/T/, "-")
    .slice(0, 15);
}

function slugify(value) {
  return (
    (value || "untitled")
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "untitled"
  );
}

function buildPath(options, language, sourceName) {
  mkdirSync(options.output_directory, { recursive: true });
  const pattern = options.filename_pattern
    .replaceAll("{timestamp}", timestamp())
    .replaceAll("{language}", slugify(language))
    .replaceAll("{filename}", basename(sourceName || "untitled"))
    .replaceAll("{slug}", slugify(sourceName || language))
    .replaceAll("{ext}", options.format);
  const dotExt = `.${options.format}`;
  const baseName = pattern.endsWith(dotExt)
    ? pattern.slice(0, -dotExt.length)
    : pattern;
  let candidate = join(options.output_directory, `${baseName}${dotExt}`);
  for (let index = 2; existsSync(candidate) && index <= 999; index += 1) {
    candidate = join(options.output_directory, `${baseName}-${index}${dotExt}`);
  }
  if (existsSync(candidate)) {
    throw new Error(
      `CodeSnap: failed to save to ${options.output_directory}. Could not find a collision-free filename.`,
    );
  }
  return candidate;
}

const KEYWORDS = Object.freeze({
  rust: new Set(
    "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while".split(
      " ",
    ),
  ),
  javascript: new Set(
    "async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield".split(
      " ",
    ),
  ),
  typescript: new Set(
    "abstract any as async await boolean break case catch class const continue default delete do else enum export extends false finally for from function if implements import in instanceof interface keyof let namespace never new null number of private protected public readonly return static string super switch this throw true try type typeof undefined unknown var void while yield".split(
      " ",
    ),
  ),
  python: new Set(
    "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield".split(
      " ",
    ),
  ),
  go: new Set(
    "break case chan const continue default defer else fallthrough for func go goto if import interface map nil package range return select struct switch type var".split(
      " ",
    ),
  ),
  java: new Set(
    "abstract assert boolean break byte case catch char class const continue default do double else enum extends false final finally float for if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true try void volatile while".split(
      " ",
    ),
  ),
  shell: new Set(
    "case do done elif else esac fi for function if in select then until while".split(
      " ",
    ),
  ),
});

const TOKEN_COLORS = Object.freeze({
  comment: "#5c6370",
  string: "#98c379",
  number: "#d19a66",
  keyword: "#c678dd",
  function: "#61afef",
  punctuation: "#abb2bf",
  text: "#abb2bf",
});

function renderHighlightedLine(line, language) {
  if (!line) return '<tspan fill="#abb2bf"> </tspan>';
  const tokens = tokenizeLine(line, language);
  return tokens
    .map(
      (token) =>
        `<tspan fill="${TOKEN_COLORS[token.kind] ?? TOKEN_COLORS.text}">${escapeXml(token.value)}</tspan>`,
    )
    .join("");
}

function tokenizeLine(line, language) {
  const tokens = [];
  const commentIndex = findCommentIndex(line, language);
  const code = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const comment = commentIndex >= 0 ? line.slice(commentIndex) : "";
  const pattern =
    /(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b|[{}()[\].,;:+\-*%=!<>|&?/]+)/g;
  let cursor = 0;
  for (const match of code.matchAll(pattern)) {
    if (match.index > cursor)
      tokens.push({ kind: "text", value: code.slice(cursor, match.index) });
    const value = match[0];
    tokens.push({
      kind: classifyToken(value, code, match.index, language),
      value,
    });
    cursor = match.index + value.length;
  }
  if (cursor < code.length)
    tokens.push({ kind: "text", value: code.slice(cursor) });
  if (comment) tokens.push({ kind: "comment", value: comment });
  return tokens;
}

function findCommentIndex(line, language) {
  if (["python", "shell", "markdown"].includes(language))
    return line.indexOf("#");
  if (["html", "xml"].includes(language)) return line.indexOf("<!--");
  return line.indexOf("//");
}

function classifyToken(value, code, index, language) {
  if (/^[`"']/.test(value)) return "string";
  if (/^\d/.test(value)) return "number";
  if (/^[{}()[\].,;:+\-*%=!<>|&?/]+$/.test(value)) return "punctuation";
  const keywordSet = KEYWORDS[language] ?? KEYWORDS.javascript;
  if (keywordSet.has(value)) return "keyword";
  const after = code.slice(index + value.length).trimStart();
  return after.startsWith("(") ? "function" : "text";
}

function renderSvg(code, language, options) {
  const lines = code
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trimEnd()
    .split("\n");
  const fontSize = options.font_size;
  const lineHeight = Math.round(fontSize * 1.55);
  const numberWidth = options.line_numbers
    ? String(lines.length).length * 10 + 22
    : 0;
  const contentWidth =
    Math.max(...lines.map((line) => line.length), 12) *
    Math.round(fontSize * 0.62);
  const width = options.padding * 2 + numberWidth + contentWidth;
  const height = options.padding * 2 + Math.max(lines.length, 1) * lineHeight;
  const codeTop = options.padding + fontSize;

  const lineNodes = lines
    .map((line, index) => {
      const y = codeTop + index * lineHeight;
      const number = options.line_numbers
        ? `<text x="${options.padding}" y="${y}" fill="#5c6370" font-family="Zed Mono, JetBrains Mono, monospace" font-size="${fontSize}">${index + 1}</text>`
        : "";
      const textX = options.padding + numberWidth;
      return `${number}<text x="${textX}" y="${y}" fill="#abb2bf" font-family="Zed Mono, JetBrains Mono, monospace" font-size="${fontSize}" xml:space="preserve">${renderHighlightedLine(line, language)}</text>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="CodeSnap ${escapeXml(language)} snippet">
  <metadata>zed-codesnap ${escapeXml(options.theme_preset)}</metadata>
  <rect width="100%" height="100%" rx="${options.rounded_corners}" fill="${escapeXml(options.background)}"/>
  ${lineNodes}
</svg>
`;
}

function writeRenderedOutput(outputPath, svg, options) {
  if (options.format === "svg") {
    writeFileSync(outputPath, svg, "utf8");
    return;
  }
  if (options.format === "html") {
    throw new Error("CodeSnap: HTML rendering is only available through the HTML renderer.");
  }
  const converted = convertSvg(svg, options.format, options.background);
  writeFileSync(outputPath, converted);
}

function convertSvg(svg, format, background) {
  if (format === "png") {
    const rsvg = spawnSync("rsvg-convert", ["-f", "png"], {
      input: svg,
      encoding: null,
      timeout: 5000,
      maxBuffer: 50 * 1024 * 1024,
    });
    if (rsvg.status === 0 && rsvg.stdout?.length) return rsvg.stdout;
  }

  const magickFormat = format === "jpg" ? "jpg" : format;
  const magickArgs = ["svg:-"];
  if (format === "jpg") {
    magickArgs.push("-background", background, "-alpha", "remove", "-alpha", "off");
  }
  magickArgs.push(`${magickFormat}:-`);
  const magick = spawnSync("magick", magickArgs, {
    input: svg,
    encoding: null,
    timeout: 5000,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (magick.status === 0 && magick.stdout?.length) return magick.stdout;

  throw new Error(
    `CodeSnap: ${format} export requires rsvg-convert or ImageMagick (magick).`,
  );
}

function renderHtml(code, language, options) {
  return `<!doctype html><meta charset="utf-8"><title>CodeSnap</title><body style="margin:0;background:${escapeHtml(options.background)};padding:28px"><pre data-theme="${escapeHtml(options.theme_preset)}" data-language="${escapeHtml(language)}" style="background:#111827;color:#e5e7eb;border:1px solid #273244;border-radius:${options.rounded_corners}px;padding:${options.padding}px;font:${options.font_size}px/1.55 'Zed Mono','JetBrains Mono',monospace;white-space:pre-wrap">${escapeHtml(code)}</pre></body>\n`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeHtml(value) {
  return escapeXml(value).replaceAll("'", "&#39;");
}

function printHelp() {
  console.log(
    `CodeSnap: Capture Copied Selection\n\nUsage:\n  zed-codesnap --from-clipboard --copy\n  zed-codesnap --from-stdin --language rust\n  zed-codesnap --file src/main.rs\n  zed-codesnap --from-stdin --format jpg\n\nDefault output: ~/Unduhan\nSupported formats: png, jpg, svg, html\nZed task title: CodeSnap: Capture Copied Selection`,
  );
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const config = loadConfig(args.config);
  const options = normalizeOptions(config, args);
  if (!["png", "jpg", "svg", "html"].includes(options.format)) {
    throw new Error(
      `CodeSnap: unsupported format \`${options.format}\`. Use png, jpg, svg, or html.`,
    );
  }
  const rawCode = readInput(args);
  const code = rawCode.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!code.trim()) {
    throw new Error(
      "CodeSnap: no code found. Select code in Zed, copy it, then run “CodeSnap: Capture Copied Selection”.",
    );
  }
  const language = inferLanguage(args);
  const outputPath = buildPath(
    options,
    language,
    args.file || options.window_title || language,
  );
  if (options.format === "html") {
    writeFileSync(outputPath, renderHtml(code, language, options), "utf8");
  } else {
    writeRenderedOutput(outputPath, renderSvg(code, language, options), options);
  }
  console.log(`CodeSnap saved: ${outputPath}`);
  if (options.copy_to_clipboard) {
    if (copyFileToClipboard(outputPath)) {
      console.log("CodeSnap file copied to clipboard.");
    } else {
      console.error(
        "CodeSnap: saved, but file clipboard copy is unavailable. Install wl-copy or xclip.",
      );
    }
  }
} catch (error) {
  console.error(error?.message || String(error));
  process.exit(1);
}
