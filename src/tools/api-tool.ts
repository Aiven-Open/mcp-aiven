import type { AivenClient } from '../client.js';
import type { ToolDefinition, ToolResult, HandlerContext, ApiToolConfig, RequestOptions } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { errorMessage } from '../errors.js';
import { redactSensitiveData } from '../security.js';
import { applyResponseFilter } from './response-filter.js';

function extractPathParams(path: string): Set<string> {
  return new Set(
    [...path.matchAll(/\{([^}]+)\}/g)]
      .map((m) => m[1])
      .filter((s): s is string => s !== undefined)
  );
}

function buildUrl(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) =>
    encodeURIComponent(String(args[key]))
  );
}

function collectNonPathParams(
  args: Record<string, unknown>,
  pathParams: Set<string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (!pathParams.has(k)) result[k] = v;
  }
  return result;
}

function buildQueryOpts(
  args: Record<string, unknown>,
  pathParams: Set<string>,
  opts: RequestOptions | undefined
): RequestOptions | undefined {
  const query: Record<string, string | number | boolean | undefined> = {};
  for (const [k, v] of Object.entries(args)) {
    if (!pathParams.has(k) && v !== undefined) {
      query[k] = v as string | number | boolean;
    }
  }
  if (Object.keys(query).length === 0) return opts;
  return { ...opts, query };
}

async function executeRequest(
  client: AivenClient,
  config: ApiToolConfig,
  args: Record<string, unknown>,
  pathParams: Set<string>,
  opts: RequestOptions | undefined
): Promise<Record<string, unknown>> {
  const url = buildUrl(config.path, args);

  if (config.method === 'GET') {
    return client.get(url, buildQueryOpts(args, pathParams, opts));
  }

  if (config.method === 'DELETE') {
    return client.delete(url, opts);
  }

  const body = collectNonPathParams(args, pathParams);
  if (config.defaults) {
    for (const [k, v] of Object.entries(config.defaults)) {
      if (!(k in body)) body[k] = v;
    }
  }
  return client.request(config.method, url, body, opts);
}

export function createApiTool(config: ApiToolConfig, client: AivenClient): ToolDefinition {
  const pathParams = extractPathParams(config.path);

  return {
    name: config.name,
    category: config.category,
    definition: {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
      annotations: config.annotations,
    },
    handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
      try {
        const args = params as Record<string, unknown>;
        const opts: RequestOptions = {
          token: context?.token,
          mcpClient: context?.mcpClient,
          toolName: config.name,
        };

        const data = await executeRequest(client, config, args, pathParams, opts);

        const filtered = config.responseFilter
          ? applyResponseFilter(data, config.responseFilter)
          : data;

        return toolSuccess(redactSensitiveData(filtered));
      } catch (err) {
        return toolError(errorMessage(err));
      }
    },
  };
}
