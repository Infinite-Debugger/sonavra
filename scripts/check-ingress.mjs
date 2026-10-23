import process from 'node:process';
import console from 'node:console';
import { pathToFileURL } from 'node:url';

export function checkIngress(configuration) {
  if (!configuration.services || !Object.keys(configuration.services).length)
    throw new Error('No deployment services found');
  const failures = [];
  for (const [name, service] of Object.entries(configuration.services ?? {})) {
    if (name === 'ingress') {
      if (
        service.network_mode === 'host' ||
        (service.ports ?? []).some(
          (port) => !['80', '443'].includes(String(port.published)),
        )
      )
        failures.push('ingress: only explicit HTTP/HTTPS ports are permitted');
      continue;
    }
    if (service.network_mode === 'host')
      failures.push(`${name}: host networking cannot be verified as private`);
    for (const port of service.ports ?? []) {
      if (
        typeof port !== 'object' ||
        !['127.0.0.1', '::1'].includes(port.host_ip)
      )
        failures.push(`${name}: published port is not restricted to loopback`);
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    checkIngress(JSON.parse(input));
    console.log('Internal service ports are private.');
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : 'Invalid deployment configuration',
    );
    process.exitCode = 1;
  }
}
