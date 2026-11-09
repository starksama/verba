import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
// Release credentials (Developer ID, notary key) live in an untracked .env, never in the repo.
const envFile = join(rootDir, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
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
  env: {
    ...process.env,
    // Release binaries embed dependency source paths; strip the builder's home
    // folder so a published build does not reveal their username.
    CARGO_TARGET_AARCH64_APPLE_DARWIN_RUSTFLAGS:
      process.env.CARGO_TARGET_AARCH64_APPLE_DARWIN_RUSTFLAGS ?? `--remap-path-prefix=${homedir()}/=~/`,
    VITE_VERBA_DEV: development ? '1' : '0'
  }
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
