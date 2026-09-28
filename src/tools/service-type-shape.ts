import type { ApiToolConfig } from '../types.js';

/**
 * Response shaping for `aiven_service_type_get`.
 *
 * `GET /project/{project}/service-types/{service_type}` returns the engine's entire
 * `user_config_schema` alongside the two fields we actually want. For `pg` that schema is
 * ~100KB — past the tool-result size cap, so returning it whole would truncate the payload
 * and lose the version fields we called the endpoint for.
 *
 * The selectable majors live inside that schema, at
 * `user_config_schema.properties.{service_type}_version.enum`, while the default lives on the
 * sibling field `default_version`. Note those are deliberately distinct: `default_version` is
 * a major (`"18"`) and `latest_available_version` is a full version (`"18.6"`), and Aiven does
 * not guarantee the default is the newest major. So this lifts the enum out, keeps both
 * version fields verbatim, and drops the schema.
 *
 * Keyed off `{service_type}_version` rather than a per-engine table, so it covers pg, kafka,
 * opensearch, clickhouse, valkey, mysql, flink and grafana with no engine-specific branches.
 */

const SERVICE_TYPE_GET_TOOL_NAME = 'aiven_service_type_get';

/**
 * Config overrides that wire the service-type shaping into the one tool that needs it.
 * Returns an empty object for every other tool, so the registry can spread it unconditionally.
 */
export function serviceTypeConfigOverrides(
  toolName: string
): Partial<Pick<ApiToolConfig, 'postProcess'>> {
  if (toolName !== SERVICE_TYPE_GET_TOOL_NAME) return {};
  return { postProcess: shapeServiceTypeResponse };
}

interface VersionSchema {
  enum?: unknown;
}

interface UserConfigSchema {
  properties?: Record<string, VersionSchema | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The API sends versions as strings, or null for unversioned service types. */
function asVersionString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Sort major versions numerically, oldest first. `localeCompare` with `numeric` keeps
 * `9.1` below `10.0` and orders `1.19` before `1.20`, which a plain string sort gets wrong.
 */
function sortVersions(versions: string[]): string[] {
  return [...versions].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Lift `user_config_schema.properties.{serviceType}_version.enum` out of the full schema. */
function extractAvailableVersions(
  userConfigSchema: unknown,
  versionConfigKey: string
): string[] {
  if (!isRecord(userConfigSchema)) return [];
  const properties = (userConfigSchema as UserConfigSchema).properties;
  if (!isRecord(properties)) return [];
  const versionProperty = properties[versionConfigKey];
  if (!isRecord(versionProperty)) return [];
  const values = (versionProperty as VersionSchema).enum;
  if (!Array.isArray(values)) return [];
  // The enum can carry `null` (e.g. karapace_version) — a non-version the caller cannot pass.
  return sortVersions(values.filter((v): v is string => typeof v === 'string' && v !== ''));
}

/**
 * Reduce the service-type response to the version fields, dropping `user_config_schema`.
 * Returns the input unchanged when it is not a service-type payload, so it is safe on
 * error responses.
 */
export function shapeServiceTypeResponse(
  data: Record<string, unknown>,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (!('user_config_schema' in data) && !('default_version' in data)) return data;

  const serviceType = typeof args['service_type'] === 'string' ? args['service_type'] : '';
  const versionConfigKey = serviceType ? `${serviceType}_version` : '';
  const availableVersions = versionConfigKey
    ? extractAvailableVersions(data['user_config_schema'], versionConfigKey)
    : [];

  const defaultVersion = asVersionString(data['default_version']);

  return {
    ...(serviceType && { service_type: serviceType }),
    default_version: defaultVersion,
    available_versions: availableVersions,
    latest_available_version: asVersionString(data['latest_available_version']),
    ...(versionConfigKey && { version_config_key: versionConfigKey }),
    ...(typeof data['description'] === 'string' && { description: data['description'] }),
    note:
      availableVersions.length === 0
        ? 'This service type is not versioned through user_config. Omit the version key when creating.'
        : `Tell the user which version they will get. Omit \`${versionConfigKey}\` from user_config to accept default_version (${defaultVersion ?? 'the platform default'}); set it only if the user asks for a specific major.`,
  };
}
