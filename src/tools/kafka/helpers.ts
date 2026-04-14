import type { AivenClient } from '../../client.js';
import type { RequestOptions, ServiceConnectionInfo } from '../../types.js';
import { getServiceConnectionInfo } from '../../shared/service-info.js';

const ROUTING_KEYS = new Set([
  'project',
  'service_name',
  'connector_name',
  'source_service',
  'connector_class',
]);

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
  params: Record<string, unknown>,
  opts?: RequestOptions
): Promise<Record<string, unknown>> {
  const project = String(params['project']);
  const connectorClass = String(params['connector_class']);
  const sourceService = params['source_service'] as string | undefined;

  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!ROUTING_KEYS.has(key)) {
      config[key] = value;
    }
  }
  // Map connector_class back to connector.class for the Kafka Connect API
  config['connector.class'] = connectorClass;

  if (sourceService) {
    const connInfo = await getServiceConnectionInfo(client, project, sourceService, opts);

    const fieldMapping = detectFieldMapping(connectorClass);
    if (fieldMapping) {
      for (const [configKey, infoField] of Object.entries(fieldMapping)) {
        if (config[configKey] !== undefined) continue;

        if (infoField === '_jdbc_url') {
          config[configKey] = buildJdbcUrl(connInfo);
        } else {
          config[configKey] = connInfo[infoField as keyof ServiceConnectionInfo];
        }
      }
    }
  }

  return config;
}
