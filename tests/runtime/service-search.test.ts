import { describe, it, expect, vi } from 'vitest';
import { createServiceSearchTool } from '../../src/tools/service-search.js';
import type { AivenClient } from '../../src/client.js';
import type { ToolResult } from '../../src/types.js';

interface ParsedResponse {
  summary?: string;
  showing: number;
  searched_projects?: number;
  total_projects?: number;
  offset?: number;
  next_offset?: number;
  hint?: string;
  services: Array<{ project: string; service_name: string; service_type: string; state: string }>;
  errors?: Array<{ project: string; error: string }>;
}

function parseError(result: ToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
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
    expect(parsed.next_offset).toBe(3);
    expect(parsed.hint).toContain('More matching services exist');
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
    expect(parsed.hint).toContain('More matching services exist');
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

  it('filters by search (free-text on service_name)', async () => {
    const client = createMockClient(['proj-a'], {
      'proj-a': [
        { service_name: 'my-kafka', service_type: 'kafka', state: 'RUNNING' },
        { service_name: 'my-pg', service_type: 'pg', state: 'RUNNING' },
        { service_name: 'other-pg', service_type: 'pg', state: 'RUNNING' },
      ],
    });
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ project: 'proj-a', search: 'my-' });
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(2);
    expect(parsed.services.map((s) => s.service_name)).toEqual(['my-kafka', 'my-pg']);
  });

  it('rejects an offset above the maximum without any upstream calls', async () => {
    const client = createMockClient(['proj-a'], { 'proj-a': makeServices('proj-a', 3) });
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ project: 'proj-a', offset: 999999 });
    expect(result.isError).toBe(true);
    expect(parseError(result)).toContain('exceeds the maximum');
    expect(vi.mocked(client.get)).not.toHaveBeenCalled();
  });

  it('bounds the fan-out to at most 25 projects per call', async () => {
    const projects = Array.from({ length: 40 }, (_, idx) => `proj-${idx}`);
    const servicesByProject: Record<string, Array<{ service_name: string; service_type: string; state: string }>> = {};
    for (const p of projects) servicesByProject[p] = makeServices(p, 1);
    const client = createMockClient(projects, servicesByProject);
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ limit: 100 });
    const parsed = parseResponse(result);

    expect(parsed.searched_projects).toBe(25);
    expect(parsed.total_projects).toBe(40);
    const serviceCalls = vi.mocked(client.get).mock.calls.filter((c) => c[0].includes('/service'));
    expect(serviceCalls.length).toBeLessThanOrEqual(25);
    expect(parsed.hint).toContain('15 project(s) were NOT searched');
    expect(parsed.summary).toContain('25 of 40 accessible projects');
  });

  it('accepts an offset exactly at the maximum', async () => {
    const client = createMockClient(['proj-a'], { 'proj-a': makeServices('proj-a', 600) });
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ project: 'proj-a', limit: 50, offset: 500 });
    expect(result.isError).toBeFalsy();
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(50);
    expect(parsed.services[0].service_name).toBe('proj-a-svc-500');
  });

  it('does not emit a next_offset beyond the offset ceiling', async () => {
    const client = createMockClient(['proj-a'], { 'proj-a': makeServices('proj-a', 1000) });
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ project: 'proj-a', limit: 100, offset: 500 });
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(100);
    expect(parsed.next_offset).toBeUndefined();
    expect(parsed.hint).toContain('not reachable by paginating further');
  });

  it('summary states the scope when scanning all projects', async () => {
    const client = createMockClient(['proj-a', 'proj-b'], {
      'proj-a': makeServices('proj-a', 1),
      'proj-b': makeServices('proj-b', 1),
    });
    const [tool] = createServiceSearchTool(client);
    const parsed = parseResponse(await tool.handler({}));
    expect(parsed.summary).toContain('all 2 accessible projects');
    expect(parsed.total_projects).toBe(2);
  });

  it('returns default limit when no limit specified', async () => {
    const client = createMockClient(['proj-a'], {
      'proj-a': makeServices('proj-a', 20),
    });
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ project: 'proj-a' });
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(15);
    expect(parsed.next_offset).toBe(15);
    expect(parsed.hint).toContain('More matching services exist');
  });
});
