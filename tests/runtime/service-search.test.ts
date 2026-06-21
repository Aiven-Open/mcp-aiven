import { describe, it, expect, vi } from 'vitest';
import {
  createServiceSearchTool,
  MAX_LIMIT,
  MAX_PROJECTS_PER_SCAN,
  MAX_PROJECT_CALLS_PER_MIN,
} from '../../src/tools/service-search.js';
import { DEFAULT_LIST_LIMIT } from '../../src/tools/response-filter.js';
import type { AivenClient } from '../../src/client.js';
import type { ToolResult } from '../../src/types.js';

interface ParsedResponse {
  showing: number;
  error?: string;
  summary?: {
    returned: number;
    matched: number;
    by_type: Record<string, number>;
    by_state: Record<string, number>;
    projects_scanned?: number;
    projects_total?: number;
    next_step: string;
  };
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
    expect(parsed.summary).toBeUndefined();
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
    expect(parsed.summary?.matched).toBe(10);
    expect(parsed.summary?.by_type).toEqual({ pg: 10 });
  });

  it('returns all services for a single named project (no cap)', async () => {
    const client = createMockClient(['proj-a'], {
      'proj-a': makeServices('proj-a', 150),
    });
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ project: 'proj-a' });
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(150);
    expect(parsed.services).toHaveLength(150);
    expect(parsed.summary).toBeUndefined();
  });

  it('caps and reports totals when scanning across all projects', async () => {
    const projects = Array.from({ length: 3 }, (_, idx) => `proj-${idx}`);
    const servicesByProject: Record<string, Array<{ service_name: string; service_type: string; state: string }>> = {};
    for (const p of projects) {
      servicesByProject[p] = makeServices(p, 60);
    }
    const client = createMockClient(projects, servicesByProject);
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ limit: 1000 });
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(MAX_LIMIT);
    expect(parsed.summary?.returned).toBe(MAX_LIMIT);
    expect(parsed.summary?.matched).toBeGreaterThan(MAX_LIMIT);
    expect(parsed.summary?.next_step).toContain('narrow');
  });

  it('scans up to MAX_PROJECTS_PER_SCAN projects in one cross-project call', async () => {
    const total = MAX_PROJECTS_PER_SCAN;
    const projects = Array.from({ length: total }, (_, idx) => `proj-${idx}`);
    const servicesByProject: Record<string, Array<{ service_name: string; service_type: string; state: string }>> = {};
    for (const p of projects) {
      servicesByProject[p] = makeServices(p, 1, 'kafka');
    }
    const client = createMockClient(projects, servicesByProject);
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({ service_type: 'pg', limit: 100 });
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(0);
    expect(parsed.summary).toBeUndefined();
    const serviceCalls = vi.mocked(client.get).mock.calls.filter((c) => c[0].includes('/service'));
    expect(serviceCalls.length).toBe(total);
  });

  it('reports an exact matched total when the row cap truncates', async () => {
    const total = MAX_PROJECTS_PER_SCAN;
    const projects = Array.from({ length: total }, (_, idx) => `proj-${idx}`);
    const servicesByProject: Record<string, Array<{ service_name: string; service_type: string; state: string }>> = {};
    for (const p of projects) {
      servicesByProject[p] = makeServices(p, 10);
    }
    const client = createMockClient(projects, servicesByProject);
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({});
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(DEFAULT_LIST_LIMIT);
    expect(parsed.summary?.matched).toBe(total * 10);
    expect(parsed.summary?.next_step).toContain('Do NOT call this tool once per project');
    const serviceCalls = vi.mocked(client.get).mock.calls.filter((c) => c[0].includes('/service'));
    expect(serviceCalls.length).toBe(total);
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

  it('applies the default limit for a cross-project search when no limit specified', async () => {
    const client = createMockClient(['proj-a', 'proj-b'], {
      'proj-a': makeServices('proj-a', 20),
      'proj-b': makeServices('proj-b', 20),
    });
    const [tool] = createServiceSearchTool(client);
    const result = await tool.handler({});
    const parsed = parseResponse(result);
    expect(parsed.showing).toBe(15);
    expect(parsed.summary?.matched).toBe(40);
    expect(parsed.summary?.next_step).toContain('narrow');
  });

  it('Rule 1: a cross-project scan stops at MAX_PROJECTS_PER_SCAN and reports totals', async () => {
    const total = MAX_PROJECTS_PER_SCAN + 30;
    const projects = Array.from({ length: total }, (_, idx) => `proj-${idx}`);
    const servicesByProject: Record<string, Array<{ service_name: string; service_type: string; state: string }>> = {};
    for (const p of projects) servicesByProject[p] = makeServices(p, 1);
    const client = createMockClient(projects, servicesByProject);
    const [tool] = createServiceSearchTool(client);

    const parsed = parseResponse(await tool.handler({}));
    expect(parsed.summary?.projects_scanned).toBe(MAX_PROJECTS_PER_SCAN);
    expect(parsed.summary?.projects_total).toBe(total);
    expect(parsed.summary?.next_step).toContain('Do NOT call this tool once per project');
    const serviceCalls = vi.mocked(client.get).mock.calls.filter((c) => c[0].includes('/service'));
    expect(serviceCalls.length).toBe(MAX_PROJECTS_PER_SCAN);
  });

  it('Rule 2: a single named project returns all its services (full list)', async () => {
    const client = createMockClient(['proj-a'], { 'proj-a': makeServices('proj-a', 150) });
    const [tool] = createServiceSearchTool(client);
    const parsed = parseResponse(await tool.handler({ project: 'proj-a' }));
    expect(parsed.showing).toBe(150);
    expect(parsed.summary).toBeUndefined();
  });

  it('Rule 3: looping single-project calls is cut off after MAX_PROJECT_CALLS_PER_MIN', async () => {
    const client = createMockClient(['proj-a'], { 'proj-a': makeServices('proj-a', 1) });
    const [tool] = createServiceSearchTool(client);

    for (let i = 0; i < MAX_PROJECT_CALLS_PER_MIN; i++) {
      const parsed = parseResponse(await tool.handler({ project: 'proj-a' }, { token: 't1' }));
      expect(parsed.error).toBeUndefined();
    }
    const blocked = parseResponse(await tool.handler({ project: 'proj-a' }, { token: 't1' }));
    expect(blocked.error).toContain('Too many per-project queries');
  });

  it('Rule 3: the per-project limit does not affect cross-project scans', async () => {
    const client = createMockClient(['proj-a', 'proj-b'], {
      'proj-a': makeServices('proj-a', 1),
      'proj-b': makeServices('proj-b', 1),
    });
    const [tool] = createServiceSearchTool(client);
    for (let i = 0; i < MAX_PROJECT_CALLS_PER_MIN + 5; i++) {
      const parsed = parseResponse(await tool.handler({}));
      expect(parsed.error).toBeUndefined();
    }
  });
});
