import { describe, it, expect, vi } from 'vitest';
import type { AivenConfig } from '../../src/types.js';

const requestMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: {}, response: { status: 200 } })
);

vi.mock('openapi-fetch', () => ({
  default: (): { request: typeof requestMock } => ({ request: requestMock }),
}));

import { AivenClient } from '../../src/client.js';

const baseConfig: Omit<AivenConfig, 'transport' | 'mcpAcornSecret'> = {
  token: 'tok',
  readOnly: false,
  categories: undefined,
  allowSecrets: false,
};

describe('PG Editor acorn auth', () => {
  it('requires MCP_ACORN_SECRET in http transport', async () => {
    const client = new AivenClient({ ...baseConfig, transport: 'http', mcpAcornSecret: undefined });

    await expect(
      client.post('/project/p/service/s/pg-editor/run-query', {}, { mcpAcornAuth: true, token: 'tok' })
    ).rejects.toThrow('MCP_ACORN_SECRET');

    expect(requestMock).not.toHaveBeenCalled();
  });

  it('allows pg-editor call in stdio without MCP_ACORN_SECRET', async () => {
    requestMock.mockClear();
    const client = new AivenClient({ ...baseConfig, transport: 'stdio', mcpAcornSecret: undefined });

    await client.post('/project/p/service/s/pg-editor/run-query', {}, { mcpAcornAuth: true, token: 'tok' });

    expect(requestMock).toHaveBeenCalledWith(
      'post',
      '/project/p/service/s/pg-editor/run-query',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'X-MCP-Acorn-Authorization': expect.anything(),
        }),
      })
    );
  });

  it('sends X-MCP-Acorn-Authorization when MCP_ACORN_SECRET is set', async () => {
    requestMock.mockClear();
    const client = new AivenClient({
      ...baseConfig,
      transport: 'stdio',
      mcpAcornSecret: 'acorn-secret',
    });

    await client.post('/project/p/service/s/pg-editor/run-query', {}, { mcpAcornAuth: true, token: 'tok' });

    expect(requestMock).toHaveBeenCalledWith(
      'post',
      '/project/p/service/s/pg-editor/run-query',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-MCP-Acorn-Authorization': 'acorn-secret',
        }),
      })
    );
  });
});
