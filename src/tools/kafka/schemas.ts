import { z } from 'zod';
import { reasoningField } from '../shared-schemas.js';

const SOURCE_SERVICE_DESC =
  'Aiven service name to resolve connection credentials from. ' +
  'When set, database.hostname/port/user/password are auto-populated.';

const CONNECTOR_CONFIG_DESC =
  'Connector settings as a flat map of `setting` → `value` (all values as strings). ' +
  'Valid keys depend on `connector_class`; do NOT include `connector.class` here. ' +
  'When `source_service` is set, DB connection keys are injected automatically — omit them. ' +
  'Example: { "topic.prefix": "cdc", "table.include.list": "public.orders", "plugin.name": "pgoutput" }';

const connectorConfig = z.record(z.string()).optional().describe(CONNECTOR_CONFIG_DESC);

export const createConnectorInput = z
  .object({
    project: z.string().describe('Aiven project name — use aiven_project_list to get valid names'),
    service_name: z.string().describe('Kafka Connect service name'),
    connector_class: z.string().describe('Java class for the connector'),
    name: z.string().describe('Unique name for the connector'),
    source_service: z.string().optional().describe(SOURCE_SERVICE_DESC),
    config: connectorConfig,
    reasoning: reasoningField,
  })
  .strict();

export const editConnectorInput = z
  .object({
    project: z.string().describe('Aiven project name — use aiven_project_list to get valid names'),
    service_name: z.string().describe('Kafka Connect service name'),
    connector_name: z.string().describe('Name of the connector to edit'),
    connector_class: z.string().describe('Java class for the connector'),
    name: z.string().describe('Unique name for the connector'),
    source_service: z.string().optional().describe(SOURCE_SERVICE_DESC),
    config: connectorConfig,
    reasoning: reasoningField,
  })
  .strict();
