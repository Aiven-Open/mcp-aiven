import { z } from 'zod';

const SOURCE_SERVICE_DESC =
  'Aiven service name to resolve connection credentials from. ' +
  'When set, database.hostname/port/user/password are auto-populated.';

export const createConnectorInput = z
  .object({
    project: z.string().describe('Aiven project name'),
    service_name: z.string().describe('Kafka Connect service name'),
    'connector.class': z.string().describe('Java class for the connector'),
    name: z.string().describe('Unique name for the connector'),
    source_service: z.string().optional().describe(SOURCE_SERVICE_DESC),
  })
  .passthrough();

export const editConnectorInput = z
  .object({
    project: z.string().describe('Aiven project name'),
    service_name: z.string().describe('Kafka Connect service name'),
    connector_name: z.string().describe('Name of the connector to edit'),
    'connector.class': z.string().describe('Java class for the connector'),
    name: z.string().describe('Unique name for the connector'),
    source_service: z.string().optional().describe(SOURCE_SERVICE_DESC),
  })
  .passthrough();

export const integrationCreateInput = z
  .object({
    project: z.string().describe('Project name'),
    source_service: z.string().describe('Source service name (e.g. Kafka)'),
    dest_service: z.string().describe('Destination service name (e.g. Kafka Connect)'),
    integration_type: z.string().describe('Integration type, e.g. kafka_connect'),
  })
  .strict();
