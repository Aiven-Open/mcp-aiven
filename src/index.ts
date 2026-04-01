#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig } from './config.js';
import { AivenClient } from './client.js';
import { loadApiTools } from './tools/registry.js';
import { createKafkaCustomTools } from './tools/kafka/index.js';
import { createPgCustomTools } from './tools/pg/index.js';
import { createApplicationTools } from './tools/applications/index.js';
import { createStdioTransport, startHttpServer } from './transport.js';
import type { ToolDefinition } from './types.js';
import { VERSION, API_ORIGIN } from './config.js';
import { READ_ONLY_INSTRUCTIONS } from './prompts.js';
import { httpToolContext } from './http-tool-context.js';

function loadTools(client: AivenClient, readOnly: boolean): ToolDefinition[] {
  let tools: ToolDefinition[] = [
    ...loadApiTools(client),
    ...createKafkaCustomTools(client),
    ...createPgCustomTools(client),
    ...createApplicationTools(client),
  ];

  if (readOnly) {
    tools = tools.filter((t) => t.definition.annotations.readOnlyHint);
  }

  return tools;
}

function registerTools(server: McpServer, tools: ToolDefinition[]): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.definition.title,
        description: tool.definition.description,
        inputSchema: tool.definition.inputSchema,
        annotations: tool.definition.annotations,
        ...(tool.definition.outputSchema ? { outputSchema: tool.definition.outputSchema } : {}),
      },
      async (params, extra) => {
        const fromHttp = httpToolContext.getStore()?.mcpClientName;
        const context = {
          token: extra.authInfo?.token,
          mcpClient: fromHttp ?? server.server.getClientVersion()?.name,
        };
        return tool.handler(params, context);
      }
    );
  }
}

async function main(): Promise<void> {
  const transport = process.env['MCP_TRANSPORT'] === 'http' ? 'http' : 'stdio';
  const config = loadConfig(transport);
  const client = new AivenClient(config);
  const tools = loadTools(client, config.readOnly);

  const serverOptions = config.readOnly
    ? ([{ instructions: READ_ONLY_INSTRUCTIONS }] as const)
    : ([] as const);

  function createMcpServer(): McpServer {
    const server = new McpServer({ name: 'mcp-aiven', version: VERSION }, ...serverOptions);
    registerTools(server, tools);
    return server;
  }

  if (transport === 'http') {
    startHttpServer(createMcpServer, {
      port: parseInt(process.env['PORT'] ?? '3000', 10),
      apiOrigin: API_ORIGIN,
      scopes: ['projects', 'services', 'accounts:read'],
    });
  } else {
    const server = createMcpServer();
    await server.connect(createStdioTransport());
    console.error('mcp-aiven: Server connected and ready');
  }
}

main().catch((error: unknown) => {
  console.error('mcp-aiven: Fatal error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
