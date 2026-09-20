import { vi } from 'vitest';

/** Keeps unit tests independent of the Cloudflare-only runtime imported by the Agents SDK. */
vi.mock('agents', () => ({
  Agent: class {
    ctx = undefined;
  },
}));

/** Replaces the Cloudflare-only chat runtime while retaining the Agent-shaped test surface. */
vi.mock('@cloudflare/ai-chat', () => ({
  AIChatAgent: class {
    ctx = undefined;
    env = undefined;
    messages: unknown[] = [];
  },
}));

/** Keeps unit tests independent of the Cloudflare-only Container runtime. */
vi.mock('@cloudflare/containers', () => ({
  Container: function ContainerTestDouble() {},
  getContainer: vi.fn(),
}));
