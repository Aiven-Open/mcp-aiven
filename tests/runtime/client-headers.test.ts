import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestMock = vi.fn().mockResolvedValue({
  data: { ok: true },
  response: { status: 200 },
});

vi.mock('openapi-fetch', () => ({
  default: vi.fn(() => ({ request: requestMock })),
}));

describe('AivenClient MCP Acorn authorization', () => {
  beforeEach(() => {
    requestMock.mockClear();
  });

  it('sends X-MCP-Acorn-Authorization when mcpAcornAuth is requested', async () => {
    const { AivenClient, MCP_ACORN_AUTHORIZATION_HEADER } = await import('../../src/client.js');
    const client = new AivenClient({
      token: 'user-token',
      readOnly: false,
      transport: 'http',
      categories: undefined,
      mcpAcornSecret: 'acorn-shared-secret',
    });

    await client.post('/project/p/service/s/pg-editor/run-query', { query: 'SELECT 1' }, { mcpAcornAuth: true });

    const callArgs = requestMock.mock.calls[0]?.[2] as { headers?: Record<string, string> };
    expect(callArgs.headers?.['Authorization']).toBe('Bearer user-token');
    expect(callArgs.headers?.[MCP_ACORN_AUTHORIZATION_HEADER]).toBe('acorn-shared-secret');
  });

  it('throws when mcpAcornAuth is requested but MCP_ACORN_SECRET is not configured', async () => {
    const { AivenClient } = await import('../../src/client.js');
    const client = new AivenClient({
      token: 'user-token',
      readOnly: false,
      transport: 'stdio',
      categories: undefined,
      mcpAcornSecret: undefined,
    });

    await expect(
      client.post('/project/p/service/s/pg-editor/run-query', {}, { mcpAcornAuth: true })
    ).rejects.toThrow('MCP_ACORN_SECRET environment variable is required');
  });
});
