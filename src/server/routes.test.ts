import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  examplePreferences,
  topicProposalRequestSchema,
} from '../shared/preferences';
import {
  briefingSchema,
  type Briefing,
  type BriefingArchiveEntry,
} from '../shared/briefings';
import app from './index';
import type { PersonalBriefingAgent } from './preferences-agent';

const origin = 'https://briefing.test';
const readPreferences = vi.fn(() => ({ configured: false as const }));
const replacePreferences = vi.fn(() => ({
  ok: true as const,
  preferences: examplePreferences,
}));
const listPendingTopicProposals = vi.fn(() => []);
const createTopicProposal = vi.fn(() => ({
  ok: true as const,
  proposal: {
    promptVersion: '2026-09-18.1',
    proposal: {
      id: '0e6d1bea-0cc8-4e85-987e-8c6a76f0ccd4',
      baseRevision: 0,
      request: 'Make AI concise.',
      scope: { operation: 'edit-topic' as const, topicId: 'ai' },
      proposedTopic: examplePreferences.topics[0],
      explanation: 'Uses concise updates.',
      unresolvedQuestions: [],
    },
  },
}));
const applyTopicProposal = vi.fn<
  () => {
    ok: boolean;
    preferences?: typeof examplePreferences;
    error?: string;
    currentRevision?: number;
  }
