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

  const happy = run(['--from-stdin', '--language', 'rust'], 'fn main() {\n    if 1 < 2 {\n        println!("hi");\n    }\n}\n');
  check(happy.status === 0, 'stdin capture exits successfully');
  check(/CodeSnap saved: /.test(happy.stdout), 'success message reports saved path');
  const savedPath = happy.stdout.match(/CodeSnap saved: (.*)/)?.[1]?.trim();
  check(savedPath?.startsWith(downloads), 'default save path is ~/Unduhan');
  check(savedPath && existsSync(savedPath), 'rendered output exists');
  check(savedPath?.endsWith('.svg'), 'default rendered output is svg');
  const svg = savedPath ? readFileSync(savedPath, 'utf8') : '';
  check(svg.includes('&lt;') && svg.includes('println!'), 'svg preserves escaped code content');
  check(svg.includes('zed-dark') || svg.includes('#0f1117'), 'svg uses Zed-like styling');

  const collision = run(['--from-stdin', '--language', 'rust'], 'fn main() {}\n');
  const collisionPath = collision.stdout.match(/CodeSnap saved: (.*)/)?.[1]?.trim();
  check(collision.status === 0 && collisionPath && collisionPath !== savedPath, 'filename collisions are avoided');

  const configuredDir = join(tmpHome, 'custom-snaps');
  writeFileSync(join(root, '.zed-codesnap.json'), JSON.stringify({ output_directory: configuredDir, filename_pattern: 'demo-{language}.{ext}', background: '#222222', line_numbers: true }), 'utf8');
  const configured = run(['--from-stdin'], 'const x = 1;\n');
  const configuredPath = configured.stdout.match(/CodeSnap saved: (.*)/)?.[1]?.trim();
  check(configured.status === 0 && configuredPath?.startsWith(configuredDir), 'project config output_directory is honored');
  check(configuredPath && readFileSync(configuredPath, 'utf8').includes('#222222'), 'project config render style is honored');

  writeFileSync(join(root, '.zed-codesnap.json'), JSON.stringify({ output_directory: configuredDir, filename_pattern: 'lang-{language}.{ext}' }), 'utf8');
  const unsupportedLanguage = run(['--from-stdin', '--language', '../Not Real??'], 'echo unsafe metadata\n');
  const unsupportedLanguagePath = unsupportedLanguage.stdout.match(/CodeSnap saved: (.*)/)?.[1]?.trim();
  check(unsupportedLanguage.status === 0, 'unsupported language metadata falls back without crashing');
  check(unsupportedLanguagePath?.startsWith(configuredDir) && basename(unsupportedLanguagePath) === 'lang-text.svg', 'unsupported language metadata cannot escape filename pattern');

  const empty = run(['--from-stdin'], '   \n');
  check(empty.status !== 0, 'empty input exits non-zero');
  check(empty.stderr.includes('CodeSnap: no code found'), 'empty input has native-feeling actionable error');

  const badFormat = run(['--from-stdin', '--format', 'png'], 'fn main() {}');
  check(badFormat.status !== 0, 'unsupported format exits non-zero');
  check(badFormat.stderr.includes('CodeSnap: unsupported format `png`'), 'unsupported format error is concise');

  const blockedDestination = join(tmpHome, 'not-a-directory');
  writeFileSync(blockedDestination, 'I am a file, not a folder', 'utf8');
  const failedSave = run(['--from-stdin', '--output-dir', blockedDestination], 'fn main() {}');
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
