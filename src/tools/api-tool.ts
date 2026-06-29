import type { AivenClient } from '../client.js';
import type { ToolDefinition, ToolResult, HandlerContext, ApiToolConfig, RequestOptions } from '../types.js';
import { toolSuccess, toolErrorWithRequestId } from '../types.js';
import { errorMessage } from '../errors.js';
import { redactSensitiveData } from '../security.js';
import { wrapUntrustedResponse } from '../untrusted.js';
import { applyResponseFilter, extendSchemaWithSearch, stripSearchParams } from './response-filter.js';

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
  // Extend the schema with search/limit/offset params if the tool has search_fields configured.
  const inputSchema = config.responseFilter?.search_fields?.length
    ? extendSchemaWithSearch(config.inputSchema, config.responseFilter)
    : config.inputSchema;
  const hasSearch = inputSchema !== config.inputSchema;

  return {
    name: config.name,
    category: config.category,
    definition: {
      title: config.title,
      description: config.description,
      inputSchema,
      annotations: config.annotations,
    },
    handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
      try {
        const args = params as Record<string, unknown>;
        const apiArgs = hasSearch ? stripSearchParams(args) : args;
        const search = hasSearch ? args['search'] as string | undefined : undefined;
        const limit = hasSearch ? args['limit'] as number | undefined : undefined;
        const offset = hasSearch ? args['offset'] as number | undefined : undefined;

        const argsWithoutReasoning = Object.fromEntries(
          Object.entries(apiArgs).filter(([key]) => key !== 'reasoning')
        );

        const opts: RequestOptions = {
          token: context?.token,
          mcpClient: context?.mcpClient,
          toolName: config.name,
          requestId: context?.requestId,
          toolReasoning: context?.toolReasoning,
        };

        const data = await executeRequest(client, config, argsWithoutReasoning, pathParams, opts);
        const redacted = redactSensitiveData(data);

        const filtered = config.responseFilter
          ? applyResponseFilter(redacted, config.responseFilter, search, limit, offset)
          : redacted;

        return toolSuccess(wrapUntrustedResponse(filtered), config.name);
      } catch (err) {
        return toolErrorWithRequestId(errorMessage(err), context?.requestId);
      }
    },
  };
}
