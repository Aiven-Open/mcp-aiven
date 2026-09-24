import { z } from 'zod';
import type { AivenClient } from '../../client.js';
import type { ApiToolConfig, HandlerContext, RequestOptions } from '../../types.js';
import { redactSensitiveData } from '../../security.js';
import { applicationServiceCredentialUserConfig } from './schemas.js';

const APPLICATION_SERVICE_CREDENTIAL = 'application_service_credential';

const INTEGRATION_TOOL_NAMES = new Set([
  'aiven_service_integration_list',
  'aiven_service_integration_create',
  'aiven_service_integration_get',
  'aiven_service_integration_update',
  'aiven_service_integration_delete',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withTypedUserConfig(inputSchema: z.ZodType): z.ZodType {
  if (!(inputSchema instanceof z.ZodObject)) return inputSchema;

  const shape = inputSchema.shape as Record<string, z.ZodType>;
  const genericUserConfig = shape['user_config'];
  if (!genericUserConfig) return inputSchema;

  // TODO: Add typed user_config schemas for other integration types.
  // Retain the generic fallback until all supported API types are covered.
  return inputSchema.extend({
    user_config: z
      .union([applicationServiceCredentialUserConfig, genericUserConfig])
      .describe(
        'For application_service_credential, use one of the typed PostgreSQL, Valkey, Kafka, or OpenSearch configurations. Other integration types remain supported with their API-defined user_config.'
      ),
  });
}

function parseApplicationCredentialUserConfig(value: unknown): Record<string, unknown> {
  const result = applicationServiceCredentialUserConfig.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'user_config'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid application_service_credential user_config: ${issues}`);
  }
  return result.data;
}

function validateCreateParams(args: Record<string, unknown>): void {
  if (args['integration_type'] !== APPLICATION_SERVICE_CREDENTIAL) return;

  if (typeof args['source_service'] !== 'string' || typeof args['dest_service'] !== 'string') {
    throw new Error(
      'application_service_credential requires source_service and dest_service (the application service)'
    );
  }
  if (args['source_endpoint_id'] != null || args['dest_endpoint_id'] != null) {
    throw new Error(
      'application_service_credential connects source_service to dest_service; do not use source_endpoint_id or dest_endpoint_id'
    );
  }

  parseApplicationCredentialUserConfig(args['user_config']);
}

function requestOptions(toolName: string, context: HandlerContext | undefined): RequestOptions {
  return {
    token: context?.token,
    mcpClient: context?.mcpClient,
    toolName,
    requestId: context?.requestId,
    toolReasoning: context?.toolReasoning,
  };
}

function updateValidator(client: AivenClient) {
  return async (args: Record<string, unknown>, context?: HandlerContext): Promise<void> => {
    const project = String(args['project']);
    const integrationId = String(args['integration_id']);
    const result = await client.get<Record<string, unknown>>(
      `/project/${encodeURIComponent(project)}/integration/${encodeURIComponent(integrationId)}`,
      requestOptions('aiven_service_integration_update', context)
    );
    const integration = result['service_integration'];

    if (!isRecord(integration)) {
      throw new Error('Aiven API response did not include service_integration');
    }
    if (integration['integration_type'] !== APPLICATION_SERVICE_CREDENTIAL) return;

    const nextUserConfig = parseApplicationCredentialUserConfig(args['user_config']);
    const currentUserConfig = integration['user_config'];
    const currentServiceType = isRecord(currentUserConfig)
      ? currentUserConfig['service_type']
      : undefined;

    if (
      typeof currentServiceType === 'string' &&
      currentServiceType !== nextUserConfig['service_type']
    ) {
      throw new Error(
        'user_config.service_type cannot be changed. Delete and recreate the integration to change integration_type, source_service, dest_service, or user_config.service_type.'
      );
    }
  };
}

function restoreSafeApplicationCredentialConfig(original: unknown, redacted: unknown): void {
  if (Array.isArray(original) && Array.isArray(redacted)) {
    for (let index = 0; index < original.length; index += 1) {
      restoreSafeApplicationCredentialConfig(original[index], redacted[index]);
    }
    return;
  }
  if (!isRecord(original) || !isRecord(redacted)) return;

  if (original['integration_type'] === APPLICATION_SERVICE_CREDENTIAL) {
    const userConfig = applicationServiceCredentialUserConfig.safeParse(original['user_config']);
    if (userConfig.success) {
      redacted['user_config'] = userConfig.data;
    }
  }

  for (const [key, value] of Object.entries(original)) {
    restoreSafeApplicationCredentialConfig(value, redacted[key]);
  }
}

export function redactIntegrationResponse(data: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactSensitiveData(data);
  restoreSafeApplicationCredentialConfig(data, redacted);
  return redacted;
}

export function integrationConfigOverrides(
  toolName: string,
  inputSchema: z.ZodType,
  client: AivenClient
): Partial<Pick<ApiToolConfig, 'inputSchema' | 'validateParams' | 'redactResponse'>> {
  if (!INTEGRATION_TOOL_NAMES.has(toolName)) return {};

  const overrides: Partial<
    Pick<ApiToolConfig, 'inputSchema' | 'validateParams' | 'redactResponse'>
  > = {
    redactResponse: redactIntegrationResponse,
  };

  if (toolName === 'aiven_service_integration_create') {
    overrides.inputSchema = withTypedUserConfig(inputSchema);
    overrides.validateParams = validateCreateParams;
  } else if (toolName === 'aiven_service_integration_update') {
    overrides.inputSchema = withTypedUserConfig(inputSchema);
    overrides.validateParams = updateValidator(client);
  }

  return overrides;
}
