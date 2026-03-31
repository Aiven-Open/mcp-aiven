import { z } from 'zod';
import type { AivenClient } from '../../client.js';
import type { ToolDefinition, ToolResult, HandlerContext } from '../../types.js';
import {
  ServiceCategory,
  ApplicationToolName,
  CREATE_ANNOTATIONS,
  toolSuccess,
  toolError,
} from '../../types.js';
import { errorMessage } from '../../errors.js';
import { redactSensitiveData } from '../../security.js';
import { getProjectCaCert } from '../../shared/service-info.js';
import { deployApplicationInput } from './schemas.js';

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

async function fetchServiceUri(
  client: AivenClient,
  project: string,
  serviceName: string,
  token?: string
): Promise<string> {
  const service = await fetchServiceDetails(client, project, serviceName, token);
  const uri = service.service_uri;
  if (!uri) {
    throw new Error(`No connection URI available for service ${serviceName}. Ensure the service is running.`);
  }
  return uri;
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
- \`pg_service_name\` → verify PG service is RUNNING (\`aiven_service_get\`); source reads \`pg_env_key\` env var and base64-decodes \`PROJECT_CA_CERT\` for SSL; Node.js must strip \`sslmode\` from URL
- \`app_service_name\` → verify target app is RUNNING (\`aiven_service_get\`); source reads \`app_env_key\` env var
- \`repository_url\` → ask the user to provide the repo URL and confirm code is pushed to \`branch\`
- \`.gitignore\` → verify \`node_modules/\` and \`dist/\` are listed so they are not pushed to the repo
- Dockerfile → use \`npm install\` (not \`npm ci\`) and only \`COPY package.json\` — lockfiles may not be in the repo

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
          pg_service_name: pgServiceName,
          pg_env_key: pgEnvKey,
          app_service_name: appServiceName,
          app_env_key: appEnvKey,
        } = params as z.infer<typeof deployApplicationInput>;

        // Build environment variables list
        const allEnvVars: { key: string; kind: string; value: string }[] = [];

        if (envVars && envVars.length > 0) {
          for (const v of envVars) {
            allEnvVars.push({ key: v.key, kind: v.kind, value: v.value });
          }
        }

        // Resolve PG service URI and project CA certificate if requested
        if (pgServiceName) {
          try {
            const uri = await fetchServiceUri(client, project, pgServiceName, context?.token);
            allEnvVars.push({ key: pgEnvKey, kind: 'secret', value: uri });

            const caCert = await getProjectCaCert(client, project, context?.token);
            if (caCert) {
              const encoded = Buffer.from(caCert).toString('base64');
              allEnvVars.push({ key: 'PROJECT_CA_CERT', kind: 'variable', value: encoded });
            }
          } catch (err) {
            return toolError(errorMessage(err));
          }
        }

        // Resolve application service URL if requested
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
          service_integrations: [],
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
  ];
}
