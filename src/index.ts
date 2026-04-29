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
import { VERSION, API_ORIGIN, loadHttpMcpRateLimit, httpTrustProxyEnabled } from './config.js';
import { READ_ONLY_INSTRUCTIONS } from './prompts.js';
import { createObservabilityContext } from './observability.js';

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
        const paramsObj = params as Record<string, unknown>;
        const reasoning = paramsObj['reasoning'] as string | undefined;
        const obsContext = createObservabilityContext(reasoning);

        const context = {
          token: extra.authInfo?.token,
          mcpClient: mcpClientFromRequestInfo(extra.requestInfo) ?? server.server.getClientVersion()?.name,
          requestId: obsContext.requestId,
          toolReasoning: obsContext.toolReasoning,
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
      rateLimit: loadHttpMcpRateLimit(),
      trustProxy: httpTrustProxyEnabled(),
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
