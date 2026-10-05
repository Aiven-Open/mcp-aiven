import type { ApiToolConfig } from '../types.js';

const SERVICE_GET_TOOL_NAME = 'aiven_service_get';

/**
 * Keys emitted first on `aiven_service_get` so MCP_MAX_TOOL_RESULT_CHARS trimming
 * keeps plan/state/connectivity metadata before large inline arrays.
 */
const SERVICE_CORE_FIRST: readonly string[] = [
  'service_name',
  'service_type',
  'service_type_description',
  'state',
  'plan',
  'plan_price_usd',
  'cloud_name',
  'cloud_description',
  'create_time',
  'update_time',
  'termination_protection',
  'disk_space_mb',
  'node_count',
  'node_cpu_count',
  'node_memory_mb',
  'metadata',
  'features',
  'tags',
  'project_vpc_id',
  'service_integrations',
  'server_group',
  'cmk_id',
  'group_list',
  'is_cluster_plan',
  'service_notifications',
  'tech_emails',
  'connection_info',
  'service_uri',
  'service_uri_params',
  'user_config',
];

/** Large or unbounded arrays/objects moved to the end of the serialized `service` object. */
const SERVICE_BULKY_LAST: readonly string[] = [
  'acl',
  'backups',
  'components',
  'connection_pools',
  'databases',
  'maintenance',
  'node_states',
  'topics',
  'users',
];

const coreFirstSet = new Set(SERVICE_CORE_FIRST);
const bulkyLastSet = new Set(SERVICE_BULKY_LAST);

export function reorderServiceFields(service: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};

  for (const key of SERVICE_CORE_FIRST) {
    if (key in service) ordered[key] = service[key];
  }

  for (const key of Object.keys(service)) {
    if (!coreFirstSet.has(key) && !bulkyLastSet.has(key)) {
      ordered[key] = service[key];
    }
  }

  for (const key of SERVICE_BULKY_LAST) {
    if (key in service) ordered[key] = service[key];
  }

  return ordered;
}

export function shapeServiceGetResponse(data: Record<string, unknown>): Record<string, unknown> {
  const service = data['service'];
  if (service === null || typeof service !== 'object' || Array.isArray(service)) {
    return data;
  }
  return {
    ...data,
    service: reorderServiceFields(service as Record<string, unknown>),
  };
}

export function serviceGetConfigOverrides(
  toolName: string
): Partial<Pick<ApiToolConfig, 'postProcess'>> {
  if (toolName !== SERVICE_GET_TOOL_NAME) return {};
  return { postProcess: shapeServiceGetResponse };
}
