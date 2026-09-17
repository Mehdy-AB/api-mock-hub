// Builds the web UI into client/dist.
// Installs the UI's dependencies first when they are missing, so a plain
// `npm install && npm run build` (Railpack, Nixpacks, Heroku-style builders) produces the whole app.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const client = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client');
const isWindows = process.platform === 'win32';

function npm(args) {
  const result = spawnSync(isWindows ? 'npm.cmd' : 'npm', args, { cwd: client, stdio: 'inherit', shell: isWindows });
  if (result.status !== 0) {
    console.error(`npm ${args.join(' ')} failed in ${client}`);
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(path.join(client, 'node_modules'))) {
  console.log('Installing web UI dependencies...');
  // --include=dev: Vite and TypeScript are dev dependencies, even when NODE_ENV=production.
  npm(['ci', '--no-audit', '--no-fund', '--include=dev']);
}
console.log('Building web UI...');
npm(['run', 'build']);
