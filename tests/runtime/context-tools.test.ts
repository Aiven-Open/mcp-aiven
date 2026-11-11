import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadApiTools } from '../../src/tools/registry.js';
import { ServiceCategory, type ToolDefinition } from '../../src/types.js';
import type { AivenClient } from '../../src/client.js';

const READ_TOOLS = [
  'aiven_context_search_assets',
  'aiven_context_get_lineage',
];
const WRITE_TOOLS = ['aiven_context_update_tags', 'aiven_context_update_description'];
const ALL_CONTEXT_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS].sort();
const UPSTREAM_TOOL_NAMES: Record<string, string> = {
  aiven_context_search_assets: 'search_assets',
  aiven_context_get_lineage: 'get_lineage',
  aiven_context_update_tags: 'update_tags',
  aiven_context_update_description: 'update_description',
};
const TOOL_RESULT = { content: [{ type: 'text', text: 'ok' }], is_error: false };

function mockClient(data: unknown = TOOL_RESULT): { client: AivenClient; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn().mockResolvedValue(data);
  const client = { get: request, post: request, put: request, delete: request, patch: request, request };
  return { client: client as unknown as AivenClient, request };
}

function contextTools(client: AivenClient = mockClient().client): ToolDefinition[] {
  return loadApiTools(client).filter((tool) => tool.category === ServiceCategory.Context);
}

function contextTool(name: string, client?: AivenClient): ToolDefinition {
  const tool = contextTools(client).find((t) => t.name === name);
  if (!tool) throw new Error(`${name} not loaded`);
  return tool;
}

function parseResult(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const first = result.content[0];
  const text = first?.type === 'text' ? (first.text ?? '') : '';
  const match = text.match(/<untrusted-aiven-response-[^>]+>\n([\s\S]*?)\n<\/untrusted-aiven-response-/);
  return JSON.parse(match?.[1] ?? '');
}

function unwrapOptional(schema: z.ZodTypeAny): z.ZodTypeAny {
  return schema instanceof z.ZodOptional ? unwrapOptional(schema.unwrap() as z.ZodTypeAny) : schema;
}

function rootShape(tool: ToolDefinition): z.ZodRawShape {
  const schema = tool.definition.inputSchema;
  if (!(schema instanceof z.ZodObject)) throw new Error(`${tool.name} root schema is not an object`);
  return (schema as z.AnyZodObject).shape;
}

