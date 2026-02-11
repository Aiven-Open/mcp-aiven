/**
 * Kafka Connect and service integration helpers
 */

import type { AivenClient } from '../../client.js';
import type { ToolResult } from '../../types.js';
import { toolError } from '../../types.js';
import { formatError } from '../../errors.js';

export interface ServiceConnectionInfo {
  host: string;
  port: number;
  user: string;
  password: string;
  dbname: string;
}

const ROUTING_KEYS = new Set(['project', 'service_name', 'connector_name', 'source_service']);

const CONNECTOR_DB_FIELD_MAP: Record<string, Record<string, string>> = {
  postgres: {
    'database.hostname': 'host',
    'database.port': 'port',
    'database.user': 'user',
    'database.password': 'password',
    'database.dbname': 'dbname',
  },
  mysql: {
    'database.hostname': 'host',
    'database.port': 'port',
    'database.user': 'user',
    'database.password': 'password',
  },
  'jdbc-sink': {
    'connection.url': '_jdbc_url',
    'connection.user': 'user',
    'connection.password': 'password',
  },
  'jdbc-source': {
    'connection.url': '_jdbc_url',
    'connection.user': 'user',
    'connection.password': 'password',
  },
};

export type ConnectorConfigResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; error: ToolResult };

/**
 * Fetch connection info for an Aiven service (e.g. PostgreSQL for Kafka Connect).
 * Returns ServiceConnectionInfo or an error message string.
 */
export async function getServiceConnectionInfo(
  client: AivenClient,
  project: string,
  serviceName: string
): Promise<ServiceConnectionInfo | string> {
  const result = await client.get<Record<string, unknown>>(
    `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}`
  );

  if (result.status === 'error') {
    return `Failed to fetch service ${serviceName}: ${formatError(result.error)}`;
  }

  const service = result.data['service'] as Record<string, unknown> | undefined;
  if (!service) {
    return `Service ${serviceName} not found in response`;
  }

  const params = service['service_uri_params'] as Record<string, unknown> | undefined;
  if (params) {
    return {
      host: typeof params['host'] === 'string' ? params['host'] : '',
      port: typeof params['port'] === 'number' ? params['port'] : Number(params['port'] ?? 0),
      user: typeof params['user'] === 'string' ? params['user'] : '',
      password: typeof params['password'] === 'string' ? params['password'] : '',
      dbname: typeof params['dbname'] === 'string' ? params['dbname'] : 'defaultdb',
    };
  }

  return `No connection info available for service ${serviceName}`;
}

function buildJdbcUrl(info: ServiceConnectionInfo): string {
  return `jdbc:postgresql://${info.host}:${info.port}/${info.dbname}?sslmode=require`;
}

function detectFieldMapping(connectorClass: string): Record<string, string> | undefined {
  const lower = connectorClass.toLowerCase();
  if (lower.includes('jdbc') && lower.includes('sink')) return CONNECTOR_DB_FIELD_MAP['jdbc-sink'];
  if (lower.includes('jdbc') && lower.includes('source'))
    return CONNECTOR_DB_FIELD_MAP['jdbc-source'];
  if (lower.includes('postgres')) return CONNECTOR_DB_FIELD_MAP['postgres'];
  if (lower.includes('mysql')) return CONNECTOR_DB_FIELD_MAP['mysql'];
  return undefined;
}

export async function buildConnectorConfig(
  client: AivenClient,
  params: Record<string, unknown>
): Promise<ConnectorConfigResult> {
  const project = String(params['project']);
  const connectorClass = String(params['connector.class']);
  const sourceService = params['source_service'] as string | undefined;

  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!ROUTING_KEYS.has(key)) {
      // eslint-disable-next-line security/detect-object-injection
      config[key] = value;
    }
  }

  if (sourceService) {
    const connInfo = await getServiceConnectionInfo(client, project, sourceService);
    if (typeof connInfo === 'string') {
      return { ok: false, error: toolError(connInfo) };
    }

    const fieldMapping = detectFieldMapping(connectorClass);
    if (fieldMapping) {
      for (const [configKey, infoField] of Object.entries(fieldMapping)) {
        // eslint-disable-next-line security/detect-object-injection
        if (config[configKey] !== undefined) continue;

        if (infoField === '_jdbc_url') {
          // eslint-disable-next-line security/detect-object-injection
          config[configKey] = buildJdbcUrl(connInfo);
        } else {
          // eslint-disable-next-line security/detect-object-injection
          config[configKey] = connInfo[infoField as keyof ServiceConnectionInfo];
        }
      }
    }
  }

  return { ok: true, config };
}
