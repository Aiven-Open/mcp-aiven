import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createApiTool } from '../../src/tools/api-tool.js';
import {
  ServiceCategory,
  READ_ONLY_ANNOTATIONS,
  CREATE_ANNOTATIONS,
  DELETE_ANNOTATIONS,
} from '../../src/types.js';
import type { ApiToolConfig } from '../../src/types.js';
import type { AivenClient } from '../../src/client.js';
import { AivenError } from '../../src/errors.js';

function firstTextContent(
  content: Array<{ type: string; text?: string }> | undefined
): string | undefined {
  const c = content?.[0];
  return c?.type === 'text' ? c.text : undefined;
}

function createMockClient(data: unknown): AivenClient {
  const mockFn = vi.fn().mockResolvedValue(data);
  return {
    get: mockFn,
    post: mockFn,
    put: mockFn,
    delete: mockFn,
    patch: mockFn,
    request: mockFn,
  } as unknown as AivenClient;
}

function createErrorClient(status: number, message: string): AivenClient {
  const mockFn = vi.fn().mockRejectedValue(new AivenError(status, message));
  return {
    get: mockFn,
    post: mockFn,
    put: mockFn,
    delete: mockFn,
    patch: mockFn,
    request: mockFn,
  } as unknown as AivenClient;
}

const baseConfig: ApiToolConfig = {
  name: 'aiven_list_projects',
  category: ServiceCategory.Core,
  title: 'List Projects',
  description: 'List all projects',
  method: 'GET',
  path: '/project',
  inputSchema: z.object({}).strict(),
  annotations: READ_ONLY_ANNOTATIONS,
};

describe('createApiTool', () => {
  it('should create a tool definition with correct metadata', () => {
    const client = createMockClient({});
    const tool = createApiTool(baseConfig, client);

    expect(tool.name).toBe('aiven_list_projects');
    expect(tool.category).toBe('core');
    expect(tool.definition.title).toBe('List Projects');
    expect(tool.definition.description).toBe('List all projects');
    expect(tool.definition.annotations).toEqual(READ_ONLY_ANNOTATIONS);
  });

  it('should call client.get for GET methods', async () => {
    const client = createMockClient({ projects: [] });
    const tool = createApiTool(baseConfig, client);

    await tool.handler({});

    expect(client.get).toHaveBeenCalledWith('/project', undefined);
  });

  it('should replace path params in URL', async () => {
    const config: ApiToolConfig = {
      ...baseConfig,
      path: '/project/{project}/service/{service_name}',
      inputSchema: z
        .object({
          project: z.string(),
          service_name: z.string(),
        })
        .strict(),
    };
    const client = createMockClient({});
    const tool = createApiTool(config, client);

    await tool.handler({ project: 'my-proj', service_name: 'my-svc' });

    expect(client.get).toHaveBeenCalledWith('/project/my-proj/service/my-svc', undefined);
  });

  it('should pass non-path params as query for GET', async () => {
    const config: ApiToolConfig = {
      ...baseConfig,
      path: '/project/{project}/service',
      inputSchema: z
        .object({
          project: z.string(),
          verbose: z.boolean().optional(),
        })
        .strict(),
    };
    const client = createMockClient({});
    const tool = createApiTool(config, client);

    await tool.handler({ project: 'my-proj', verbose: true });

    expect(client.get).toHaveBeenCalledWith('/project/my-proj/service', {
      query: { verbose: true },
    });
  });

  it('should call client.request for POST with body', async () => {
    const config: ApiToolConfig = {
      ...baseConfig,
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
    const client = createMockClient({});
    const tool = createApiTool(config, client);

    await tool.handler({ project: 'my-proj', service_name: 'my-svc', plan: 'startup-4' });

    expect(client.request).toHaveBeenCalledWith(
      'POST',
      '/project/my-proj/service',
      { service_name: 'my-svc', plan: 'startup-4' },
      undefined
    );
  });

  it('should apply defaults for POST when fields are missing', async () => {
    const config: ApiToolConfig = {
      ...baseConfig,
      method: 'POST',
      path: '/project/{project}/service',
      inputSchema: z
        .object({
          project: z.string(),
          service_name: z.string(),
        })
        .strict(),
      annotations: CREATE_ANNOTATIONS,
      defaults: { project_vpc_id: null },
    };
    const client = createMockClient({});
    const tool = createApiTool(config, client);

    await tool.handler({ project: 'my-proj', service_name: 'my-svc' });

    expect(client.request).toHaveBeenCalledWith(
      'POST',
      '/project/my-proj/service',
      { service_name: 'my-svc', project_vpc_id: null },
      undefined
    );
  });

  it('should call client.delete for DELETE methods', async () => {
    const config: ApiToolConfig = {
      ...baseConfig,
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
    const client = createMockClient({});
    const tool = createApiTool(config, client);

    await tool.handler({ project: 'my-proj', service_name: 'my-svc' });

    expect(client.delete).toHaveBeenCalledWith('/project/my-proj/service/my-svc', undefined);
  });

  it('should return error result on API error', async () => {
    const client = createErrorClient(404, 'Not found');
    const tool = createApiTool(baseConfig, client);

    const result = await tool.handler({});

    expect(result.isError).toBe(true);
    expect(firstTextContent(result.content)).toContain('Aiven API Error');
  });

  it('should apply response filter when provided', async () => {
    const config: ApiToolConfig = {
      ...baseConfig,
      responseFilter: {
        key: 'items',
        fields: ['name'],
      },
    };
    const client = createMockClient({
      items: [
        { name: 'a', extra: 'dropped' },
        { name: 'b', extra: 'dropped' },
      ],
    });
    const tool = createApiTool(config, client);

    const result = await tool.handler({});
    const parsed = JSON.parse(firstTextContent(result.content) ?? '');

    expect(parsed).toEqual({ items: [{ name: 'a' }, { name: 'b' }] });
  });

  it('should redact sensitive data in response', async () => {
    const client = createMockClient({ password: 'secret', name: 'test' });
    const tool = createApiTool(baseConfig, client);

    const result = await tool.handler({});

    expect(firstTextContent(result.content)).toContain('[REDACTED]');
    expect(firstTextContent(result.content)).not.toContain('secret');
    expect(firstTextContent(result.content)).toContain('test');
  });
});
