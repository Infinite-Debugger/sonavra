import process from 'node:process';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkIngress } from './check-ingress.mjs';
test('rejects accidentally public API, storage, database and runtime ports', () => {
  for (const name of [
    'api',
    'object-storage',
    'postgres',
    'transcription-runtime',
    'worker',
  ]) {
    for (const host_ip of [undefined, '0.0.0.0', '::'])
      assert.throws(() =>
        checkIngress({
          services: {
            [name]: { ports: [{ host_ip, published: '9000', target: 9000 }] },
          },
        }),
      );
    assert.throws(() =>
      checkIngress({ services: { [name]: { network_mode: 'host' } } }),
    );
    assert.doesNotThrow(() =>
      checkIngress({
        services: {
          [name]: {
            ports: [{ host_ip: '127.0.0.1', published: '9000', target: 9000 }],
          },
        },
      }),
    );
  }
});

test('the ingress CLI waits for delayed piped configuration', async () => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./check-ingress.mjs', import.meta.url))],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    errors += String(chunk);
  });
  child.stdin.on('error', () => undefined);
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  child.stdin.write('{"services":');
  setTimeout(
    () =>
      child.stdin.end(
        '{"storage":{"ports":[{"host_ip":"127.0.0.1","published":"9000"}]}}}',
      ),
    30,
  );
  assert.equal(await finished, 0, errors);
  assert.match(output, /Internal service ports are private/);
});
