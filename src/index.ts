#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig } from './config.js';
import { AivenClient } from './client.js';
import { loadApiTools } from './tools/registry.js';
import { createKafkaCustomTools } from './tools/kafka/index.js';
import { createPgCustomTools } from './tools/pg/index.js';
import { createApplicationTools } from './tools/applications/index.js';
import { createDocsTools } from './tools/docs/index.js';
import { createServiceSearchTool } from './tools/service-search.js';
import { createStdioTransport, startHttpServer } from './transport.js';
import type { ToolDefinition, McpRequestOptions } from './types.js';
import { VERSION, API_ORIGIN, loadHttpMcpRateLimit, httpTrustProxyEnabled } from './config.js';
import { readOnlyInstructions } from './prompts.js';

/** Streamable HTTP: inbound `/mcp` `User-Agent` (SDK `requestInfo.headers`). */
function mcpClientFromRequestInfo(requestInfo: unknown): string | undefined {
  if (!requestInfo || typeof requestInfo !== 'object' || !('headers' in requestInfo)) {
    return undefined;
  }
  const headersRaw = (requestInfo as { headers: unknown }).headers;
  if (!headersRaw || typeof headersRaw !== 'object') return undefined;
  const h = headersRaw as Record<string, string | undefined>;

  const v = h['user-agent'] ?? h['User-Agent'];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function loadAllTools(client: AivenClient): ToolDefinition[] {
  return [
    ...loadApiTools(client),
    ...createKafkaCustomTools(client),
    ...createPgCustomTools(client),
    ...createApplicationTools(client),
    ...createDocsTools(),
    ...createServiceSearchTool(client),
  ];
}

function registerTools(server: McpServer, tools: readonly ToolDefinition[]): void {
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
        const context = {
          token: extra.authInfo?.token,
          mcpClient: mcpClientFromRequestInfo(extra.requestInfo) ?? server.server.getClientVersion()?.name,
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

  const allTools: readonly ToolDefinition[] = loadAllTools(client);

  function createMcpServer(options: McpRequestOptions): McpServer {
    const tools = options.readOnly
      ? allTools.filter((t) => t.definition.annotations.readOnlyHint)
      : allTools;

    const serverOptions = options.readOnly
      ? ([{ instructions: readOnlyInstructions(transport) }] as const)
      : ([] as const);

    const server = new McpServer({ name: 'mcp-aiven', version: VERSION }, ...serverOptions);
    registerTools(server, tools);
    return server;
  }

  if (transport === 'http') {
    startHttpServer(createMcpServer, {
      port: parseInt(process.env['PORT'] ?? '3000', 10),
      apiOrigin: API_ORIGIN,
      scopes: ['projects', 'services', 'accounts:read'],
      rateLimit: loadHttpMcpRateLimit(),
      trustProxy: httpTrustProxyEnabled(),
      readOnly: config.readOnly,
    });
  } else {
    const server = createMcpServer({ readOnly: config.readOnly });
    await server.connect(createStdioTransport());
    console.error('mcp-aiven: Server connected and ready');
  }
}

main().catch((error: unknown) => {
  console.error('mcp-aiven: Fatal error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