>(() => ({ ok: true, preferences: examplePreferences }));
const discardTopicProposal = vi.fn(() => ({ ok: true as const }));
const readTodayBriefing = vi.fn<() => Briefing | undefined>(() => undefined);
const listBriefingArchive = vi.fn<() => BriefingArchiveEntry[]>(() => []);
const reserveManualBriefingRun = vi.fn(() => ({
  ok: true as const,
  runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
  date: '2026-09-19',
  created: true,
}));
const failBriefingRun = vi.fn(() => true);
const chatSession = {
  id: '9c1d3d2a-7d9d-4053-9fc9-1f1a1564d4e6',
  briefingRunId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
  briefingDate: '2026-09-19',
  storyId: 'ai-release',
  storyHeadline: 'Example model release',
  createdAt: '2026-09-19T01:00:00.000Z',
  updatedAt: '2026-09-19T01:00:00.000Z',
};
const listChatSessions = vi.fn(() => [chatSession]);
const createChatSession = vi.fn(() => chatSession);
const readChatSessionMessages = vi.fn(() => ({
  session: chatSession,
  messages: [],
}));
const deleteChatSession = vi.fn(() => true);
const readBriefingRunStatus = vi.fn(() => ({
  runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
  status: 'failed' as const,
  failureMessage: 'No eligible evidence was available.',
  collectionFailures: [
    {
      stage: 'discovery' as const,
      provider: 'searxng' as const,
      message: 'SearXNG returned HTTP 500.',
    },
  ],
}));
const createWorkflow = vi.fn(() => Promise.resolve({}));
const exampleBriefing = briefingSchema.parse({
  schemaVersion: 1,
  runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
  date: '2026-09-19',
  preferenceRevision: 3,
  completeness: 'complete',
  limitations: [],
  items: [
    {
      id: 'ai-release',
      topicIds: ['ai'],
      headline: 'Example model release',
      summary: 'The example provider released a model.',
      publishedAt: '2026-09-19T00:00:00.000Z',
      citations: [
        {
          sourceUrl: 'https://example.com/releases/model',
          publisher: 'Example',
          evidenceTier: 'article',
        },
      ],
    },
  ],
  publishedAt: '2026-09-19T01:00:00.000Z',
});
const env = {
  INSPECTION_ENABLED: 'true',
  PREFERENCES_DIAGNOSTICS_ENABLED: 'true',
  PERSONAL_BRIEFING: {
    idFromName: () => ({}) as DurableObjectId,
    get: () => ({
      readPreferences,
      replacePreferences,
      listPendingTopicProposals,
      createTopicProposal,
      applyTopicProposal,
      discardTopicProposal,
      readTodayBriefing,
      listBriefingArchive,
      reserveManualBriefingRun,
      failBriefingRun,
      readBriefingRunStatus,
      expireBriefingRuns: vi.fn(),
      readLatestBriefingRun: readBriefingRunStatus,
      readBriefingByRun: () => exampleBriefing,
      readBriefingDiagnostics: () => null,
      listChatSessions,
      createChatSession,
      readChatSessionMessages,
      deleteChatSession,
    }),
  } as unknown as DurableObjectNamespace<PersonalBriefingAgent>,
  BRIEFING_WORKFLOW: { create: createWorkflow } as unknown as Workflow,
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('HTTP policy compatibility', () => {
  it('restores current run state and opens a full archived edition', async () => {
    const current = await app.fetch(
      new Request(origin + '/api/briefings/current-run'),
      env,
    );
    const edition = await app.fetch(
      new Request(origin + '/api/briefings/archive/' + exampleBriefing.runId),
      env,
    );
    const invalid = await app.fetch(
      new Request(origin + '/api/briefings/archive/not-a-uuid'),
      env,
    );

    expect(current.status).toBe(200);
    expect(await current.json()).toEqual({ run: readBriefingRunStatus() });
    expect(await edition.json()).toEqual({ briefing: exampleBriefing });
    expect(invalid.status).toBe(400);
  });

  it('exposes retained diagnostics only through the opt-in local route', async () => {
    const url = `${origin}/api/briefings/runs/${exampleBriefing.runId}/diagnostics`;
    const enabled = await app.fetch(new Request(url), env);
    const disabled = await app.fetch(new Request(url), {
      ...env,
      PREFERENCES_DIAGNOSTICS_ENABLED: undefined,
    });
    const invalid = await app.fetch(
      new Request(origin + '/api/briefings/runs/not-a-uuid/diagnostics'),
      env,
    );

    expect(await enabled.json()).toEqual({
      diagnostics: null,
      publishedSourceUrls: exampleBriefing.items.flatMap((item) =>
        item.citations.map((citation) => citation.sourceUrl),
      ),
    });
    expect(enabled.headers.get('Cache-Control')).toBe('no-store');
    expect(disabled.status).toBe(404);
    expect(invalid.status).toBe(400);
  });

  const routes = [
    ['/api/health', 'GET', null],
    ['/api/preferences', 'GET, PUT', null],
    ['/api/preferences/proposals', 'GET, POST', null],
    [
      '/api/preferences/proposals/0e6d1bea-0cc8-4e85-987e-8c6a76f0ccd4',
      'PUT',
      null,
    ],
    ['/api/inspection/search', 'GET', 'no-store'],
    ['/api/inspection/evidence', 'POST', 'no-store'],
    ['/api/feasibility/discovery', 'GET', null],
    ['/api/briefings/today', 'GET', 'no-store'],
    ['/api/briefings/archive', 'GET', 'no-store'],
    ['/api/chats', 'GET, POST', 'no-store'],
    [
      '/api/chats/9c1d3d2a-7d9d-4053-9fc9-1f1a1564d4e6/messages',
      'GET',
      'no-store',
    ],
    ['/api/briefings/generate', 'POST', 'no-store'],
    [
      '/api/briefings/runs/ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
      'GET',
      'no-store',
    ],
  ] as const;

  it.each(routes)(
    'rejects unsupported methods at %s without side effects',
    async (path, allow, cache) => {
      const fetcher = vi.fn();

      vi.stubGlobal('fetch', fetcher);

      for (const method of ['HEAD', 'OPTIONS', 'DELETE', 'PATCH']) {
        const response = await app.fetch(
          new Request(origin + path, { method }),
          env,
        );

        expect(response.status).toBe(405);
        expect(response.headers.get('Allow')).toBe(allow);
        expect(response.headers.get('Cache-Control')).toBe(cache);
        expect(response.headers.get('Content-Type')).toContain(
          'application/json',
        );

        if (method === 'HEAD') expect(await response.text()).toBe('');
        else
          expect(await response.json()).toEqual({
            error: 'Method not allowed',
          });
      }
      expect(fetcher).not.toHaveBeenCalled();
      expect(readPreferences).not.toHaveBeenCalled();
      expect(replacePreferences).not.toHaveBeenCalled();
    },
  );

  it('keeps durable chat-session routes owner-scoped, validated, and non-cacheable', async () => {
    const list = await app.fetch(new Request(origin + '/api/chats'), env);
    const create = await app.fetch(
      new Request(origin + '/api/chats', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          briefingRunId: chatSession.briefingRunId,
          storyId: chatSession.storyId,
        }),
      }),
      env,
    );
    const messages = await app.fetch(
      new Request(`${origin}/api/chats/${chatSession.id}/messages`),
      env,
    );
    const remove = await app.fetch(
      new Request(`${origin}/api/chats/${chatSession.id}`, {
        method: 'DELETE',
      }),
      env,
    );
    const rejected = await app.fetch(
      new Request(origin + '/api/chats', {
        method: 'POST',
        headers: {
          Origin: 'https://other.test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          briefingRunId: chatSession.briefingRunId,
          storyId: chatSession.storyId,
        }),
      }),
      env,
    );

    expect(await list.json()).toEqual({ sessions: [chatSession] });
    expect(create.status).toBe(201);
    expect(await create.json()).toEqual({ session: chatSession });
    expect(await messages.json()).toEqual({
      session: chatSession,
      messages: [],
    });
    expect(remove.status).toBe(204);
    expect(rejected.status).toBe(403);
    expect(list.headers.get('Cache-Control')).toBe('no-store');
  });

  it('starts a reserved manual run once and returns its workflow ID', async () => {
    const response = await app.fetch(
      new Request(origin + '/api/briefings/generate', { method: 'POST' }),
      env,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
      created: true,
    });
    expect(createWorkflow).toHaveBeenCalledOnce();
  });

  it('reads a persisted terminal status and validates the run ID', async () => {
    const status = await app.fetch(
      new Request(
        origin + '/api/briefings/runs/ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
      ),
      env,
    );
    const invalid = await app.fetch(
      new Request(origin + '/api/briefings/runs/not-a-uuid'),
      env,
    );

    expect(status.status).toBe(200);
    expect(await status.json()).toEqual(readBriefingRunStatus());
    expect(readBriefingRunStatus).toHaveBeenCalledWith(
      'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
      'single-user',
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'Invalid briefing run ID.' });
  });

  it.each([
    '/api',
    '/api/missing',
    '/api/preferences/extra',
    '/api/preferences/',
    '/api/health/',
    '/api/feasibility/missing',
    '/api/inspection/missing',
    '/api/inspection/search/',
    '/api/inspection',
    '/api/briefings',
    '/api/briefings/today/',
  ])('keeps unknown route %s JSON for every method', async (path) => {
    for (const method of ['GET', 'POST', 'HEAD', 'OPTIONS']) {
      const response = await app.fetch(
        new Request(origin + path, { method }),
        env,
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('Content-Type')).toContain(
        'application/json',
      );
      expect(response.headers.get('Allow')).toBeNull();
      expect(response.headers.get('Cache-Control')).toBe(
        path.startsWith('/api/inspection/') || path.startsWith('/api/briefings')
          ? 'no-store'
          : null,
      );

      if (method !== 'HEAD')
        expect(await response.json()).toEqual({ error: 'Not found' });
    }
  });

  it.each([
    ['/api/preferences', 'Preference diagnostics are disabled.', null],
    [
      '/api/preferences/proposals',
      'Preference diagnostics are disabled.',
      null,
    ],
    ['/api/inspection/search', 'Local inspection is disabled.', 'no-store'],
    ['/api/inspection/missing', 'Local inspection is disabled.', 'no-store'],
  ])(
    'checks diagnostic enablement first for %s',
    async (path, error, cache) => {
      const response = await app.fetch(
        new Request(origin + path, {
          method: 'OPTIONS',
          headers: { Origin: 'https://other.test' },
        }),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error });
      expect(response.headers.get('Cache-Control')).toBe(cache);
    },
  );

  it('checks the preferences binding before origin and method', async () => {
    const response = await app.fetch(
      new Request(origin + '/api/preferences', {
        method: 'OPTIONS',
        headers: { Origin: 'https://other.test' },
      }),
      { PREFERENCES_DIAGNOSTICS_ENABLED: 'true' },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Personal Briefing Agent is not configured.',
    });
  });

  it.each([
    '/api/preferences',
    '/api/preferences/proposals',
    '/api/preferences/proposals/0e6d1bea-0cc8-4e85-987e-8c6a76f0ccd4',
    '/api/inspection/search',
    '/api/inspection/evidence',
    '/api/inspection/missing',
    '/api/briefings/today',
    '/api/briefings/runs/ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
  ])('checks origin before method for %s', async (path) => {
    for (const headers of [
      { Origin: 'https://other.test' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      const response = await app.fetch(
        new Request(origin + path, { method: 'OPTIONS', headers }),
        env,
      );

      expect(response.status).toBe(403);
      expect(response.headers.get('Allow')).toBeNull();
    }
    expect(readPreferences).not.toHaveBeenCalled();
  });

  it('preserves write-specific origin and media-type checks', async () => {
    for (const [path, method, headers, status] of [
      ['/api/preferences', 'PUT', {}, 403],
      ['/api/preferences', 'PUT', { Origin: origin }, 403],
      ['/api/inspection/evidence', 'POST', {}, 403],
      ['/api/inspection/evidence', 'POST', { Origin: origin }, 415],
    ] as const) {
      const response = await app.fetch(
        new Request(origin + path, { method, headers }),
        env,
      );

      expect(response.status).toBe(status);
    }
  });

  it('reads empty and published Today and Archive results', async () => {
    const emptyToday = await app.fetch(
      new Request(origin + '/api/briefings/today'),
      env,
    );
    const emptyArchive = await app.fetch(
      new Request(origin + '/api/briefings/archive'),
      env,
    );

    expect(await emptyToday.json()).toEqual({ briefing: null });
    expect(await emptyArchive.json()).toEqual({ briefings: [] });

    readTodayBriefing.mockReturnValueOnce(exampleBriefing);
    listBriefingArchive.mockReturnValueOnce([
      {
        runId: exampleBriefing.runId,
        date: exampleBriefing.date,
        completeness: exampleBriefing.completeness,
        itemCount: exampleBriefing.items.length,
        publishedAt: exampleBriefing.publishedAt,
      },
    ]);
    const today = await app.fetch(
      new Request(origin + '/api/briefings/today'),
      env,
    );
    const archive = await app.fetch(
      new Request(origin + '/api/briefings/archive'),
      env,
    );

    expect(await today.json()).toEqual({ briefing: exampleBriefing });
    expect(await archive.json()).toEqual({
      briefings: [
        {
          runId: exampleBriefing.runId,
          date: exampleBriefing.date,
          completeness: exampleBriefing.completeness,
          itemCount: exampleBriefing.items.length,
          publishedAt: exampleBriefing.publishedAt,
        },
      ],
    });
  });

  it.each(['null', '[]', '"text"', '42', '{'])(
    'validates preference JSON before field access: %s',
    async (body) => {
      const response = await app.fetch(
        new Request(origin + '/api/preferences', {
          method: 'PUT',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body,
        }),
        env,
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'Invalid preference document.',
      });
      expect(replacePreferences).not.toHaveBeenCalled();
    },
  );

  it('validates revisions and documents before RPC, then preserves a successful replacement', async () => {
    for (const [body, status, error] of [
      [
        { expectedRevision: '0', document: examplePreferences },
        400,
        'expectedRevision must be an integer.',
      ],
      [
        { expectedRevision: 0, document: {} },
        400,
        'Invalid preference document.',
      ],
      [{ expectedRevision: 0, document: examplePreferences }, 200, undefined],
    ] as const) {
      const response = await app.fetch(
        new Request(origin + '/api/preferences', {
          method: 'PUT',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        env,
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(
        error ? { error } : { preferences: examplePreferences },
      );
      expect(response.headers.get('Cache-Control')).toBe(
        status === 200 ? 'no-store' : null,
      );
    }
    expect(replacePreferences).toHaveBeenCalledExactlyOnceWith(
      examplePreferences,
      0,
      'single-user',
    );
  });

  it('creates, reads, and explicitly acts on validated topic proposals', async () => {
    expect(
      topicProposalRequestSchema.safeParse({
        request: 'Make AI concise.',
        scope: { operation: 'edit-topic', topicId: 'ai' },
      }).success,
    ).toBe(true);
    const created = await app.fetch(
      new Request(origin + '/api/preferences/proposals', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request: 'Make AI concise.',
          scope: { operation: 'edit-topic', topicId: 'ai' },
        }),
      }),
      env,
    );

    expect(createTopicProposal).toHaveBeenCalledWith(
      {
        request: 'Make AI concise.',
        scope: { operation: 'edit-topic', topicId: 'ai' },
      },
      'single-user',
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      proposal: {
        promptVersion: '2026-09-18.1',
        proposal: {
          id: '0e6d1bea-0cc8-4e85-987e-8c6a76f0ccd4',
          baseRevision: 0,
          request: 'Make AI concise.',
          scope: { operation: 'edit-topic', topicId: 'ai' },
          proposedTopic: examplePreferences.topics[0],
          explanation: 'Uses concise updates.',
          unresolvedQuestions: [],
        },
      },
    });
    const listed = await app.fetch(
      new Request(origin + '/api/preferences/proposals'),
      env,
    );

    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ proposals: [] });
    const applied = await app.fetch(
      new Request(
        origin +
          '/api/preferences/proposals/0e6d1bea-0cc8-4e85-987e-8c6a76f0ccd4',
        {
          method: 'PUT',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'apply' }),
        },
      ),
      env,
    );

    expect(applied.status).toBe(200);
    expect(applyTopicProposal).toHaveBeenCalledWith(
      '0e6d1bea-0cc8-4e85-987e-8c6a76f0ccd4',
      'single-user',
    );
    expect(await applied.json()).toEqual({ preferences: examplePreferences });
  });

  it.each([
    [JSON.stringify({ request: '', scope: { operation: 'add-topic' } })],
    [JSON.stringify({ request: 'Valid', scope: { operation: 'edit-topic' } })],
    ['{'],
  ])(
    'rejects malformed topic proposal input before Agent RPC: %s',
    async (body) => {
      const response = await app.fetch(
        new Request(origin + '/api/preferences/proposals', {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body,
        }),
        env,
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'Invalid topic proposal request.',
      });
      expect(createTopicProposal).not.toHaveBeenCalled();
    },
  );

  it('preserves same-origin policy and revision conflicts for proposal actions', async () => {
    const crossOrigin = await app.fetch(
      new Request(origin + '/api/preferences/proposals', {
        method: 'POST',
        headers: {
          Origin: 'https://other.test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          request: 'Make AI concise.',
          scope: { operation: 'edit-topic', topicId: 'ai' },
        }),
      }),
      env,
    );

    expect(crossOrigin.status).toBe(403);
    applyTopicProposal.mockReturnValueOnce({
      ok: false,
      error: 'Preferences changed after this proposal was created.',
      currentRevision: 4,
    });
    const conflict = await app.fetch(
      new Request(
        origin +
          '/api/preferences/proposals/0e6d1bea-0cc8-4e85-987e-8c6a76f0ccd4',
        {
          method: 'PUT',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'apply' }),
        },
      ),
      env,
    );

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: 'Preferences changed after this proposal was created.',
      currentRevision: 4,
    });
  });

  it('contains malformed inspection JSON and rejects oversized actual streamed bytes', async () => {
    const fetcher = vi.fn();

    vi.stubGlobal('fetch', fetcher);

    for (const [body, status, error] of [
      ['{', 400, 'Could not read the JSON story.'],
      ['null', 400, 'Invalid story metadata.'],
    ] as const) {
      const response = await app.fetch(
        new Request(origin + '/api/inspection/evidence', {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body,
        }),
        env,
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
    }
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8000));
        controller.enqueue(new Uint8Array(8001));
      },
      cancel,
    });
    const request = new Request(origin + '/api/inspection/evidence', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'Content-Length': '1',
      },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const response = await app.fetch(request, env);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: 'Story request exceeded the size limit.',
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
