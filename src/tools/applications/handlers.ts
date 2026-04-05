import { z } from 'zod';
import type { AivenClient } from '../../client.js';
import type { ToolDefinition, ToolResult, HandlerContext } from '../../types.js';
import {
  ServiceCategory,
  ApplicationToolName,
  CREATE_ANNOTATIONS,
  UPDATE_ANNOTATIONS,
  toolSuccess,
  toolError,
} from '../../types.js';
import { errorMessage } from '../../errors.js';
import { redactSensitiveData } from '../../security.js';
import { getProjectCaCert } from '../../shared/service-info.js';
import {
  deployApplicationInput,
  redeployApplicationInput,
  type ServiceIntegrationInput,
} from './schemas.js';

interface ServiceResponse {
  service: {
    service_uri?: string;
    components?: Array<{
      component: string;
      host: string;
      path: string;
      port: number;
    }>;
  };
}

async function fetchServiceDetails(
  client: AivenClient,
  project: string,
  serviceName: string,
  token?: string
): Promise<ServiceResponse['service']> {
  const opts = token ? { token } : undefined;
  const result = await client.get<ServiceResponse>(
    `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}`,
    opts
  );
  return result.service;
}

async function fetchAppUrl(
  client: AivenClient,
  project: string,
  serviceName: string,
  token?: string
): Promise<string> {
  const service = await fetchServiceDetails(client, project, serviceName, token);
  const component = service.components?.[0];
  if (!component?.path) {
    throw new Error(`No public URL available for application service ${serviceName}. Ensure the service is running.`);
  }
  return component.path;
}

interface ApiServiceIntegration {
  integration_type: 'application_service_credential';
  source_service: string;
  user_config: Record<string, string>;
}

/**
 * Maps a service_integrations input item to the API shape for application_service_credential.
 * pg / valkey / opensearch all use a single connection_string_environment_variable_name.
 * kafka exposes all 5 SSL credential env var names so the app code never needs to change.
 */
function buildServiceIntegration(integration: ServiceIntegrationInput): ApiServiceIntegration {
  if (integration.service_type === 'kafka') {
    return {
      integration_type: 'application_service_credential',
      source_service: integration.service_name,
      user_config: {
        service_type: 'kafka',
        bootstrap_servers_environment_variable_name: integration.bootstrap_servers_env,
        security_protocol_environment_variable_name: integration.security_protocol_env,
        access_key_environment_variable_name: integration.access_key_env,
        access_cert_environment_variable_name: integration.access_cert_env,
        ca_cert_environment_variable_name: integration.ca_cert_env,
      },
    };
  }

  // pg, valkey, opensearch share the same user_config shape
  return {
    integration_type: 'application_service_credential',
    source_service: integration.service_name,
    user_config: {
      service_type: integration.service_type,
      connection_string_environment_variable_name: integration.env_key,
    },
  };
}

