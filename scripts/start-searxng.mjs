#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

/** Creates a local secret if needed and starts the pinned localhost-only service. */
async function main() {
  const directory = new URL('../infra/searxng/', import.meta.url);
  const environment = new URL('.env', directory);
  if (!existsSync(environment)) {
    writeFileSync(
      environment,
      `SEARXNG_SECRET=${randomBytes(32).toString('hex')}\n`,
      {
        flag: 'wx',
        mode: 0o600,
      },
    );
  }
  const result = spawnSync('docker', ['compose', 'up', '-d'], {
    cwd: directory,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if (process.exitCode !== 0) return;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:8080/', {
        signal: AbortSignal.timeout(1000),
      });
      await response.body?.cancel();
      if (response.ok) {
        console.log('Local SearXNG is ready at http://localhost:8080');
        return;
      }
    } catch {
      // The HTTP server can become available after Docker reports the container started.
    }
    await delay(500);
  }
  throw new Error('SearXNG did not become ready. Inspect docker compose logs.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
