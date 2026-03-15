import { z } from 'zod';

const SOURCE_SERVICE_DESC =
  'Aiven service name to resolve connection credentials from. ' +
  'When set, database.hostname/port/user/password are auto-populated.';

export const createConnectorInput = z
  .object({
    project: z.string().describe('Aiven project name'),
    service_name: z.string().describe('Kafka Connect service name'),
    connector_class: z.string().describe('Java class for the connector'),
    name: z.string().describe('Unique name for the connector'),
    source_service: z.string().optional().describe(SOURCE_SERVICE_DESC),
  })
  .passthrough();

export const editConnectorInput = z
  .object({
    project: z.string().describe('Aiven project name'),
    service_name: z.string().describe('Kafka Connect service name'),
    connector_name: z.string().describe('Name of the connector to edit'),
    connector_class: z.string().describe('Java class for the connector'),
    name: z.string().describe('Unique name for the connector'),
    source_service: z.string().optional().describe(SOURCE_SERVICE_DESC),
  })
  .passthrough();
