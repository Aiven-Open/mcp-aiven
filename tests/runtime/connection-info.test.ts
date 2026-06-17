import { describe, it, expect, vi } from 'vitest';
import { createConnectionInfoTool } from '../../src/tools/connection-info.js';
import type { AivenClient } from '../../src/client.js';
import type { ToolResult } from '../../src/types.js';

function parseResponse(result: ToolResult): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text: string }>;
  const text = content[0].text;
  const wrapped = text.match(/<untrusted-aiven-response-[^>]+>\n([\s\S]*?)\n<\/untrusted-aiven-response/);
  const json = wrapped ? wrapped[1] : text;
  return JSON.parse(json) as Record<string, unknown>;
}

function isError(result: ToolResult): boolean {
  return result.isError === true;
}

interface MockServiceOptions {
  state?: string;
  service_type?: string;
  service_uri?: string | null;
  service_uri_params?: Record<string, unknown>;
  users?: unknown[];
  extra?: Record<string, unknown>;
}

function createMockClient(service: MockServiceOptions): { client: AivenClient; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path.endsWith('/kms/ca')) {
      return Promise.resolve({ certificate: '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----' });
    }
    return Promise.resolve({
      service: {
        state: service.state ?? 'RUNNING',
        service_type: service.service_type ?? 'pg',
        service_uri: service.service_uri,
        service_uri_params: service.service_uri_params,
        users: service.users,
        ...service.extra,
      },
    });
  });
  const client = { get, post: get, put: get, delete: get, patch: get, request: get } as unknown as AivenClient;
  return { client, get };
}

describe('aiven_service_connection_info', () => {
  it('requests the service with include_secrets=true', async () => {
    const { client, get } = createMockClient({
      service_uri_params: { host: 'h', port: '5432', user: 'u', password: 'p', dbname: 'defaultdb' },
    });
    const [tool] = createConnectionInfoTool(client);
    await tool.handler({ project: 'proj', service_name: 'pg-1' });

    const serviceCall = get.mock.calls.find(([path]) => String(path).includes('/service/pg-1'));
    expect(serviceCall).toBeDefined();
    expect(serviceCall?.[1]).toMatchObject({ query: { include_secrets: true } });
  });

  it('returns PostgreSQL connection params and CA cert', async () => {
    const { client } = createMockClient({
      service_type: 'pg',
      service_uri: 'postgres://u:p@h:5432/defaultdb',
      service_uri_params: { host: 'h', port: '5432', user: 'u', password: 'p', dbname: 'defaultdb' },
    });
    const [tool] = createConnectionInfoTool(client);
    const parsed = parseResponse(await tool.handler({ project: 'proj', service_name: 'pg-1' }));

    expect(parsed['service_type']).toBe('pg');
    expect(parsed['service_uri']).toBe('postgres://u:p@h:5432/defaultdb');
    expect(parsed['service_uri_params']).toMatchObject({ host: 'h', password: 'p' });
    expect(parsed['ca_cert']).toContain('BEGIN CERTIFICATE');
    expect(parsed['tls']).toEqual({ required: true, verify_with: 'ca_cert' });
  });

  it('returns Kafka mTLS cert and key from the users container', async () => {
    const { client } = createMockClient({
      service_type: 'kafka',
      service_uri: 'kafka-1.aivencloud.com:12345',
      users: [
        {
          username: 'avnadmin',
          access_cert: '-----BEGIN CERTIFICATE-----\nclient\n-----END CERTIFICATE-----',
          access_key: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----',
        },
      ],
    });
    const [tool] = createConnectionInfoTool(client);
    const parsed = parseResponse(await tool.handler({ project: 'proj', service_name: 'kafka-1' }));

    expect(parsed['service_type']).toBe('kafka');
    expect(parsed['service_uri']).toBe('kafka-1.aivencloud.com:12345');
    const users = parsed['users'] as Array<Record<string, string>>;
    expect(users[0]['access_cert']).toContain('BEGIN CERTIFICATE');
    expect(users[0]['access_key']).toContain('BEGIN PRIVATE KEY');
    expect(parsed['ca_cert']).toContain('BEGIN CERTIFICATE');
  });

  it('does not leak unrelated service fields (only allowlisted containers)', async () => {
    const { client } = createMockClient({
      service_uri_params: { host: 'h', port: '5432', user: 'u', password: 'p' },
      extra: {
        backups: [{ backup_name: 'b1' }],
        service_integrations: [{ integration_type: 'x' }],
        node_states: [{ name: 'node-1' }],
        connection_info: { extra: 'x' },
        components: [{ component: 'pg' }],
      },
    });
    const [tool] = createConnectionInfoTool(client);
    const parsed = parseResponse(await tool.handler({ project: 'proj', service_name: 'pg-1' }));

    expect(parsed['backups']).toBeUndefined();
    expect(parsed['service_integrations']).toBeUndefined();
    expect(parsed['node_states']).toBeUndefined();
    expect(parsed['connection_info']).toBeUndefined();
    expect(parsed['components']).toBeUndefined();
  });

  it('trims user objects to connection fields only', async () => {
    const { client } = createMockClient({
      service_type: 'kafka',
      users: [
        {
          username: 'avnadmin',
          password: 'pw',
          access_cert: 'cert',
          access_key: 'key',
          access_control: { redis_acl_keys: ['*'] },
          authentication: 'caching_sha2_password',
          password_updated_time: '2026-01-01T00:00:00Z',
          type: 'primary',
        } as Record<string, unknown>,
      ],
    });
    const [tool] = createConnectionInfoTool(client);
    const parsed = parseResponse(await tool.handler({ project: 'proj', service_name: 'kafka-1' }));

    const user = (parsed['users'] as Array<Record<string, unknown>>)[0];
    expect(Object.keys(user).sort()).toEqual(['access_cert', 'access_key', 'password', 'username']);
    expect(user['access_control']).toBeUndefined();
    expect(user['password_updated_time']).toBeUndefined();
  });

  it('errors when the service is not RUNNING', async () => {
    const { client } = createMockClient({ state: 'REBUILDING' });
    const [tool] = createConnectionInfoTool(client);
    const result = await tool.handler({ project: 'proj', service_name: 'pg-1' });

    expect(isError(result)).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('REBUILDING');
  });
});
