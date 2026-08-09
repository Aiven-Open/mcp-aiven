import { describe, it, expect } from 'vitest';
import { summarizeCatalog } from '../../src/tool-catalog.js';
import { ServiceCategory, READ_ONLY_ANNOTATIONS, toolSuccess } from '../../src/types.js';
import type { ToolDefinition, ToolResult } from '../../src/types.js';
import { z } from 'zod';

function tool(name: string): ToolDefinition {
  return {
    name,
    category: ServiceCategory.Core,
    definition: {
      title: name,
      description: name,
      inputSchema: z.object({}),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handler: (): Promise<ToolResult> => Promise.resolve(toolSuccess('ok', name)),
  };
}

describe('summarizeCatalog', () => {
  it('counts the tools', () => {
    expect(summarizeCatalog([tool('b'), tool('a')]).count).toBe(2);
  });

  it('sorts names so registration order does not matter', () => {
    expect(summarizeCatalog([tool('b'), tool('a')]).names).toEqual(['a', 'b']);
    expect(summarizeCatalog([tool('b'), tool('a')]).fingerprint).toBe(
      summarizeCatalog([tool('a'), tool('b')]).fingerprint
    );
  });

  it('changes the fingerprint when a tool is missing', () => {
    // The regression this exists for: a container that starts without AIVEN_DOCS_*
    // serves one tool fewer, with no other observable difference.
    const withDocs = [tool('aiven_project_list'), tool('aiven_docs_search')];
    const withoutDocs = [tool('aiven_project_list')];

    expect(summarizeCatalog(withDocs).fingerprint).not.toBe(
      summarizeCatalog(withoutDocs).fingerprint
    );
    expect(summarizeCatalog(withDocs).count - summarizeCatalog(withoutDocs).count).toBe(1);
  });

  it('is stable across calls', () => {
    const tools = [tool('a'), tool('b'), tool('c')];
    expect(summarizeCatalog(tools).fingerprint).toBe(summarizeCatalog(tools).fingerprint);
  });

  it('produces a short hex fingerprint', () => {
    expect(summarizeCatalog([tool('a')]).fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles an empty catalog', () => {
    const empty = summarizeCatalog([]);
    expect(empty.count).toBe(0);
    expect(empty.names).toEqual([]);
    expect(empty.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });
});
