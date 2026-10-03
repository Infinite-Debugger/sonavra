import { spawnSync } from 'node:child_process';
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('docker', ['compose', 'up', '-d', '--wait', 'postgres']);
run('pnpm', ['--filter', '@sonavra/database', 'db:migrate']);
