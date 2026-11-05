import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('Overlay tests require macOS.');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'verba-overlay-test-'));
try {
  const binary = join(temporary, 'overlay-test');
  execFileSync('xcrun', [
    'clang', '-fobjc-arc',
    join(root, 'src-tauri/src/macos_permissions.m'),
    join(root, 'src-tauri/tests/overlay_window.m'),
    '-framework', 'AppKit', '-framework', 'AVFoundation',
    '-framework', 'ApplicationServices', '-framework', 'Foundation',
    '-o', binary
  ], { stdio: 'inherit' });
  execFileSync(binary, { stdio: 'inherit' });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