describe('context manifest', () => {
  it('loads the 4 allowlisted tools in the context category', () => {
    expect(contextTools().map((t) => t.name).sort()).toEqual(ALL_CONTEXT_TOOLS);
  });

  it('marks read and write tools', () => {
    for (const tool of contextTools()) {
      const isWrite = WRITE_TOOLS.includes(tool.name);
      expect(tool.definition.annotations.readOnlyHint, tool.name).toBe(!isWrite);
      expect(tool.definition.annotations.destructiveHint, tool.name).toBe(isWrite);
    }
  });

  it('does not expose the internal confirmation parameter', () => {
    for (const name of WRITE_TOOLS) {
      expect(rootShape(contextTool(name))['confirm'], name).toBeUndefined();
    }
  });

  it('requires organization_id and rejects tool_name and unknown keys', () => {
    for (const tool of contextTools()) {
      const schema = tool.definition.inputSchema;
      const base = tool.name === 'aiven_context_update_description' ? { description: 'x' } : {};
      expect(schema.safeParse({ ...base, organization_id: 'org1' }).success, tool.name).toBe(true);
      expect(schema.safeParse(base).success, tool.name).toBe(false);
      expect(schema.safeParse({ ...base, organization_id: 'org1', tool_name: 'manage_owners' }).success).toBe(false);
      expect(schema.safeParse({ ...base, organization_id: 'org1', reasoning: 'x' }).success).toBe(false);
    }
  });

  it('converts every property to a typed schema, not a record or unknown', () => {
    for (const tool of contextTools()) {
      for (const [name, field] of Object.entries(rootShape(tool))) {
        const inner = unwrapOptional(field);
        expect(inner, `${tool.name}.${name}`).not.toBeInstanceOf(z.ZodRecord);
        expect(inner, `${tool.name}.${name}`).not.toBeInstanceOf(z.ZodUnknown);
        if (inner instanceof z.ZodArray) {
          const element = (inner as z.ZodArray<z.ZodTypeAny>).element;
          expect(element, `${tool.name}.${name}[]`).not.toBeInstanceOf(z.ZodRecord);
          expect(element, `${tool.name}.${name}[]`).not.toBeInstanceOf(z.ZodUnknown);
        }
      }
    }
  });

  it('converts metadata_filters to objects with a string, number or boolean value', () => {
    const shape = rootShape(contextTool('aiven_context_search_assets'));
    const filters = unwrapOptional(shape['metadata_filters'] as z.ZodTypeAny);
    expect(filters).toBeInstanceOf(z.ZodArray);
    const element = (filters as z.ZodArray<z.ZodTypeAny>).element;
    expect(element).toBeInstanceOf(z.ZodObject);
    const value = (element as z.ZodObject<z.ZodRawShape>).shape['value'];
    expect(value).toBeInstanceOf(z.ZodUnion);
    if (!value) throw new Error('metadata_filters[].value missing');
    expect(value.safeParse({ nested: true }).success).toBe(false);
    expect(value.safeParse(null).success).toBe(false);
  });

  it('accepts metadata filters with string, number and boolean values', () => {
    const schema = contextTool('aiven_context_search_assets').definition.inputSchema;

    const parsed = schema.safeParse({
      organization_id: 'org1',
      types: ['topic'],
      metadata_filters: [
        { key: 'partitions', operator: '>', value: 5 },
        { key: 'owner', operator: '=', value: 'payments' },
        { key: 'compacted', operator: '=', value: true },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it('uses urn to identify assets', () => {
    for (const tool of contextTools()) {
      const shape = rootShape(tool);
      expect(shape['urn'], tool.name).toBeDefined();
    }
  });

  it('enforces the schema bounds', () => {
    const lineage = contextTool('aiven_context_get_lineage').definition.inputSchema;
    const discover = contextTool('aiven_context_search_assets').definition.inputSchema;

    expect(lineage.safeParse({ organization_id: 'org1', direction: 'sideways' }).success).toBe(false);
    expect(lineage.safeParse({ organization_id: 'org1', depth: 11 }).success).toBe(false);
    expect(discover.safeParse({ organization_id: 'org1', limit: 101 }).success).toBe(false);
    expect(discover.safeParse({ organization_id: 'org1', offset: -1 }).success).toBe(false);
  });

  it('posts tool_name from the manifest and the nested arguments to the read route', async () => {
    const { client, request } = mockClient();

    await contextTool('aiven_context_search_assets', client).handler({ organization_id: 'org 1', query: 'orders' });

    expect(request).toHaveBeenCalledWith(
      'POST',
      '/organization/org%201/context/tool-calls',
      { arguments: { query: 'orders' }, tool_name: 'search_assets' },
      expect.objectContaining({ toolName: 'aiven_context_search_assets' })
    );
  });

  it('posts the write tools to the write route', async () => {
    const { client, request } = mockClient();

    await contextTool('aiven_context_update_tags', client).handler({ organization_id: 'org1', add_tags: ['pii'] });

    expect(request).toHaveBeenCalledWith(
      'POST',
      '/organization/org1/context/write-tool-calls',
      { arguments: { add_tags: ['pii'] }, tool_name: 'update_tags' },
      expect.objectContaining({ toolName: 'aiven_context_update_tags' })
    );
  });

  it('sends each tool its own upstream tool_name and route', async () => {
    for (const name of ALL_CONTEXT_TOOLS) {
      const { client, request } = mockClient();
      const args = name === 'aiven_context_update_description' ? { description: '' } : {};
      const route = WRITE_TOOLS.includes(name) ? 'write-tool-calls' : 'tool-calls';

      await contextTool(name, client).handler({ organization_id: 'org1', ...args });

      expect(request.mock.calls[0]?.[1], name).toBe(`/organization/org1/context/${route}`);
      expect(request.mock.calls[0]?.[2], name).toEqual({
        arguments: args,
        tool_name: UPSTREAM_TOOL_NAMES[name],
      });
    }
  });

  it('does not infer MCP errors from response payload fields', async () => {
    const payload = { content: [{ type: 'text', text: 'asset not found' }], is_error: true };
    const { client } = mockClient(payload);

    for (const tool of contextTools(client)) {
      const base = tool.name === 'aiven_context_update_description' ? { description: 'x' } : {};
      const result = await tool.handler({ ...base, organization_id: 'org1' });

      expect(result.isError, tool.name).toBeUndefined();
      expect(parseResult(result), tool.name).toEqual(payload);
    }
  });

  it('maps rejected upstream requests to MCP errors', async () => {
    const { client, request } = mockClient();
    request.mockRejectedValue(new Error('asset not found'));

    for (const tool of contextTools(client)) {
      const base = tool.name === 'aiven_context_update_description' ? { description: 'x' } : {};
      const result = await tool.handler({ ...base, organization_id: 'org1' });

      expect(result.isError, tool.name).toBe(true);
      expect(result.content[0], tool.name).toMatchObject({ type: 'text', text: 'asset not found' });
    }
  });

  it('keeps an upstream tool success as an MCP success for every context tool', async () => {
    const { client } = mockClient();

    for (const tool of contextTools(client)) {
      const base = tool.name === 'aiven_context_update_description' ? { description: 'x' } : {};
      const result = await tool.handler({ ...base, organization_id: 'org1' });

      expect(result.isError, tool.name).toBeUndefined();
      expect(parseResult(result), tool.name).toEqual(TOOL_RESULT);
    }
  });

});
