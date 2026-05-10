import { z } from 'zod';
import type { AivenClient } from '../client.js';
import type { ToolDefinition, ToolResult, HandlerContext } from '../types.js';
import { ServiceCategory, READ_ONLY_ANNOTATIONS, toolSuccess, toolError } from '../types.js';
import { errorMessage } from '../errors.js';
import { wrapUntrustedResponse } from '../untrusted.js';
import { TOOL_LIST_PICKER_SUFFIX } from '../prompts.js';

import { DEFAULT_LIST_LIMIT } from './response-filter.js';

const CONCURRENCY = 10;

const inputSchema = z.object({
  project: z
    .string()
    .optional()
    .describe('Scope to a single project. If omitted, searches across all projects.'),
  service_type: z
    .string()
    .optional()
    .describe('Filter by service type (e.g. "pg", "kafka", "opensearch", "mysql", "redis")'),
  state: z
    .string()
    .optional()
    .describe('Filter by service state (e.g. "RUNNING", "POWERED_OFF", "REBUILDING")'),
  search: z
    .string()
    .optional()
    .describe('Case-insensitive substring filter on service_name.'),
  limit: z
    .number()
    .optional()
    .describe(`Max results to return. Defaults to ${DEFAULT_LIST_LIMIT}. Do NOT set this unless the user explicitly asked for a specific number of results.`),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Number of items to skip for pagination. Use the value from `next_offset` in a previous response.'),
});

interface ServiceEntry {
  service_name: string;
  service_type: string;
  state: string;
}

interface ProjectEntry {
  project_name: string;
}

const DESCRIPTION = `Search for Aiven services. Optionally scope to a single project or search across all projects.

Returns a filtered list of services matching the criteria. All filters are optional — omit them to get all services.

This tool returns a list of services with the following fields:
- project: The project the service belongs to
- service_name: The name of the service
- service_type: The type of the service
- state: The current state of the service (e.g. RUNNING, POWERED_OFF)

Use \`aiven_service_get\` to get full details for a specific service.

${TOOL_LIST_PICKER_SUFFIX}`;

interface ServiceResult {
  project: string;
  service_name: string;
  service_type: string;
  state: string;
}

interface ProjectError {
  project: string;
  error: string;
}

export function createServiceSearchTool(client: AivenClient): ToolDefinition[] {
  return [
    {
      name: 'aiven_service_list',
      category: ServiceCategory.Core,
      definition: {
        title: 'Search Services Across Projects',
        description: DESCRIPTION,
        inputSchema,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        try {
          const { project, service_type, state, search, limit, offset } = params as z.infer<typeof inputSchema>;
          const opts = { token: context?.token, mcpClient: context?.mcpClient, toolName: 'aiven_service_list' };

          let projectNames: string[];
          if (project) {
            projectNames = [project];
          } else {
            const projectsRes = await client.get<{ projects: ProjectEntry[] }>('/project', opts);
            projectNames = projectsRes.projects.map((p) => p.project_name);
          }

          const cap = Math.min(limit ?? DEFAULT_LIST_LIMIT, 100);
          const pageStart = offset ?? 0;
          const services: ServiceResult[] = [];
          const errors: ProjectError[] = [];
          const typeFilter = service_type?.toLowerCase();
          const stateFilter = state?.toLowerCase();
          const searchNeedle = search?.toLowerCase();

          const needed = pageStart + cap;
          const projectQueue = [...projectNames];
          while (projectQueue.length > 0 && services.length < needed) {
            const batch = projectQueue.splice(0, CONCURRENCY);
            const batchResults = await Promise.all(batch.map(async (proj) => {
              try {
                const res = await client.get<{ services: ServiceEntry[] }>(`/project/${encodeURIComponent(proj)}/service`, opts);
                return { proj, services: res.services };
              } catch (err) {
                return { proj, error: errorMessage(err) };
              }
            }));

            for (const entry of batchResults) {
              if ('error' in entry) {
                errors.push({ project: entry.proj, error: entry.error });
                continue;
              }
              for (const s of entry.services) {
                if (typeFilter && s.service_type.toLowerCase() !== typeFilter) continue;
                if (stateFilter && s.state.toLowerCase() !== stateFilter) continue;
                if (searchNeedle && !s.service_name.toLowerCase().includes(searchNeedle)) continue;
                services.push({ project: entry.proj, service_name: s.service_name, service_type: s.service_type, state: s.state });
              }
            }
          }

          const page = services.slice(pageStart, pageStart + cap);
          const hasMore = pageStart + page.length < services.length || projectQueue.length > 0;
          const nextOffset = hasMore ? pageStart + page.length : undefined;

          return toolSuccess(wrapUntrustedResponse({
            showing: page.length,
            ...(offset !== undefined && offset > 0 && { offset }),
            ...(nextOffset !== undefined && { next_offset: nextOffset }),
            services: page,
            ...(errors.length > 0 && { errors }),
            ...(hasMore && { hint: 'More services exist. Ask the user what they are looking for, or narrow with filters (project, service_type, state, search). Do NOT increase the limit or auto-paginate.' }),
          }));
        } catch (err) {
          return toolError(errorMessage(err));
        }
      },
    },
  ];
}
