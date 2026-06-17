import { z } from 'zod';
import type { AivenClient } from '../../client.js';
import type { ToolDefinition, ToolResult, HandlerContext, RequestOptions } from '../../types.js';
import {
  ServiceCategory,
  ApplicationToolName,
  CREATE_ANNOTATIONS,
  UPDATE_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  toolSuccess,
  toolError,
  toolErrorWithRequestId,
} from '../../types.js';
import { errorMessage } from '../../errors.js';
import { redactSensitiveData } from '../../security.js';
import { wrapUntrustedResponse } from '../../untrusted.js';
import { getProjectCaCert } from '../../shared/service-info.js';
import {
  deployApplicationInput,
  redeployApplicationInput,
  vcsIntegrationListInput,
  vcsIntegrationRepositoryListInput,
  applicationBuildLogsGetInput,
  type ServiceIntegrationInput,
} from './schemas.js';

/** Max repositories returned in one call — stops pagination early (avoids huge payloads). */
const MAX_VCS_REPOSITORY_LIST_ITEMS = 1000;
/** Safety cap on HTTP pages if the API keeps returning data. */
const MAX_VCS_REPOSITORY_LIST_PAGES = 100;

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

interface ExposedValueEntry {
  environment_variable_key: string;
}

interface ApiServiceIntegrationUserConfig {
  service_type: string;
  exposed_values: Record<string, ExposedValueEntry>;
}

interface ApiServiceIntegration {
  integration_type: 'application_service_credential';
  source_service: string;
  user_config: ApiServiceIntegrationUserConfig;
}

/**
 * Maps a service_integrations input item to the API shape for application_service_credential.
 *
 * Emits the nested `exposed_values` format introduced in APP-199 / APP-240.
 * The flat `*_environment_variable_name` keys are being phased out.
 */
