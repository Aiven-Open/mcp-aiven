import { z } from 'zod';
import type { AivenClient } from '../client.js';
import type { ToolDefinition, ToolResult, HandlerContext } from '../types.js';
import { ServiceCategory, READ_ONLY_ANNOTATIONS, toolSuccess, toolError } from '../types.js';
import { errorMessage } from '../errors.js';
import { wrapUntrustedResponse } from '../untrusted.js';
import { getProjectCaCert, getServiceWithSecrets } from '../shared/service-info.js';

const TOOL_NAME = 'aiven_service_connection_info';

const inputSchema = z.object({
  project: z.string().describe('Aiven project name (from `aiven_project_list`).'),
  service_name: z.string().describe('Service name (from `aiven_service_list`).'),
});

const DESCRIPTION = `Return LIVE connection credentials for an Aiven PostgreSQL or Kafka service so they can be wired into an application.

⚠️ SECURITY: This returns real credentials (passwords, connection URIs, and for Kafka mTLS the client certificate and private key) directly into this conversation; they will be stored in the chat transcript. Only use it when the user is explicitly building or configuring an application and has asked for connection details. Prefer writing them into the app's environment/secret store rather than echoing them back to the user.

Returns the minimum needed to connect:
- PostgreSQL: \`service_uri\`, \`service_uri_params\` (host, port, user, password, dbname), \`ca_cert\`.
- Kafka: \`service_uri\` (bootstrap servers), \`users\` (SASL password and/or mTLS \`access_cert\`+\`access_key\`), \`ca_cert\`.

Connecting: TLS is required. Verify against \`ca_cert\` (Aiven uses a self-signed project CA) — never disable verification or use the system trust store. For node-postgres, drop \`sslmode\` from the URL and pass \`ssl: { ca, rejectUnauthorized: true }\`.

This tool is only available when the connector was configured with \`allow_secrets=true\`.`;

interface ServiceUser {
  username?: string;
  password?: string;
  access_cert?: string;
  access_key?: string;
}

interface Service {
  service_type?: string;
  state?: string;
  service_uri?: string | null;
  service_uri_params?: Record<string, unknown>;
  users?: ServiceUser[];
}

function toConnectionUser(user: ServiceUser): ServiceUser {
  return {
    ...(user.username ? { username: user.username } : {}),
    ...(user.password ? { password: user.password } : {}),
    ...(user.access_cert ? { access_cert: user.access_cert } : {}),
    ...(user.access_key ? { access_key: user.access_key } : {}),
  };
}

export function createConnectionInfoTool(client: AivenClient, readOnly: boolean): ToolDefinition[] {
  return [
    {
      name: TOOL_NAME,
      category: ServiceCategory.Core,
      definition: {
        title: 'Get Service Connection Info (live credentials)',
        description: DESCRIPTION,
        inputSchema,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        try {
          if (readOnly) {
            return toolError(
              'Disabled while read_only is active. Connection info grants live credentials ' +
                'that would bypass read-only restrictions. Disable read_only to retrieve connection info.'
            );
          }

          const { project, service_name } = params as z.infer<typeof inputSchema>;
          const opts = {
            token: context?.token,
            mcpClient: context?.mcpClient,
            toolName: TOOL_NAME,
            requestId: context?.requestId,
          };

          const service = await getServiceWithSecrets<Service>(client, project, service_name, opts);
          if (service.state !== 'RUNNING') {
            return toolError(
              `Service "${service_name}" is not RUNNING (state: ${service.state ?? 'unknown'}). ` +
                'Connection info is only available for a running service.'
            );
          }

          const caCert = await getProjectCaCert(client, project, context?.token);

          const connectionInfo = {
            service_type: service.service_type,
            ...(service.service_uri ? { service_uri: service.service_uri } : {}),
            ...(service.service_uri_params ? { service_uri_params: service.service_uri_params } : {}),
            ...(service.users ? { users: service.users.map(toConnectionUser) } : {}),
            ca_cert: caCert,
            tls: { required: true, verify_with: 'ca_cert' },
          };

          return toolSuccess(wrapUntrustedResponse(connectionInfo), TOOL_NAME);
        } catch (err) {
          return toolError(errorMessage(err));
        }
      },
    },
  ];
}
