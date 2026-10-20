import type { AivenClient } from '../../client.js';
import type { ToolDefinition } from '../../types.js';

/**
 * Custom OpenSearch tools (non-YAML handlers). Register here when adding
 * OpenSearch-specific MCP tools alongside or instead of manifest entries.
 */
export function createOpenSearchCustomTools(_client: AivenClient): ToolDefinition[] {
  return [];
}
