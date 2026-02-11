import type { AivenClient } from './client.js';
import type { ToolSpec, ToolDefinition, ToolResult } from './types.js';
import { toolSuccess, toolError } from './types.js';
import { formatError } from './errors.js';
import { formatResponse } from './formatters.js';
import { redactSensitiveData } from './security.js';

export function createToolFromSpec(spec: ToolSpec, client: AivenClient): ToolDefinition {
  const pathParamNames = new Set<string>();
  const paramRegex = /\{([^}]+)\}/g;
  let match;
  while ((match = paramRegex.exec(spec.path)) !== null) {
    const paramName = match[1];
    if (paramName) pathParamNames.add(paramName);
  }

  return {
    name: spec.name,
    category: spec.category,
    definition: {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.inputSchema,
      annotations: spec.annotations,
    },
    handler: async (params): Promise<ToolResult> => {
      const typedParams = params as Record<string, unknown>;

      // eslint-disable-next-line security/detect-object-injection
      const url = spec.path.replace(/\{([^}]+)\}/g, (_, key: string) => String(typedParams[key]));

      let result;
      if (spec.method === 'GET') {
        const query: Record<string, string | number | boolean | undefined> = {};
        for (const [key, value] of Object.entries(typedParams)) {
          if (!pathParamNames.has(key) && value !== undefined) {
            // eslint-disable-next-line security/detect-object-injection
            query[key] = value as string | number | boolean;
          }
        }
        result = await client.get<Record<string, unknown>>(
          url,
          Object.keys(query).length > 0 ? { query } : undefined
        );
      } else if (spec.method === 'DELETE') {
        result = await client.delete<Record<string, unknown>>(url);
      } else {
        const body: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(typedParams)) {
          if (!pathParamNames.has(key)) {
            // eslint-disable-next-line security/detect-object-injection
            body[key] = value;
          }
        }

        if (
          spec.path === '/project/{project}/service' ||
          spec.path === '/project/{project}/service/{service_name}'
        ) {
          if (!('project_vpc_id' in body)) {
            body['project_vpc_id'] = null;
          }
        }

        result = await client.request<Record<string, unknown>>(spec.method, url, body);
      }

      if (result.status === 'error') {
        return toolError(formatError(result.error));
      }

      const data = spec.formatter ? formatResponse(spec.formatter, result.data) : result.data;
      return toolSuccess(redactSensitiveData(data));
    },
  };
}
