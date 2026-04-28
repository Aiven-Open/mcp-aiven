import { describe, it, expect, vi } from 'vitest';
import {
  AI_ORIGIN_TAG_KEY,
  AI_ORIGIN_TAG_VALUE,
  withOriginTag,
} from '../../src/shared/ai-tags.js';
import { loadApiTools } from '../../src/tools/registry.js';
import { createApplicationTools } from '../../src/tools/applications/index.js';
import { ApplicationToolName } from '../../src/types.js';
import type { AivenClient } from '../../src/client.js';
import type { ToolDefinition } from '../../src/types.js';

describe('withAiOriginTag', () => {
  it('adds the origin tag when the body has no tags', () => {
    const body = { service_name: 'svc', plan: 'startup-4' };
    const out = withOriginTag(body);

    expect(out['tags']).toEqual({ [AI_ORIGIN_TAG_KEY]: AI_ORIGIN_TAG_VALUE });
    expect(out['service_name']).toBe('svc');
    expect(out['plan']).toBe('startup-4');
  });

  it('preserves user-supplied tags and merges the origin tag', () => {
    const body = {
      service_name: 'svc',
      tags: { team: 'platform', env: 'prod' },
    };
    const out = withOriginTag(body);

    expect(out['tags']).toEqual({
      team: 'platform',
      env: 'prod',
      [AI_ORIGIN_TAG_KEY]: AI_ORIGIN_TAG_VALUE,
    });
  });

  it('never overwrites a caller-provided origin value', () => {
    const body = {
      tags: { [AI_ORIGIN_TAG_KEY]: 'caller-supplied', team: 'platform' },
    };
    const out = withOriginTag(body);

    expect(out['tags']).toEqual({
      [AI_ORIGIN_TAG_KEY]: 'caller-supplied',
      team: 'platform',
    });
  });
});

interface MockClient {
  client: AivenClient;
  request: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

function createMockClient(): MockClient {
  const request = vi.fn().mockResolvedValue({});
  const post = vi.fn().mockResolvedValue({ service: { service_name: 'app' } });
  const get = vi.fn().mockResolvedValue({});

  const client = {
    request,
    post,
    get,
    put: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  } as unknown as AivenClient;

  return { client, request, post, get };
}

function findTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

describe('aiven_service_create wiring', () => {
  it('injects the origin tag into the POST body', async () => {
    const { client, request, get } = createMockClient();
    // resolveFreePlanCloud only fires for free-* plans, but the helper still
    // calls client.get if it does — return an empty list so it no-ops cleanly.
    get.mockResolvedValue({
      free_plan_cloud_providers: [],
      free_plan_cloud_preferences: [],
    });

    const create = findTool(loadApiTools(client), 'aiven_service_create');

    await create.handler({
      project: 'my-proj',
      service_name: 'my-svc',
      service_type: 'pg',
      plan: 'startup-4',
      cloud: 'aws-eu-west-1',
    });

    expect(request).toHaveBeenCalledTimes(1);
    const call = request.mock.calls[0];
    if (!call) throw new Error('expected request call');
    const body = call[2] as Record<string, unknown>;
    expect(body).toMatchObject({
      service_name: 'my-svc',
      service_type: 'pg',
      tags: { [AI_ORIGIN_TAG_KEY]: AI_ORIGIN_TAG_VALUE },
    });
  });

  it('preserves user-supplied tags and never overrides origin', async () => {
    const { client, request } = createMockClient();

    const create = findTool(loadApiTools(client), 'aiven_service_create');

    await create.handler({
      project: 'my-proj',
      service_name: 'my-svc',
      service_type: 'pg',
      plan: 'startup-4',
      cloud: 'aws-eu-west-1',
      tags: { team: 'platform', [AI_ORIGIN_TAG_KEY]: 'custom' },
    });

    const call = request.mock.calls[0];
    if (!call) throw new Error('expected request call');
    const body = call[2] as Record<string, unknown>;
    expect(body).toMatchObject({
      tags: { team: 'platform', [AI_ORIGIN_TAG_KEY]: 'custom' },
    });
  });
});

describe('aiven_application_deploy wiring', () => {
  it('injects the origin tag into the deploy POST body', async () => {
    const { client, post } = createMockClient();

    const deploy = findTool(createApplicationTools(client), ApplicationToolName.Deploy);

    await deploy.handler({
      project: 'my-proj',
      service_name: 'my-app',
      repository_url: 'https://github.com/me/repo',
      branch: 'main',
      build_path: '.',
      port: 3000,
      port_name: 'default',
      plan: 'startup-50-1024',
      cloud: 'aws-eu-west-1',
      app_env_key: 'API_URL',
    });

    expect(post).toHaveBeenCalledTimes(1);
    const call = post.mock.calls[0];
    if (!call) throw new Error('expected post call');
    const [path, body] = call as [string, Record<string, unknown>];
    expect(path).toBe('/project/my-proj/service');
    expect(body).toMatchObject({
      service_name: 'my-app',
      service_type: 'application',
      tags: { [AI_ORIGIN_TAG_KEY]: AI_ORIGIN_TAG_VALUE },
    });
  });
});
