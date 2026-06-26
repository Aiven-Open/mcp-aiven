#!/usr/bin/env node
// Must be first import so instrumentation can hook into Express and other modules
import './instrumentation/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig } from './config.js';
import { AivenClient } from './client.js';
import { loadApiTools } from './tools/registry.js';
import { createKafkaCustomTools } from './tools/kafka/index.js';
import { createPgCustomTools } from './tools/pg/index.js';
import { createApplicationTools } from './tools/applications/index.js';
import { createDocsTools } from './tools/docs/index.js';
import { createServiceSearchTool } from './tools/service-search.js';
import { createConnectionInfoTool } from './tools/connection-info.js';
import { createStdioTransport, startHttpServer } from './transport.js';
import type { ToolDefinition, McpRequestOptions } from './types.js';
import { VERSION, API_ORIGIN, loadHttpMcpRateLimit } from './config.js';
import { createObservabilityContext } from './observability.js';
import { readOnlyInstructions, connectionInfoInstructions } from './prompts.js';
import { instrumentServer, flushAndExit } from './instrumentation/index.js';
import { scan } from './security/model-armor.js';
import { unwrapUntrustedResponse } from './untrusted.js';
import { toolError } from './types.js';

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
        const paramsObj = params as Record<string, unknown>;
        const reasoning = paramsObj['reasoning'] as string | undefined;
        const obsContext = createObservabilityContext(reasoning);

        const context = {
          token: extra.authInfo?.token,
          mcpClient: mcpClientFromRequestInfo(extra.requestInfo) ?? server.server.getClientVersion()?.name,
          requestId: obsContext.requestId,
          toolReasoning: obsContext.toolReasoning,
        };

        // Scan tool input for prompt injection / jailbreak before acting on it.
        // Skip `reasoning` (model-generated metadata) and send plain text values,
        // not JSON — structured JSON triggers false positives in the PI filter.
        const inputText = Object.entries(paramsObj)
          .filter(([key]) => key !== 'reasoning')
          .map(([, value]) => String(value))
          .join('\n');
        const inputBlocked = await scan(inputText);
        if (inputBlocked) return toolError(inputBlocked);

        const result = await tool.handler(params, context);

        // Scan tool output so poisoned Aiven data can't inject the user's LLM.
        // Unwrap our own untrusted-data boundary first — its warning text would
        // otherwise trip the prompt-injection filter.
        const outputText = result.content
          .map((c) => (c.type === 'text' ? unwrapUntrustedResponse(c.text) : ''))
          .join('\n');
        const outputBlocked = await scan(outputText, 'output');
        if (outputBlocked) return toolError(outputBlocked);

        return result;
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
    let tools: readonly ToolDefinition[] = allTools;
    if (options.readOnly) {
      tools = tools.filter((t) => t.definition.annotations.readOnlyHint);
    }
    if (options.categories) {
      const allowed = options.categories;
      tools = tools.filter((t) => allowed.has(t.category));
    }

    if (options.allowSecrets) {
      tools = [...tools, ...createConnectionInfoTool(client, options.readOnly)];
    }

    const instructions: string[] = [];
    if (options.readOnly) instructions.push(readOnlyInstructions(transport));
    instructions.push(connectionInfoInstructions(options.allowSecrets, options.readOnly, transport));

    const serverOptions =
      instructions.length > 0 ? ([{ instructions: instructions.join(' ') }] as const) : ([] as const);

    const server = new McpServer({ name: 'mcp-aiven', version: VERSION }, ...serverOptions);
    registerTools(server, tools);
    return server;
  }

  if (transport === 'http') {
    const createInstrumentedServer = (options: McpRequestOptions): McpServer => {
      return instrumentServer(createMcpServer(options));
    };
    startHttpServer(createInstrumentedServer, {
      port: parseInt(process.env['PORT'] ?? '3000', 10),
      apiOrigin: API_ORIGIN,
      scopes: ['projects', 'services', 'accounts:read'],
      rateLimit: loadHttpMcpRateLimit(),
      readOnly: config.readOnly,
    });
  } else {
    const server = instrumentServer(
      createMcpServer({
        readOnly: config.readOnly,
        categories: config.categories,
        allowSecrets: config.allowSecrets,
      })
    );
    await server.connect(createStdioTransport());
    console.error('mcp-aiven: Server connected and ready');
  }
}

main().catch(async (error: unknown) => {
  console.error('mcp-aiven: Fatal error:', error instanceof Error ? error.message : error);
  await flushAndExit(error);
});
