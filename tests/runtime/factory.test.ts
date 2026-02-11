import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createToolFromSpec } from '../../src/factory.js';
import type { ToolSpec } from '../../src/types.js';
import {
  ServiceCategory,
  READ_ONLY_ANNOTATIONS,
  CREATE_ANNOTATIONS,
  DELETE_ANNOTATIONS,
} from '../../src/types.js';
import type { AivenClient } from '../../src/client.js';

function createMockClient(response: {
  status: string;
  data?: unknown;
  error?: unknown;
}): AivenClient {
  const mockFn = vi.fn().mockResolvedValue(response);
  return {
    get: mockFn,
    post: mockFn,
    put: mockFn,
    delete: mockFn,
    patch: mockFn,
    request: mockFn,
  } as unknown as AivenClient;
}

const baseSpec: ToolSpec = {
  name: 'aiven_list_projects',
  category: ServiceCategory.Core,
  title: 'List Projects',
  description: 'List all projects',
  method: 'GET',
  path: '/project',
  inputSchema: z.object({}).strict(),
  annotations: READ_ONLY_ANNOTATIONS,
};

describe('createToolFromSpec', () => {
  it('should create a tool definition with correct metadata', () => {
    const client = createMockClient({ status: 'success', data: {} });
    const tool = createToolFromSpec(baseSpec, client);

    expect(tool.name).toBe('aiven_list_projects');
    expect(tool.category).toBe('core');
    expect(tool.definition.title).toBe('List Projects');
    expect(tool.definition.description).toBe('List all projects');
    expect(tool.definition.annotations).toEqual(READ_ONLY_ANNOTATIONS);
  });

  it('should call client.get for GET methods', async () => {
    const client = createMockClient({ status: 'success', data: { projects: [] } });
    const tool = createToolFromSpec(baseSpec, client);

    await tool.handler({});

    expect(client.get).toHaveBeenCalledWith('/project', undefined);
  });

  it('should replace path params in URL', async () => {
    const spec: ToolSpec = {
      ...baseSpec,
      path: '/project/{project}/service/{service_name}',
      inputSchema: z
        .object({
          project: z.string(),
          service_name: z.string(),
        })
        .strict(),
    };
    const client = createMockClient({ status: 'success', data: {} });
    const tool = createToolFromSpec(spec, client);

    await tool.handler({ project: 'my-proj', service_name: 'my-svc' });

    expect(client.get).toHaveBeenCalledWith('/project/my-proj/service/my-svc', undefined);
  });

  it('should pass non-path params as query for GET', async () => {
    const spec: ToolSpec = {
      ...baseSpec,
      path: '/project/{project}/service',
      inputSchema: z
        .object({
          project: z.string(),
          include_secrets: z.boolean().optional(),
        })
        .strict(),
    };
    const client = createMockClient({ status: 'success', data: {} });
    const tool = createToolFromSpec(spec, client);

    await tool.handler({ project: 'my-proj', include_secrets: true });

    expect(client.get).toHaveBeenCalledWith('/project/my-proj/service', {
      query: { include_secrets: true },
    });
  });

  it('should call client.request for POST with body', async () => {
    const spec: ToolSpec = {
      ...baseSpec,
      method: 'POST',
      path: '/project/{project}/service',
      inputSchema: z
        .object({
          project: z.string(),
          service_name: z.string(),
          plan: z.string(),
        })
        .strict(),
      annotations: CREATE_ANNOTATIONS,
    };
    const client = createMockClient({ status: 'success', data: {} });
    const tool = createToolFromSpec(spec, client);

    await tool.handler({ project: 'my-proj', service_name: 'my-svc', plan: 'startup-4' });

    expect(client.request).toHaveBeenCalledWith('POST', '/project/my-proj/service', {
      service_name: 'my-svc',
      plan: 'startup-4',
    });
  });

  it('should call client.delete for DELETE methods', async () => {
    const spec: ToolSpec = {
      ...baseSpec,
      method: 'DELETE',
      path: '/project/{project}/service/{service_name}',
      inputSchema: z
        .object({
          project: z.string(),
          service_name: z.string(),
        })
        .strict(),
      annotations: DELETE_ANNOTATIONS,
    };
    const client = createMockClient({ status: 'success', data: {} });
    const tool = createToolFromSpec(spec, client);

    await tool.handler({ project: 'my-proj', service_name: 'my-svc' });

    expect(client.delete).toHaveBeenCalledWith('/project/my-proj/service/my-svc');
  });

  it('should return error result on API error', async () => {
    const client = createMockClient({
      status: 'error',
      error: { message: 'Not found', status: 404 },
    });
    const tool = createToolFromSpec(baseSpec, client);

    const result = await tool.handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Aiven API Error');
  });

  it('should redact sensitive data in response', async () => {
    const client = createMockClient({
      status: 'success',
      data: { password: 'secret', name: 'test' },
    });
    const tool = createToolFromSpec(baseSpec, client);

    const result = await tool.handler({});

    expect(result.content[0]?.text).toContain('[REDACTED]');
    expect(result.content[0]?.text).not.toContain('secret');
    expect(result.content[0]?.text).toContain('test');
  });

  it('should apply service_list formatter to trim response', async () => {
    const spec: ToolSpec = {
      ...baseSpec,
      path: '/project/{project}/service',
      inputSchema: z.object({ project: z.string() }).strict(),
      formatter: 'service_list',
    };
    const client = createMockClient({
      status: 'success',
      data: {
        services: [
          {
            service_name: 'my-pg',
            service_type: 'pg',
            state: 'RUNNING',
            plan: 'business-4',
            cloud_name: 'google-europe-west1',
            node_count: 3,
            create_time: '2025-01-01T00:00:00Z',
            update_time: '2025-01-02T00:00:00Z',
            tags: {},
            connection_info: { host: 'secret-host.aiven.io', port: 5432 },
            service_uri: 'postgres://user:pass@host:5432/db',
            components: [{ component: 'pg', host: 'host', port: 5432 }],
            users: [{ username: 'avnadmin', password: 'secret' }],
            node_states: [{ name: 'node1', state: 'running' }],
          },
        ],
      },
    });
    const tool = createToolFromSpec(spec, client);

    const result = await tool.handler({ project: 'my-proj' });
    const parsed = JSON.parse(result.content[0]?.text ?? '') as {
      services: Array<Record<string, unknown>>;
    };

    expect(parsed.services).toHaveLength(1);
    expect(parsed.services[0]).toEqual({
      service_name: 'my-pg',
      service_type: 'pg',
      state: 'RUNNING',
      plan: 'business-4',
    });
  });
});
