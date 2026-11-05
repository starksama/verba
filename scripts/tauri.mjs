import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const development = args[0] === 'dev' || args.includes('--dev-app');
const tauriArgs = args.filter((arg) => arg !== '--dev-app');

if (['dev', 'build', 'bundle'].includes(args[0])) {
  execFileSync(process.execPath, [join(rootDir, 'scripts/sync-app-config.mjs')], { stdio: 'inherit' });
  if (development) {
    tauriArgs.push('--config', join(rootDir, 'src-tauri/tauri.dev.conf.json'));
  }
}

const result = spawnSync(join(rootDir, 'node_modules/.bin/tauri'), tauriArgs, {
  cwd: rootDir,
  stdio: 'inherit',
  env: { ...process.env, VITE_VERBA_DEV: development ? '1' : '0' }
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