export function buildServiceIntegration(integration: ServiceIntegrationInput): ApiServiceIntegration {
  if (integration.service_type === 'kafka') {
    return {
      integration_type: 'application_service_credential',
      source_service: integration.service_name,
      user_config: {
        service_type: 'kafka',
        exposed_values: {
          bootstrap_servers: { environment_variable_key: integration.bootstrap_servers_env },
          security_protocol: { environment_variable_key: integration.security_protocol_env },
          access_key: { environment_variable_key: integration.access_key_env },
          access_cert: { environment_variable_key: integration.access_cert_env },
          ca_cert: { environment_variable_key: integration.ca_cert_env },
        },
      },
    };
  }

  return {
    integration_type: 'application_service_credential',
    source_service: integration.service_name,
    user_config: {
      service_type: integration.service_type,
      exposed_values: {
        connection_string: { environment_variable_key: integration.env_key },
      },
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

- \`repository_url\` visibility → fetch repository metadata and check the \`private\` field. Do not infer from file access — being able to read files tells you nothing about visibility. If you cannot determine it, ask the user.
- VCS credentials (private repos only) → if the repo is private, call \`aiven_vcs_integration_list\` (project), then for each integration call \`aiven_vcs_integration_repository_list\` and find the repo whose \`source_url\` matches (strip trailing \`.git\`, lowercase both sides). If matched, use the resolved \`vcs_integration_id\` and \`remote_repository_id\` — do NOT ask the user for these. If no match found, continue remaining checks but do NOT call this tool; after all checks, tell the user: "⚠️ This repository is private but is not connected to Aiven. Please connect your GitHub account via the Aiven Console and grant access to this repo, then try again."
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
        annotations: { ...CREATE_ANNOTATIONS, destructiveHint: true },
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        const {
          project,
          service_name: serviceName,
          repository_url: repositoryUrl,
          vcs_integration_id: vcsIntegrationId,
          remote_repository_id: remoteRepositoryId,
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

        // Build source config - include VCS integration IDs for private repo access
        const sourceConfig: Record<string, unknown> = {
          repository_url: repoUrl,
          branch,
          build_path: normalizedBuildPath,
        };

        // Add VCS integration IDs if provided (required for private repos)
        if (vcsIntegrationId) {
          sourceConfig['vcs_integration_id'] = vcsIntegrationId;
        }
        if (remoteRepositoryId) {
          sourceConfig['remote_repository_id'] = remoteRepositoryId;
        }

        const applicationConfig: Record<string, unknown> = {
          source: sourceConfig,
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
          const opts: RequestOptions = {
            token: context?.token,
            requestId: context?.requestId,
            toolReasoning: context?.toolReasoning,
          };
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
            return toolSuccess(wrapUntrustedResponse(redactSensitiveData(summary)));
          }

          return toolSuccess(wrapUntrustedResponse(redactSensitiveData(result)));
        } catch (err) {
          return toolErrorWithRequestId(errorMessage(err), context?.requestId);
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
- Everything else stays the same: same repo, same port, same service configuration

Do NOT use this tool:
- When the Aiven service itself was never created (e.g. \`aiven_application_deploy\` returned an API error and no service exists) — call \`aiven_application_deploy\` again instead.
- To change service configuration (plan, cloud, env vars, integrations) — use \`aiven_service_update\` or redeploy via \`aiven_application_deploy\` with updated parameters.

Runtime errors in the app (500s, crashes, SSL errors) are NOT deploy failures — the service exists and is running. Use this tool to pick up a code fix in those cases.

The rebuild pulls the latest commit from the configured branch and rebuilds the Docker image. Optionally, pass \`branch\` to switch to a different branch or tag before rebuilding — all other service settings remain unchanged.`,
        inputSchema: redeployApplicationInput,
        annotations: { ...UPDATE_ANNOTATIONS, destructiveHint: true },
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        const { project, service_name: serviceName, branch } = params as z.infer<
          typeof redeployApplicationInput
        >;

        try {
          const opts: RequestOptions = {
            token: context?.token,
            requestId: context?.requestId,
            toolReasoning: context?.toolReasoning,
          };

          // PUT with user_config sets the branch (and triggers rebuild when branch changes)
          // or triggers a rebuild from the current branch when body is empty.
          await client.put<Record<string, unknown>>(
            `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}`,
            branch ? { user_config: { application: { source: { branch } } } } : {},
            opts
          );

          return toolSuccess(
            wrapUntrustedResponse({
              service_name: serviceName,
              branch: branch ?? 'current',
              message: 'Redeploy triggered. The service will pull latest code, rebuild, and deploy.',
            })
          );
        } catch (err) {
          return toolErrorWithRequestId(errorMessage(err), context?.requestId);
        }
      },
    },
    {
      name: ApplicationToolName.VcsIntegrationList,
      category: ServiceCategory.Application,
      definition: {
        title: 'List VCS Integrations',
        description: `List connected VCS (GitHub) accounts for the organization that owns a project.

Use this as the first step when deploying from a repository — run it silently before \`aiven_application_deploy\` to discover available VCS integrations and their IDs. The organization_id is resolved internally from the project name.

Returns each integration's \`vcs_integration_id\` (needed for \`aiven_vcs_integration_repository_list\`) and \`vcs_account_name\` (the GitHub org or user name).`,
        inputSchema: vcsIntegrationListInput,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        const { project } = params as z.infer<typeof vcsIntegrationListInput>;
        const opts = { token: context?.token, requestId: context?.requestId, toolReasoning: context?.toolReasoning };

        let organizationId: string;
        try {
          const projectResult = await client.get<{ project: { organization_id: string } }>(
            `/project/${encodeURIComponent(project)}`,
            opts
          );
          organizationId = projectResult.project.organization_id;
          if (!organizationId) {
            return toolError(`Project '${project}' has no associated organization.`);
          }
        } catch (err) {
          return toolError(`Failed to fetch project '${project}': ${errorMessage(err)}`);
        }

        try {
          const result = await client.get<{
            vcs_integrations: Array<{
              vcs_integration_id: string;
              vcs_account_name: string;
              vcs_type: string;
            }>;
          }>(`/organization/${encodeURIComponent(organizationId)}/application/vcs-integrations`, opts);

          return toolSuccess(
            wrapUntrustedResponse({
              organization_id: organizationId,
              vcs_integrations: result.vcs_integrations,
            })
          );
        } catch (err) {
          return toolError(errorMessage(err));
        }
      },
    },
    {
      name: ApplicationToolName.VcsIntegrationRepositoryList,
      category: ServiceCategory.Application,
      definition: {
        title: 'List VCS Integration Repositories',
        description: `List repositories accessible via a VCS integration (connected GitHub account).

Use this after \`aiven_vcs_integration_list\` to find the \`remote_repository_id\` needed for deploying a private repository. Compare each repository's \`source_url\` against the user's repository URL to find the match (normalize: strip trailing \`.git\`, lowercase both sides before comparing).

The tool follows pagination until there are no more pages, or until ${MAX_VCS_REPOSITORY_LIST_ITEMS} repositories have been collected (whichever comes first). If truncated, \`truncated\` is true and \`next\` may still be set when more pages exist.

Returns \`remote_repository_id\`, \`full_name\`, \`source_url\`, and \`default_branch_name\` for each repository.`,
        inputSchema: vcsIntegrationRepositoryListInput,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        const { organization_id: organizationId, vcs_integration_id: vcsIntegrationId } =
          params as z.infer<typeof vcsIntegrationRepositoryListInput>;
        const opts = { token: context?.token, requestId: context?.requestId, toolReasoning: context?.toolReasoning };

        try {
          type RepoRow = {
            remote_repository_id: string;
            vcs_integration_id: string;
            vcs_type: string;
            full_name: string;
            name: string;
            source_url: string;
            default_branch_name: string | null;
          };
          type Page = { repositories: RepoRow[]; next: string | null };

          const path = `/organization/${encodeURIComponent(organizationId)}/application/vcs-integrations/${encodeURIComponent(vcsIntegrationId)}/repositories`;
          const repositories: RepoRow[] = [];
          let cursor: string | undefined;

          for (let page = 0; page < MAX_VCS_REPOSITORY_LIST_PAGES; page++) {
            const result = await client.get<Page>(path, {
              ...opts,
              query: cursor ? { cursor } : undefined,
            });
            const batch = result.repositories;
            const next = result.next ?? null;
            const room = MAX_VCS_REPOSITORY_LIST_ITEMS - repositories.length;
            if (room > 0) {
              repositories.push(...batch.slice(0, room));
            }

            const hitItemCap = repositories.length >= MAX_VCS_REPOSITORY_LIST_ITEMS;
            const hitEnd = !next;

            if (hitEnd) {
              return toolSuccess(
                wrapUntrustedResponse({
                  repositories,
                  next: null,
                  truncated: false,
                })
              );
            }
            if (hitItemCap) {
              return toolSuccess(
                wrapUntrustedResponse({
                  repositories,
                  next,
                  truncated: true,
                })
              );
            }
            cursor = next;
          }

          return toolSuccess(
            wrapUntrustedResponse({
              repositories,
              next: cursor ?? null,
              truncated: true,
              note: `Pagination stopped after ${MAX_VCS_REPOSITORY_LIST_PAGES} pages (safety limit).`,
            })
          );
        } catch (err) {
          return toolError(errorMessage(err));
        }
      },
    },
    {
      name: ApplicationToolName.BuildLogsGet,
      category: ServiceCategory.Application,
      definition: {
        title: 'Get Application Build Logs',
        description: `Docker build logs for an application service (git clone → image build → push). For runtime container logs use \`aiven_project_get_service_logs\`.

Start with \`sort_order: "asc"\`, \`limit: 500\`; paginate via the response \`offset\` until null. If still \`BUILDING\`/\`REBUILDING\`, return what's available and note logs are partial.`,
        inputSchema: applicationBuildLogsGetInput,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        const {
          project,
          service_name: serviceName,
          limit,
          offset,
          sort_order: sortOrder,
        } = params as z.infer<typeof applicationBuildLogsGetInput>;
        const opts = {
          token: context?.token,
          requestId: context?.requestId,
          toolReasoning: context?.toolReasoning,
          query: {
            ...(limit !== undefined ? { limit } : {}),
            ...(offset !== undefined ? { offset } : {}),
            ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
          } as Record<string, string | number | boolean | undefined>,
        };

        try {
          const result = await client.get<Record<string, unknown>>(
            `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}/application/build-logs`,
            opts
          );
          return toolSuccess(wrapUntrustedResponse(redactSensitiveData(result)));
        } catch (err) {
          return toolErrorWithRequestId(errorMessage(err), context?.requestId);
        }
      },
    },
  ];
}
