import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const cli = join(root, 'scripts', 'zed-codesnap.mjs');
let failures = 0;

function check(condition, message) {
  if (condition) {
    console.log(`ok - ${message}`);
  } else {
    console.error(`not ok - ${message}`);
    failures += 1;
  }
}

function run(args, input = '') {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    input,
    encoding: 'utf8',
    env: { ...process.env, HOME: tmpHome },
  });
}

const tmpHome = mkdtempSync(join(tmpdir(), 'zed-codesnap-home-'));
try {
  const downloads = join(tmpHome, 'Unduhan');

  const happy = run(['--from-stdin', '--language', 'rust', '--no-copy'], 'fn main() {\n    if 1 < 2 {\n        println!("hi");\n    }\n}\n');
  check(happy.status === 0, 'stdin capture exits successfully');
  check(/CodeSnap saved: /.test(happy.stdout), 'success message reports saved path');
  const savedPath = happy.stdout.match(/CodeSnap saved: (.*)/)?.[1]?.trim();
  check(savedPath?.startsWith(downloads), 'default save path is ~/Unduhan');
  check(savedPath && existsSync(savedPath), 'rendered output exists');
  check(savedPath?.endsWith('.png'), 'default rendered output is png');
  const png = savedPath ? readFileSync(savedPath) : Buffer.alloc(0);
  check(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'default rendered output is a real png image');

  const svgCapture = run(['--from-stdin', '--language', 'rust', '--format', 'svg', '--no-copy'], 'fn main() {\n    if 1 < 2 {\n        println!("hi");\n    }\n}\n');
  const svgPath = svgCapture.stdout.match(/CodeSnap saved: (.*)/)?.[1]?.trim();
  const svg = svgPath ? readFileSync(svgPath, 'utf8') : '';
  check(svg.includes('&lt;') && svg.includes('println'), 'svg preserves escaped code content');
  check(svg.includes('one-dark-pro') || svg.includes('#282c34'), 'svg uses One Dark Pro styling');
  check(!svg.includes('ff5f57') && !svg.includes('febc2e') && !svg.includes('28c840'), 'svg omits window chrome dots');
  check(svg.includes('<tspan fill="#c678dd">fn</tspan>') && svg.includes('<tspan fill="#61afef">main</tspan>'), 'svg includes syntax-highlighted code tokens');

  const jpg = run(['--from-stdin', '--language', 'rust', '--format', 'jpg', '--no-copy'], 'fn main() {}\n');
  const jpgPath = jpg.stdout.match(/CodeSnap saved: (.*)/)?.[1]?.trim();
  const jpgBytes = jpgPath ? readFileSync(jpgPath) : Buffer.alloc(0);
  check(jpg.status === 0 && jpgPath?.endsWith('.jpg'), 'jpg output is supported');
  check(jpgBytes[0] === 0xff && jpgBytes[1] === 0xd8, 'jpg output is a real jpeg image');

  const scaled = run(['--from-stdin', '--language', 'rust', '--width', '720', '--no-copy'], 'fn main() {}\n');
  check(scaled.status === 0, 'width preset is accepted');

  const inferred = run(['--from-stdin', '--format', 'svg', '--no-copy'], 'const answer: number = 42;\n');
  const inferredPath = inferred.stdout.match(/CodeSnap saved: (.*)/)?.[1]?.trim();
  check(inferred.status === 0, 'stdin without explicit language still captures');
  check(inferredPath?.endsWith('typescript.svg'), 'stdin language is inferred from TypeScript syntax');

  const collision = run(['--from-stdin', '--language', 'rust', '--no-copy'], 'fn main() {}\n');
  const collisionPath = collision.stdout.match(/CodeSnap saved: (.*)/)?.[1]?.trim();
  check(collision.status === 0 && collisionPath && collisionPath !== savedPath, 'filename collisions are avoided');

  const configuredDir = join(tmpHome, 'custom-snaps');
  writeFileSync(join(root, '.zed-codesnap.json'), JSON.stringify({ output_directory: configuredDir, filename_pattern: 'demo-{language}.{ext}', background: '#222222', line_numbers: true }), 'utf8');
  const configured = run(['--from-stdin', '--format', 'svg', '--no-copy'], 'const x = 1;\n');
  const configuredPath = configured.stdout.match(/CodeSnap saved: (.*)/)?.[1]?.trim();
  check(configured.status === 0 && configuredPath?.startsWith(configuredDir), 'project config output_directory is honored');
  check(configuredPath && readFileSync(configuredPath, 'utf8').includes('#222222'), 'project config render style is honored');

  writeFileSync(join(root, '.zed-codesnap.json'), JSON.stringify({ output_directory: configuredDir, filename_pattern: 'lang-{language}.{ext}' }), 'utf8');
  const unsupportedLanguage = run(['--from-stdin', '--language', '../Not Real??', '--format', 'svg', '--no-copy'], 'echo unsafe metadata\n');
  const unsupportedLanguagePath = unsupportedLanguage.stdout.match(/CodeSnap saved: (.*)/)?.[1]?.trim();
  check(unsupportedLanguage.status === 0, 'unsupported language metadata falls back without crashing');
  check(unsupportedLanguagePath?.startsWith(configuredDir) && basename(unsupportedLanguagePath) === 'lang-text.svg', 'unsupported language metadata cannot escape filename pattern');

  const empty = run(['--from-stdin'], '   \n');
  check(empty.status !== 0, 'empty input exits non-zero');
  check(empty.stderr.includes('CodeSnap: no code found'), 'empty input has native-feeling actionable error');

  const badFormat = run(['--from-stdin', '--format', 'bmp'], 'fn main() {}');
  check(badFormat.status !== 0, 'unsupported format exits non-zero');
  check(badFormat.stderr.includes('CodeSnap: unsupported format `bmp`'), 'unsupported format error is concise');

  const copy = run(['--from-stdin', '--copy'], 'fn main() {}');
  check(copy.status === 0, 'copy option exits successfully when clipboard tooling is available');
  check(copy.stdout.includes('CodeSnap image copied to clipboard.'), 'copy option reports image clipboard result');
  check(!copy.stdout.includes('CodeSnap saved:'), 'copy option does not save a file by default');

  const copyAndSave = run(['--from-stdin', '--copy', '--save'], 'fn main() {}');
  check(copyAndSave.status === 0 && copyAndSave.stdout.includes('CodeSnap saved:'), 'copy and save can be combined explicitly');

  const blockedDestination = join(tmpHome, 'not-a-directory');
  writeFileSync(blockedDestination, 'I am a file, not a folder', 'utf8');
  const failedSave = run(['--from-stdin', '--no-copy', '--output-dir', blockedDestination], 'fn main() {}');
  check(failedSave.status !== 0, 'failed save exits non-zero');
  check(/ENOTDIR|EEXIST|EACCES|EPERM|failed to save/.test(failedSave.stderr), 'failed save reports an actionable filesystem error');
} finally {
  try { rmSync(join(root, '.zed-codesnap.json'), { force: true }); } catch {}
  rmSync(tmpHome, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} CLI workflow checks failed.`);
  process.exit(1);
}

console.log('\nCLI workflow checks passed.');
