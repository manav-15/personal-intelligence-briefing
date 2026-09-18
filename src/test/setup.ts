import { vi } from 'vitest';

/** Keeps unit tests independent of the Cloudflare-only runtime imported by the Agents SDK. */
vi.mock('agents', () => ({
  Agent: class {
    ctx = undefined;
  },
}));
