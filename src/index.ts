#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { AivenClient } from './client.js';
import { TOOL_SPECS } from './generated/tools.js';
import { createToolFromSpec } from './factory.js';
import { createPgCustomTools } from './tools/pg/index.js';
import { createKafkaCustomTools } from './tools/kafka/index.js';
import { closeAllPools } from './tools/pg/helpers.js';
import type { AivenConfig, ToolDefinition } from './types.js';
import { ServiceCategory, SERVICE_CATEGORIES, isServiceCategory, isAllServices } from './types.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

function getEnabledCategories(config: AivenConfig): ServiceCategory[] {
  if (isAllServices(config.services)) {
    return [...SERVICE_CATEGORIES];
  }

  const enabled = config.services.filter(isServiceCategory);

  // Always include core if not explicitly disabled
  if (enabled.length > 0 && !enabled.includes(ServiceCategory.Core)) {
    return [ServiceCategory.Core, ...enabled];
  }

  return enabled.length > 0 ? enabled : [...SERVICE_CATEGORIES];
}

function registerTools(server: McpServer, tools: ToolDefinition[]): void {
  for (const tool of tools) {
    const shape = tool.definition.inputSchema;

    server.registerTool(
      tool.name,
      {
        title: tool.definition.title,
        description: tool.definition.description,
        inputSchema: shape,
        annotations: tool.definition.annotations,
      },
      async (params) => {
        const result = await tool.handler(params);
        return result;
      }
    );
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  const client = new AivenClient(config);
  const enabledCategories = getEnabledCategories(config);

  const tools: ToolDefinition[] = TOOL_SPECS.filter((spec) =>
    enabledCategories.includes(spec.category)
  ).map((spec) => createToolFromSpec(spec, client));

  if (enabledCategories.includes(ServiceCategory.Pg)) {
    tools.push(...createPgCustomTools(client));
  }

  if (enabledCategories.includes(ServiceCategory.Kafka)) {
    tools.push(...createKafkaCustomTools(client));
  }

  const categoryCounts: Record<string, number> = {};
  for (const tool of tools) {
    categoryCounts[tool.category] = (categoryCounts[tool.category] ?? 0) + 1;
  }
  console.error(`mcp-aiven: Starting with ${tools.length} tools`);
  console.error(`mcp-aiven: Enabled categories: ${enabledCategories.join(', ')}`);
  console.error(
    `mcp-aiven: Tool counts - ${Object.entries(categoryCounts)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')}`
  );

  const server = new McpServer({
    name: 'mcp-aiven',
    version,
  });

  registerTools(server, tools);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const pgEnabled = enabledCategories.includes(ServiceCategory.Pg);

  async function shutdown(): Promise<void> {
    console.error('mcp-aiven: Shutting down...');
    if (pgEnabled) {
      await closeAllPools();
    }
    await server.close();
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  console.error('mcp-aiven: Server connected and ready');
}

// Run the server
main().catch((error: unknown) => {
  console.error('mcp-aiven: Fatal error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
