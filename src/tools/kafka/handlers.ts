import { z } from 'zod';
import type { AivenClient } from '../../client.js';
import type { ToolDefinition, ToolResult, HandlerContext } from '../../types.js';
import {
  ServiceCategory,
  KafkaToolName,
  CREATE_ANNOTATIONS,
  UPDATE_ANNOTATIONS,
  toolSuccess,
  toolErrorWithRequestId,
} from '../../types.js';
import { errorMessage } from '../../errors.js';
import { redactSensitiveData } from '../../security.js';
import { buildConnectorConfig } from './helpers.js';
import { createConnectorInput, editConnectorInput } from './schemas.js';
import { CREATE_CONNECTOR_DESCRIPTION, EDIT_CONNECTOR_DESCRIPTION } from './descriptions.js';
import type { RequestOptions } from '../../types.js';

export function createKafkaCustomTools(client: AivenClient): ToolDefinition[] {
  return [
    {
      name: KafkaToolName.ConnectCreateConnector,
      category: ServiceCategory.Kafka,
      definition: {
        title: 'Create Kafka Connect Connector',
        description: CREATE_CONNECTOR_DESCRIPTION,
        inputSchema: createConnectorInput,
        annotations: CREATE_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        try {
          const typedParams = params as z.infer<typeof createConnectorInput> &
            Record<string, unknown>;
          const { project, service_name: serviceName } = typedParams;

          const opts: RequestOptions = {
            token: context?.token,
            mcpClient: context?.mcpClient,
            toolName: KafkaToolName.ConnectCreateConnector,
            requestId: context?.requestId,
            toolReasoning: context?.toolReasoning,
          };
          const config = await buildConnectorConfig(client, typedParams, opts);

          const data = await client.post<Record<string, unknown>>(
            `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}/connectors`,
            config,
            opts
          );

          return toolSuccess(redactSensitiveData(data));
        } catch (err) {
          return toolErrorWithRequestId(errorMessage(err), context?.requestId);
        }
      },
    },

    {
      name: KafkaToolName.ConnectEditConnector,
      category: ServiceCategory.Kafka,
      definition: {
        title: 'Edit Kafka Connect Connector',
        description: EDIT_CONNECTOR_DESCRIPTION,
        inputSchema: editConnectorInput,
        annotations: UPDATE_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        try {
          const typedParams = params as z.infer<typeof editConnectorInput> & Record<string, unknown>;
          const { project, service_name: serviceName, connector_name: connectorName } = typedParams;

          const opts: RequestOptions = {
            token: context?.token,
            mcpClient: context?.mcpClient,
            toolName: KafkaToolName.ConnectEditConnector,
            requestId: context?.requestId,
            toolReasoning: context?.toolReasoning,
          };
          const config = await buildConnectorConfig(client, typedParams, opts);

          const data = await client.put<Record<string, unknown>>(
            `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}/connectors/${encodeURIComponent(connectorName)}`,
            config,
            opts
          );

          return toolSuccess(redactSensitiveData(data));
        } catch (err) {
          return toolErrorWithRequestId(errorMessage(err), context?.requestId);
        }
      },
    },
  ];
}