export function createApplicationTools(client: AivenClient): ToolDefinition[] {
  return [
    {
      name: ApplicationToolName.Deploy,
      category: ServiceCategory.Application,
      definition: {
        title: 'Deploy Application to Aiven',
        description: `Deploy a Dockerized application to Aiven. Creates an Aiven app service that pulls, builds, and runs the Docker image.

## Mandatory pre-deploy verification (read-only checks — do NOT create, push, or modify anything)

Inspect the local project files and confirm each applicable item. Report findings to the user. Do not call this tool until the user confirms all checks pass.

- \`build_path\` → verify Dockerfile exists, contains \`EXPOSE\` matching \`port\` param, has \`CMD\`/\`ENTRYPOINT\`
- \`port\` → verify app source binds to \`0.0.0.0\`, not \`localhost\`/\`127.0.0.1\`
- \`service_integrations\` → for each entry, verify the source service is RUNNING (\`aiven_service_get\`); verify app reads the configured env var names
- PostgreSQL/Valkey SSL → the deploy tool injects \`PROJECT_CA_CERT\` (base64-encoded Aiven CA cert). App code MUST strip \`sslmode\` from the connection URL (pg v8 ignores the \`ssl\` option when \`sslmode\` is in the URL) and use the CA cert for proper TLS. Required pattern for Node.js pg client:
  \`\`\`js
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete('sslmode');
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: { ca: Buffer.from(process.env.PROJECT_CA_CERT, 'base64').toString() },
  });
  \`\`\`
  Verify this pattern exists in the source before deploying. If missing, add it and push before calling this tool.
- OpenSearch SSL → Aiven OpenSearch uses a publicly-trusted TLS certificate. No \`PROJECT_CA_CERT\` is injected and none is needed. App code should connect using the \`OPENSEARCH_URL\` directly without any custom CA cert (the default system trust store is sufficient).
- \`app_service_name\` → verify target app is RUNNING (\`aiven_service_get\`); source reads \`app_env_key\` env var
- \`repository_url\` → ask the user to provide the repo URL and confirm code is pushed to \`branch\`
- \`.gitignore\` → verify \`node_modules/\` and \`dist/\` are listed so they are not pushed to the repo
- Dockerfile → use \`npm install\` (not \`npm ci\`) and only \`COPY package.json\` — lockfiles may not be in the repo
- \`project_vpc_id\` → normally not needed — the backend auto-selects the VPC when the project has exactly one. Only required if the project has multiple VPCs (the API will return a CONFLICT error asking you to specify); in that case call \`aiven_project_vpc_list\` to list VPCs and ask the user which to use

Example Dockerfile for a TypeScript Node.js app:
\`\`\`dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npx tsc
RUN npm prune --production
EXPOSE 3000
CMD ["node", "dist/index.js"]
\`\`\``,
        inputSchema: deployApplicationInput,
        annotations: CREATE_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        const {
          project,
          service_name: serviceName,
          repository_url: repositoryUrl,
          branch,
          build_path: buildPath,
          port,
          port_name: portName,
          plan,
          cloud,
          environment_variables: envVars,
          service_integrations: serviceIntegrationsInput,
          app_service_name: appServiceName,
          app_env_key: appEnvKey,
          project_vpc_id: projectVpcId,
        } = params as z.infer<typeof deployApplicationInput>;

        // Build environment variables list (user-provided only)
        const allEnvVars: { key: string; kind: string; value: string }[] = [];

        if (envVars && envVars.length > 0) {
          for (const v of envVars) {
            allEnvVars.push({ key: v.key, kind: v.kind, value: v.value });
          }
        }

        // Build service integrations for automatic credential injection
        const serviceIntegrations =
          serviceIntegrationsInput?.map(buildServiceIntegration) ?? [];

        // Inject PROJECT_CA_CERT when connecting to services that use TLS with Aiven's self-signed CA.
        // Matches App Builder behaviour: fetch from /project/{project}/kms/ca and base64-encode.
        // Kafka credentials are injected as raw PEM files by the platform itself — no CA cert needed here.
        const needsCaCert = serviceIntegrationsInput?.some(
          (i) => i.service_type === 'pg' || i.service_type === 'valkey'
        );
        if (needsCaCert) {
          try {
            const caCert = await getProjectCaCert(client, project, context?.token);
            if (caCert) {
              allEnvVars.push({
                key: 'PROJECT_CA_CERT',
                kind: 'secret',
                value: Buffer.from(caCert).toString('base64'),
              });
            }
          } catch (err) {
            return toolError(
              `Failed to fetch project CA certificate required for TLS with pg/valkey: ${errorMessage(err)}`
            );
          }
        }

        // Resolve application service URL if requested (app-to-app, not a credential integration)
        if (appServiceName) {
          try {
            const url = await fetchAppUrl(client, project, appServiceName, context?.token);
            allEnvVars.push({ key: appEnvKey, kind: 'variable', value: url });
          } catch (err) {
            return toolError(errorMessage(err));
          }
        }

        // Ensure repository URL ends with .git for proper cloning
        const repoUrl = repositoryUrl.endsWith('.git')
          ? repositoryUrl
          : `${repositoryUrl}.git`;

        // Ensure build_path has ./ prefix
        const normalizedBuildPath = buildPath.startsWith('./')
          ? buildPath
          : `./${buildPath}`;

        const applicationConfig: Record<string, unknown> = {
          source: {
            repository_url: repoUrl,
            branch,
            build_path: normalizedBuildPath,
          },
          ports: [{ name: portName, port, protocol: 'HTTP' }],
          environment_variables: allEnvVars,
        };

        const data = {
          service_name: serviceName,
          service_type: 'application',
          plan,
          cloud,
          ...(projectVpcId !== undefined ? { project_vpc_id: projectVpcId } : {}),
          service_integrations: serviceIntegrations.length > 0 ? serviceIntegrations : undefined,
          user_config: {
            application: applicationConfig,
          },
        };

        try {
          const opts = context?.token ? { token: context.token } : undefined;
          const result = await client.post<Record<string, unknown>>(
            `/project/${encodeURIComponent(project)}/service`,
            data,
            opts
          );

          const service = result['service'] as Record<string, unknown> | undefined;
          if (service) {
            const summary = {
              service_name: service['service_name'],
              service_type: service['service_type'],
              state: service['state'],
              plan: service['plan'],
              cloud_name: service['cloud_name'],
            };
            return toolSuccess(redactSensitiveData(summary));
          }

          return toolSuccess(redactSensitiveData(result));
        } catch (err) {
          return toolError(errorMessage(err));
        }
      },
    },
    {
      name: ApplicationToolName.Redeploy,
      category: ServiceCategory.Application,
      definition: {
        title: 'Redeploy Application',
        description: `Rebuild and redeploy an existing Aiven application service after new code has been pushed to its repository.

Use this ONLY when:
- The application service already exists and was previously deployed successfully with \`aiven_application_deploy\`
- The user has pushed a code change to the same repository and branch the service was deployed from
- Everything else stays the same: same repo, same branch, same port, same service configuration

Do NOT use this tool:
- When the Aiven service itself was never created (e.g. \`aiven_application_deploy\` returned an API error and no service exists) — call \`aiven_application_deploy\` again instead.
- To change service configuration (plan, cloud, env vars, integrations) — use \`aiven_service_update\` or redeploy via \`aiven_application_deploy\` with updated parameters.

Runtime errors in the app (500s, crashes, SSL errors) are NOT deploy failures — the service exists and is running. Use this tool to pick up a code fix in those cases.

The rebuild pulls the latest commit from the configured branch and rebuilds the Docker image. It does not change any service settings.`,
        inputSchema: redeployApplicationInput,
        annotations: UPDATE_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        const { project, service_name: serviceName } = params as z.infer<typeof redeployApplicationInput>;

        try {
          const opts = context?.token ? { token: context.token } : undefined;

          // No dedicated redeploy endpoint exists yet. A no-op service update (empty PUT body)
          // triggers Meta Core's Executor to pick up the change and redeploy — same mechanism
          // used by the Aiven Console redeploy button.
          await client.put<Record<string, unknown>>(
            `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}`,
            {},
            opts
          );

          return toolSuccess({
            service_name: serviceName,
            message: 'Redeploy triggered. The service will pull latest code, rebuild, and deploy.',
          });
        } catch (err) {
          return toolError(errorMessage(err));
        }
      },
    },
  ];
}
