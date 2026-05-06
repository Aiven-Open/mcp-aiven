import { z } from 'zod';
import type { AivenClient } from '../client.js';
import type { ToolDefinition, ToolResult, HandlerContext } from '../types.js';
import { ServiceCategory, READ_ONLY_ANNOTATIONS, toolSuccess, toolError } from '../types.js';
import { errorMessage } from '../errors.js';
import { wrapUntrustedResponse } from '../untrusted.js';
import { TOOL_LIST_PICKER_SUFFIX } from '../prompts.js';

const CONCURRENCY = 10;
const MAX_RESULTS = 15;

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
  limit: z
    .number()
    .optional()
    .describe(`Max results to return. Defaults to ${MAX_RESULTS}. Set higher only if the user asks for the full list.`),
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
          const { project, service_type, state, limit } = params as z.infer<typeof inputSchema>;
          const opts = { token: context?.token, mcpClient: context?.mcpClient, toolName: 'aiven_service_list' };

          let projectNames: string[];
          if (project) {
            projectNames = [project];
          } else {
            const projectsRes = await client.get<{ projects: ProjectEntry[] }>('/project', opts);
            projectNames = projectsRes.projects.map((p) => p.project_name);
          }

          const maxResults = limit ?? MAX_RESULTS;
          const services: ServiceResult[] = [];
          const errors: ProjectError[] = [];
          const typeFilter = service_type?.toLowerCase();
          const stateFilter = state?.toLowerCase();

          while (projectNames.length > 0 && services.length < maxResults) {
            const batch = projectNames.splice(0, CONCURRENCY);
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
                services.push({ project: entry.proj, service_name: s.service_name, service_type: s.service_type, state: s.state });
              }
            }
          }

          const hasMore = services.length > maxResults || projectNames.length > 0;
          const result = services.slice(0, maxResults);

          return toolSuccess(wrapUntrustedResponse({
            showing: result.length,
            ...(hasMore && { hint: 'More services may exist. Use a higher limit or narrow with filters (project, service_type, state) to see more.' }),
            services: result,
            ...(errors.length > 0 && { errors }),
          }));
        } catch (err) {
          return toolError(errorMessage(err));
        }
      },
    },
  ];
}
