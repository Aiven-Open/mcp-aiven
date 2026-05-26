import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AivenClient } from '../../src/client.js';
import type { ToolDefinition } from '../../src/types.js';
import { formatPgEditorQueryResult } from '../../src/tools/pg/query.js';

function firstTextContent(
  content: Array<{ type: string; text?: string }> | undefined
): string | undefined {
  const c = content?.[0];
  return c?.type === 'text' ? c.text : undefined;
}

function parseResultPayload(text: string): unknown {
  const match = text.match(
    /<untrusted-aiven-response-[^>]+>\n([\s\S]*?)\n<\/untrusted-aiven-response-/
  );
  if (!match) throw new Error('Could not find untrusted-aiven-response boundary in output');
  return JSON.parse(match[1] ?? '');
}

const DEFAULT_PG_PARAMS = {
  database: 'defaultdb',
  schema: 'public',
  reasoning: 'test',
};

function createMockClient(opts: {
  postResponse?: unknown;
  getResponse?: unknown;
  getImpl?: (url: string) => Promise<unknown>;
}): AivenClient {
  const postMock = vi.fn().mockResolvedValue(opts.postResponse ?? { results: [], row_count: 0 });
  const getMock =
    opts.getImpl ??
    vi.fn().mockImplementation((url: string) => {
      if (url.includes('/pg-editor/schemas')) {
        return Promise.resolve({ schemas: ['public', 'app'] });
      }
      return Promise.resolve(
        opts.getResponse ?? {
          service: { databases: [{ database_name: 'defaultdb' }, { database_name: 'analytics' }] },
        }
      );
    });
  return {
    get: getMock,
    post: postMock,
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    request: vi.fn(),
  } as unknown as AivenClient;
}

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} tool not found`);
  return tool;
}

describe('formatPgEditorQueryResult', () => {
  it('paginates rows and builds metadata', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const { meta, rows: paged } = formatPgEditorQueryResult(
      { rows, row_count: 50, fields: ['id'] },
      { limit: 10, offset: 20, mode: 'read-only' as never }
    );
    expect(meta.returnedRows).toBe(10);
    expect(meta.offset).toBe(20);
    expect(meta.hasMore).toBe(true);
    expect(paged[0]).toEqual({ id: 20 });
  });
});

describe('aiven_pg_list_databases', () => {
  let createPgCustomTools: (client: AivenClient) => ToolDefinition[];

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/tools/pg/index.js');
    createPgCustomTools = mod.createPgCustomTools;
  });

  it('returns database names from service get', async () => {
    const client = createMockClient({});
    const tools = createPgCustomTools(client);
    const tool = getTool(tools, 'aiven_pg_list_databases');

    const result = await tool.handler({
      project: 'proj',
      service_name: 'svc',
      reasoning: 'test',
    });

    expect(result.isError).toBeUndefined();
    const payload = parseResultPayload(firstTextContent(result.content) ?? '') as { databases: string[] };
    expect(payload.databases).toEqual(['defaultdb', 'analytics']);
    expect(client.get).toHaveBeenCalledWith(
      '/project/proj/service/svc',
      expect.objectContaining({ toolName: 'aiven_pg_list_databases' })
    );
  });
});

describe('aiven_pg_list_schemas', () => {
  let createPgCustomTools: (client: AivenClient) => ToolDefinition[];

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/tools/pg/index.js');
    createPgCustomTools = mod.createPgCustomTools;
  });

  it('returns schema names for a database', async () => {
    const client = createMockClient({});
    const tools = createPgCustomTools(client);
    const tool = getTool(tools, 'aiven_pg_list_schemas');

    const result = await tool.handler({
      project: 'proj',
      service_name: 'svc',
      database: 'defaultdb',
      reasoning: 'test',
    });

    expect(result.isError).toBeUndefined();
    const payload = parseResultPayload(firstTextContent(result.content) ?? '') as { schemas: string[] };
    expect(payload.schemas).toEqual(['public', 'app']);
    expect(client.get).toHaveBeenCalledWith(
      '/project/proj/service/svc/pg-editor/schemas',
      expect.objectContaining({
        toolName: 'aiven_pg_list_schemas',
        query: { database: 'defaultdb' },
      })
    );
  });
});

describe('aiven_pg_read', () => {
  let createPgCustomTools: (client: AivenClient) => ToolDefinition[];

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/tools/pg/index.js');
    createPgCustomTools = mod.createPgCustomTools;
  });

  it('should have correct tool metadata', () => {
    const client = createMockClient({});
    const tools = createPgCustomTools(client);
    const tool = getTool(tools, 'aiven_pg_read');

    expect(tool.definition.annotations.readOnlyHint).toBe(true);
    expect(tool.definition.description).toContain('pg-editor/run-query');
  });

  it('should reject multiple statements without calling API', async () => {
    const client = createMockClient({});
    const tools = createPgCustomTools(client);
    const tool = getTool(tools, 'aiven_pg_read');

    const result = await tool.handler({
      project: 'proj',
      service_name: 'svc',
      query: 'SELECT 1; DROP TABLE users',
      ...DEFAULT_PG_PARAMS,
    });

    expect(result.isError).toBe(true);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('should POST query, database, schema_name, and expect_readonly to pg-editor/run-query', async () => {
    const postResponse = {
      results: [{ id: 1, name: 'test' }],
      row_count: 1,
    };
    const client = createMockClient({ postResponse });
    const tools = createPgCustomTools(client);
    const tool = getTool(tools, 'aiven_pg_read');

    const result = await tool.handler(
      {
        project: 'my project',
        service_name: 'my/service',
        query: 'SELECT id, name FROM users',
        database: 'defaultdb',
        schema: 'public',
        reasoning: 'test',
      },
      { token: 'tok', clientIp: '203.0.113.7' }
    );

    expect(result.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith(
      '/project/my%20project/service/my%2Fservice/pg-editor/run-query',
      {
        query: 'SELECT id, name FROM users',
        database: 'defaultdb',
        schema_name: 'public',
        expect_readonly: true,
      },
      expect.objectContaining({
        toolName: 'aiven_pg_read',
        clientIp: '203.0.113.7',
        token: 'tok',
        mcpAcornAuth: true,
      })
    );

    const parsed = parseResultPayload(firstTextContent(result.content) ?? '') as {
      meta: { rowCount: number; fields: string[] };
      rows: Array<{ id: number; name: string }>;
    };
    expect(parsed.meta.rowCount).toBe(1);
    expect(parsed.rows).toEqual([{ id: 1, name: 'test' }]);
  });

  it('should reject non-SELECT queries at AST level', async () => {
    const client = createMockClient({});
    const tools = createPgCustomTools(client);
    const tool = getTool(tools, 'aiven_pg_read');

    const result = await tool.handler({
      project: 'proj',
      service_name: 'svc',
      query: 'DELETE FROM users',
      ...DEFAULT_PG_PARAMS,
    });

    expect(result.isError).toBe(true);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('should reject queries when rate limit is exceeded', async () => {
    const client = createMockClient({});
    const tools = createPgCustomTools(client);
    const tool = getTool(tools, 'aiven_pg_read');

    const params = {
      project: 'proj',
      service_name: 'svc',
      query: 'SELECT 1',
      ...DEFAULT_PG_PARAMS,
    };

    for (let i = 0; i < 100; i++) {
      await tool.handler(params, { token: 'same-token' });
    }

    const blocked = await tool.handler(params, { token: 'same-token' });
    expect(blocked.isError).toBe(true);
    expect(firstTextContent(blocked.content)).toContain('Rate limit exceeded');
    expect(client.post).toHaveBeenCalledTimes(100);
  });
});

describe('validateReadQuery', () => {
  let validateReadQuery: (query: string) => Promise<{ valid: boolean; error?: string; stmtType?: string }>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/tools/pg/validation.js');
    validateReadQuery = mod.validateReadQuery;
  });

  it('should allow SELECT', async () => {
    const r = await validateReadQuery('SELECT * FROM users');
    expect(r.valid).toBe(true);
    expect(r.stmtType).toBe('SelectStmt');
  });

  it('should reject INSERT', async () => {
    const r = await validateReadQuery("INSERT INTO users (name) VALUES ('Alice')");
    expect(r.valid).toBe(false);
  });
});

describe('validateWriteQuery', () => {
  let validateWriteQuery: (query: string) => Promise<{ valid: boolean; error?: string; stmtType?: string }>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/tools/pg/validation.js');
    validateWriteQuery = mod.validateWriteQuery;
  });

  it('should reject DROP TABLE', async () => {
    const r = await validateWriteQuery('DROP TABLE users');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('DropStmt');
  });

  it('should allow INSERT', async () => {
    const r = await validateWriteQuery("INSERT INTO users (name) VALUES ('Alice')");
    expect(r.valid).toBe(true);
  });
});

describe('aiven_pg_write', () => {
  let createPgCustomTools: (client: AivenClient) => ToolDefinition[];

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/tools/pg/index.js');
    createPgCustomTools = mod.createPgCustomTools;
  });

  it('should POST write queries to pg-editor/run-query', async () => {
    const client = createMockClient({
      postResponse: { results: [], row_count: 3, command: 'INSERT' },
    });
    const tools = createPgCustomTools(client);
    const tool = getTool(tools, 'aiven_pg_write');

    const result = await tool.handler({
      project: 'proj',
      service_name: 'svc',
      query: "INSERT INTO users (name) VALUES ('Alice')",
      ...DEFAULT_PG_PARAMS,
    });

    expect(result.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith(
      '/project/proj/service/svc/pg-editor/run-query',
      expect.objectContaining({
        database: 'defaultdb',
        schema_name: 'public',
        expect_readonly: false,
      }),
      expect.objectContaining({ toolName: 'aiven_pg_write', mcpAcornAuth: true })
    );

    const parsed = parseResultPayload(firstTextContent(result.content) ?? '') as {
      meta: { rowCount: number; command: string };
    };
    expect(parsed.meta.rowCount).toBe(3);
    expect(parsed.meta.command).toBe('INSERT');
  });

  it('should reject DROP TABLE before API call', async () => {
    const client = createMockClient({});
    const tools = createPgCustomTools(client);
    const tool = getTool(tools, 'aiven_pg_write');

    const result = await tool.handler({
      project: 'proj',
      service_name: 'svc',
      query: 'DROP TABLE users',
      ...DEFAULT_PG_PARAMS,
    });

    expect(result.isError).toBe(true);
    expect(client.post).not.toHaveBeenCalled();
  });
});
