import { describe, it, expect, vi } from 'vitest';
import { createServiceSearchTool } from '../../src/tools/service-search.js';
import type { AivenClient } from '../../src/client.js';
import type { ToolResult } from '../../src/types.js';

interface ParsedResponse {
  showing: number;
  hint?: string;
  services: Array<{ project: string; service_name: string; service_type: string; state: string }>;
  errors?: Array<{ project: string; error: string }>;
}

function parseResponse(result: ToolResult): ParsedResponse {
  const content = result.content as Array<{ type: string; text: string }>;
  const text = content[0].text;
  const wrapped = text.match(/<untrusted-aiven-response-[^>]+>\n([\s\S]*?)\n<\/untrusted-aiven-response/);
  const json = wrapped ? wrapped[1] : text;
  return JSON.parse(json) as ParsedResponse;
}

function makeServices(project: string, count: number, type = 'pg', state = 'RUNNING'): Array<{ service_name: string; service_type: string; state: string }> {
  return Array.from({ length: count }, (_, idx) => ({
    service_name: `${project}-svc-${idx}`,
    service_type: type,
    state,
  }));
}

function createMockClient(projects: string[], servicesByProject: Record<string, Array<{ service_name: string; service_type: string; state: string }>>): AivenClient {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === '/project') {
      return Promise.resolve({ projects: projects.map((p) => ({ project_name: p })) });
    }
    const match = path.match(/\/project\/([^/]+)\/service/);
    if (match) {
      const proj = decodeURIComponent(match[1]);
      const services = servicesByProject[proj] ?? [];
      return Promise.resolve({ services });
    }
    return Promise.reject(new Error(`unexpected path: ${path}`));
  });
  return { get, post: get, put: get, delete: get, patch: get, request: get } as unknown as AivenClient;
}

describe('service-search', () => {
  it('returns services from a single project', async () => {
    const client = createMockClient(['proj-a'], {
      'proj-a': makeServices('proj-a', 3),
    });
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ project: 'proj-a' });
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(3);
    expect(parsed.services).toHaveLength(3);
    expect(parsed.services[0]).toMatchObject({ project: 'proj-a', service_name: 'proj-a-svc-0' });
    expect(parsed.hint).toBeUndefined();
    expect(parsed.errors).toBeUndefined();
  });

  it('searches across all projects when no project specified', async () => {
    const client = createMockClient(['proj-a', 'proj-b'], {
      'proj-a': makeServices('proj-a', 2),
      'proj-b': makeServices('proj-b', 1),
    });
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({});
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(3);
    expect(parsed.services).toHaveLength(3);
  });

  it('filters by service_type case-insensitively', async () => {
    const client = createMockClient(['proj-a'], {
      'proj-a': [
        { service_name: 'pg-1', service_type: 'pg', state: 'RUNNING' },
        { service_name: 'kafka-1', service_type: 'kafka', state: 'RUNNING' },
      ],
    });
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ project: 'proj-a', service_type: 'PG' });
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(1);
    expect(parsed.services[0].service_name).toBe('pg-1');
  });

  it('filters by state case-insensitively', async () => {
    const client = createMockClient(['proj-a'], {
      'proj-a': [
        { service_name: 'svc-1', service_type: 'pg', state: 'RUNNING' },
        { service_name: 'svc-2', service_type: 'pg', state: 'POWERED_OFF' },
      ],
    });
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ project: 'proj-a', state: 'powered_off' });
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(1);
    expect(parsed.services[0].service_name).toBe('svc-2');
  });

  it('respects limit and indicates more results exist', async () => {
    const client = createMockClient(['proj-a'], {
      'proj-a': makeServices('proj-a', 10),
    });
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ project: 'proj-a', limit: 3 });
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(3);
    expect(parsed.services).toHaveLength(3);
    expect(parsed.hint).toContain('More services may exist');
  });

  it('stops fetching projects early when limit is reached', async () => {
    const projects = Array.from({ length: 20 }, (_, idx) => `proj-${idx}`);
    const servicesByProject: Record<string, Array<{ service_name: string; service_type: string; state: string }>> = {};
    for (const p of projects) {
      servicesByProject[p] = makeServices(p, 5);
    }
    const client = createMockClient(projects, servicesByProject);
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ limit: 3 });
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(3);
    expect(parsed.hint).toContain('More services may exist');
    // Should not have fetched all 20 projects (concurrency=10, so at most 1 batch of /service calls)
    const getCalls = vi.mocked(client.get).mock.calls.filter((c) => c[0].includes('/service'));
    expect(getCalls.length).toBeLessThan(20);
  });

  it('reports errors for failed projects without swallowing them', async () => {
    const get = vi.fn().mockImplementation((path: string) => {
      if (path === '/project') {
        return Promise.resolve({ projects: [{ project_name: 'good' }, { project_name: 'bad' }] });
      }
      if (path.includes('/good/')) {
        return Promise.resolve({ services: [{ service_name: 'svc-1', service_type: 'pg', state: 'RUNNING' }] });
      }
      return Promise.reject(new Error('forbidden'));
    });
    const client = { get, post: get, put: get, delete: get, patch: get, request: get } as unknown as AivenClient;
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({});
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(1);
    expect(parsed.services[0].service_name).toBe('svc-1');
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors?.[0]).toMatchObject({ project: 'bad', error: 'forbidden' });
  });

  it('returns default MAX_RESULTS when no limit specified', async () => {
    const client = createMockClient(['proj-a'], {
      'proj-a': makeServices('proj-a', 20),
    });
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ project: 'proj-a' });
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(15);
    expect(parsed.hint).toContain('More services may exist');
  });
});
