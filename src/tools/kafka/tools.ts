import { z } from 'zod';
import type { AivenClient } from '../../client.js';
import type { ToolDefinition, ToolResult } from '../../types.js';
import {
  ServiceCategory,
  CREATE_ANNOTATIONS,
  UPDATE_ANNOTATIONS,
  toolSuccess,
  toolError,
} from '../../types.js';
import { formatError } from '../../errors.js';
import { redactSensitiveData } from '../../security.js';
import { KafkaToolName } from './constants.js';
import { buildConnectorConfig } from './helpers.js';
import { createConnectorInput, editConnectorInput, integrationCreateInput } from './schemas.js';

const CONNECTOR_DESC_SUFFIX = `When \`source_service\` is provided, connection credentials (hostname, port, user, password) are automatically resolved from that Aiven service — no need to look up or provide passwords manually.

Supports Debezium CDC connectors (PostgreSQL, MySQL), JDBC source/sink, and any connector class. Extra configuration fields are passed through as-is.

**Prerequisites:** The Kafka service must have Kafka Connect enabled (\`user_config.kafka_connect: true\`). If using Schema Registry for value/key converters, enable it too (\`user_config.schema_registry: true\`).`;

export function createKafkaCustomTools(client: AivenClient): ToolDefinition[] {
  return [
    {
      name: KafkaToolName.ConnectCreateConnector,
      category: ServiceCategory.Kafka,
      definition: {
        title: 'Create Kafka Connect Connector',
        description: `Create a Kafka Connect connector.

${CONNECTOR_DESC_SUFFIX}

**Example — Debezium PostgreSQL CDC:**
\`\`\`
aiven_kafka_connect_create_connector(
  project="my-project",
  service_name="my-kafka",
  source_service="my-pg",
  name="pg-cdc",
  connector.class="io.debezium.connector.postgresql.PostgresConnector",
  topic.prefix="cdc",
  table.include.list="public.orders,public.users",
  plugin.name="pgoutput",
  slot.name="debezium_slot",
  database.sslmode="require",
  publication.autocreate.mode="filtered"
)
\`\`\``,
        inputSchema: createConnectorInput,
        annotations: CREATE_ANNOTATIONS,
      },
      handler: async (params): Promise<ToolResult> => {
        const typedParams = params as z.infer<typeof createConnectorInput> &
          Record<string, unknown>;
        const { project, service_name: serviceName } = typedParams;

        const configResult = await buildConnectorConfig(client, typedParams);
        if (!configResult.ok) return configResult.error;

        const result = await client.post<Record<string, unknown>>(
          `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}/connectors`,
          configResult.config
        );

        if (result.status === 'error') {
          return toolError(formatError(result.error));
        }

        return toolSuccess(redactSensitiveData(result.data));
      },
    },

    {
      name: KafkaToolName.ConnectEditConnector,
      category: ServiceCategory.Kafka,
      definition: {
        title: 'Edit Kafka Connect Connector',
        description: `Edit an existing Kafka Connect connector configuration.

${CONNECTOR_DESC_SUFFIX}`,
        inputSchema: editConnectorInput,
        annotations: UPDATE_ANNOTATIONS,
      },
      handler: async (params): Promise<ToolResult> => {
        const typedParams = params as z.infer<typeof editConnectorInput> & Record<string, unknown>;
        const { project, service_name: serviceName, connector_name: connectorName } = typedParams;

        const configResult = await buildConnectorConfig(client, typedParams);
        if (!configResult.ok) return configResult.error;

        const result = await client.put<Record<string, unknown>>(
          `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}/connectors/${encodeURIComponent(connectorName)}`,
          configResult.config
        );

        if (result.status === 'error') {
          return toolError(formatError(result.error));
        }

        return toolSuccess(redactSensitiveData(result.data));
      },
    },

    {
      name: KafkaToolName.ServiceIntegrationCreate,
      category: ServiceCategory.Kafka,
      definition: {
        title: 'Create Service Integration',
        description: `Create a service integration (e.g. link Kafka Connect to Kafka).
Required: project, source_service (e.g. Kafka), dest_service (e.g. Kafka Connect), integration_type (e.g. kafka_connect).`,
        inputSchema: integrationCreateInput,
        annotations: CREATE_ANNOTATIONS,
      },
      handler: async (params): Promise<ToolResult> => {
        const {
          project,
          source_service: sourceService,
          dest_service: destService,
          integration_type: integrationType,
        } = params as z.infer<typeof integrationCreateInput>;

        const result = await client.post<Record<string, unknown>>(
          `/project/${encodeURIComponent(project)}/integration`,
          {
            integration_type: integrationType,
            source_service: sourceService,
            dest_service: destService,
          }
        );

        if (result.status === 'error') {
          return toolError(formatError(result.error));
        }

        return toolSuccess(redactSensitiveData(result.data));
      },
    },
  ];
}
