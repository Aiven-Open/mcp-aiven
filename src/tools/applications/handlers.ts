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
  vcsIntegrationRepositoryBranchListInput,
  vcsIntegrationRepositoryContainerManifestFilesListInput,
  vcsIntegrationRepositoryListInput,
  vcsIntegrationRepositoryScanContainerManifestInput,
  type ServiceIntegrationInput,
} from './schemas.js';

/** Max repositories returned in one call — stops pagination early (avoids huge payloads). */
const MAX_VCS_REPOSITORY_LIST_ITEMS = 1000;
/** Safety cap on HTTP pages if the API keeps returning data. */
const MAX_VCS_REPOSITORY_LIST_PAGES = 100;
/** Max branches returned in one call. */
const MAX_VCS_BRANCH_LIST_ITEMS = 1000;
/** Safety cap on branch-list HTTP pages. */
const MAX_VCS_BRANCH_LIST_PAGES = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ensureGitHubSuffix(repositoryUrl: string): string {
  if (repositoryUrl.startsWith('https://github.com/') && !repositoryUrl.endsWith('.git')) {
    return `${repositoryUrl}.git`;
  }
  return repositoryUrl;
}

function withAsyncDeploymentGuidance(
  result: Record<string, unknown>,
  message: string
): Record<string, unknown> {
  return {
    ...result,
    message,
    next_tool: 'aiven_service_get',
    next_step:
      'The service state may not reflect the deployment immediately. Tell the user the operation is continuing asynchronously and ask when they want to check its status; do not poll in a loop.',
  };
}

function prepareManifestScanResult(result: Record<string, unknown>): Record<string, unknown> {
  const summarizedResult = { ...result };
  const fileScan = summarizedResult['file_scan'];
  if (!isRecord(fileScan)) {
    return summarizedResult;
  }

  // Source contents can be large. The detected attributes and service
  // suggestions are the actionable scan output.
  const summarizedFileScan = { ...fileScan };
  delete summarizedFileScan['raw_contents'];

  if (summarizedFileScan['container_manifest_type'] === 'compose') {
    summarizedFileScan['deployment_guidance'] = {
      workflow: 'review_service_suggestions',
      message:
        'The repository scanner produced candidate Aiven service configurations from this Compose file. The suggestions may omit services or settings the scanner cannot map. Review them before creating services, and do not pass the Compose file itself to aiven_application_create.',
      next_tool: 'aiven_service_create',
      limitations: [
        'Suggestions cover only Compose services recognized by the repository scanner.',
        'Image-only services that do not map to a supported Aiven service may be omitted.',
      ],
      tls_guidance: {
        applies_to_integrations: ['pg', 'valkey'],
        ca_certificate_file_mounts: 'planned_not_yet_available',
        temporary_workaround:
          'Keep TLS enabled but disable server-certificate validation in the application client. Explain the reduced protection and get the user’s approval before changing their application.',
        warning:
          'Disabling certificate validation preserves encryption but does not authenticate the server. Remove the workaround when platform-provided CA certificate file mounts become available.',
      },
      steps: [
        'Present the returned suggestions and these limitations to the user.',
        'Confirm which suggested services to create, including their plan and cloud.',
        'For PostgreSQL or Valkey integrations, present the temporary TLS workaround and get the user’s approval before changing certificate validation.',
        'Create referenced services before applications that use them. Whether to wait for them to reach RUNNING depends on how the application handles unavailable services during startup.',
        'Preserve each suggestion’s user_config and service_integrations when creating it.',
      ],
    };
  }

  summarizedResult['file_scan'] = summarizedFileScan;
  return summarizedResult;
}

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
  const createTool: ToolDefinition = {
    name: ApplicationToolName.Create,
    category: ServiceCategory.Application,
    definition: {
      title: 'Create Application on Aiven',
      description: `Create and initially deploy one Dockerized application to Aiven from a Containerfile or Dockerfile. The application service must not already exist, and the API returns 409 if it does. A successful response means the application was created and its initial deployment is continuing asynchronously, not that deployment completed. The service state may not reflect the deployment immediately. Tell the user the operation is continuing and ask when they want to check its status with \`aiven_service_get\`; do not poll in a loop. For an existing application, use \`aiven_application_redeploy\` to rebuild from its configured repository without changing its service configuration, \`aiven_service_update\` to change its service configuration, or \`aiven_service_integration_create\`, \`aiven_service_integration_update\`, and \`aiven_service_integration_delete\` to manage connected data services.

This tool does not accept a Compose file directly. To derive candidate Aiven service configurations from a Compose file, use \`aiven_vcs_integration_repository_container_manifest_files_list\`, then \`aiven_vcs_integration_repository_scan_container_manifest\`. The scanner recognizes application services with a build configuration and selected Aiven-compatible data services; it may omit services or settings it cannot map. Review its \`service_suggestions\` before creating accepted services with \`aiven_service_create\`.

## Pre-deploy verification (read-only checks — do NOT create, push, or modify anything)

Inspect the local project files and confirm each applicable item. Report findings to the user. Block deployment when a problem would make the build or application fail, expose credentials, or weaken transport security. Treat ecosystem and source-layout guidance as recommendations. If a fix is needed, explain it and get the user's approval before editing or pushing code.

- \`repository_url\` visibility → fetch repository metadata and check the \`private\` field. Do not infer from file access — being able to read files tells you nothing about visibility. If you cannot determine it, ask the user.
- VCS credentials (private repos only) → if the repo is private, call \`aiven_vcs_integration_list\` (project), then for each integration call \`aiven_vcs_integration_repository_list\` and find the repo whose \`source_url\` matches (strip trailing \`.git\`, lowercase both sides). If matched, use the resolved \`vcs_integration_id\` and \`remote_repository_id\` — do NOT ask the user for these. If no match found, continue remaining checks but do NOT call this tool; after all checks, tell the user: "⚠️ This repository is private but is not connected to Aiven. Please connect your GitHub account via the Aiven Console and grant access to this repo, then try again."
- \`build_path\` and \`containerfile_path\` → verify the build context and Containerfile/Dockerfile paths are correct. If the file uses \`EXPOSE\`, verify it matches \`port\`. Confirm the image starts the application through \`CMD\`, \`ENTRYPOINT\`, or an equivalent project-specific mechanism.
- \`port\` → verify app source binds to \`0.0.0.0\`, not \`localhost\`/\`127.0.0.1\`
- \`service_integrations\` → for each entry, verify the source service exists in the same project (\`aiven_service_get\`) and the app reads the configured env var names. Whether to wait for the service to reach RUNNING depends on how the app handles unavailable services during startup.
- PostgreSQL/Valkey SSL → the deploy tool injects \`PROJECT_CA_CERT\` (base64-encoded Aiven CA cert). Verify that the application's client library uses it to validate TLS. For Node.js \`pg\` v8, \`sslmode\` in the connection URL overrides the \`ssl\` option, so one suitable pattern is:
  \`\`\`js
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete('sslmode');
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: { ca: Buffer.from(process.env.PROJECT_CA_CERT, 'base64').toString() },
  });
  \`\`\`
  Equivalent library-appropriate implementations are valid. If certificate validation is missing, report the issue and ask before editing or pushing code.
- OpenSearch SSL → Aiven OpenSearch uses a publicly-trusted TLS certificate. No \`PROJECT_CA_CERT\` is injected and none is needed. App code should connect using the environment variable configured by the OpenSearch service integration without any custom CA cert (the default system trust store is sufficient).
- \`app_service_name\` → verify target app is RUNNING (\`aiven_service_get\`); source reads \`app_env_key\` env var
- \`repository_url\` → ask the user to provide the repo URL and confirm code is pushed to \`branch\`
- Node.js repositories → verify \`node_modules/\` is ignored. Ignore generated output such as \`dist/\` or \`.next/\` when the project does not intentionally commit it.
- npm repositories with \`package-lock.json\` → copy both \`package.json\` and \`package-lock.json\`, then use \`npm ci\` for reproducible dependency installation. For pnpm, Yarn, Ruby, and other ecosystems, preserve the project's lockfile and use its corresponding frozen or reproducible install command instead.
- \`project_vpc_id\` → only when the user explicitly asks to deploy into a VPC. Call \`aiven_project_vpc_list\`, show options, and pass the chosen ID. Do NOT set this unless the user requested VPC — default deploys omit it and the tool sends \`project_vpc_id: null\` to avoid auto-VPC placement

Bare example for an npm-based TypeScript Node.js application; adapt the build and start commands to the repository's language, framework, package manager, and existing scripts:
\`\`\`dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
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
          containerfile_path: containerfilePath,
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

        if (Boolean(vcsIntegrationId) !== Boolean(remoteRepositoryId)) {
          return toolError('vcs_integration_id and remote_repository_id must be provided together');
        }

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

        // Match the API's canonicalization: only GitHub HTTPS URLs gain a .git suffix.
        const repoUrl = ensureGitHubSuffix(repositoryUrl);

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

        if (containerfilePath) {
          sourceConfig['containerfile_path'] = containerfilePath.startsWith('./')
            ? containerfilePath
            : `./${containerfilePath}`;
        }

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
          project_vpc_id: projectVpcId ?? null,
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
            return toolSuccess(
              wrapUntrustedResponse(
                redactSensitiveData(
                  withAsyncDeploymentGuidance(
                    summary,
                    'Application created. The initial deployment is continuing asynchronously.'
                  )
                )
              ),
              ApplicationToolName.Create
            );
          }

          return toolSuccess(
            wrapUntrustedResponse(
              redactSensitiveData(
                withAsyncDeploymentGuidance(
                  result,
                  'Application created. The initial deployment is continuing asynchronously.'
                )
              )
            ),
            ApplicationToolName.Create
          );
        } catch (err) {
          return toolErrorWithRequestId(errorMessage(err), context?.requestId);
        }
    },
  };

  const deprecatedDeployAlias: ToolDefinition = {
    ...createTool,
    name: ApplicationToolName.Deploy,
    definition: {
      ...createTool.definition,
      title: 'Deprecated: Deploy Application to Aiven',
      description:
        `DEPRECATED: Use \`${ApplicationToolName.Create}\` instead. ` +
        `This compatibility alias is create-only and may be removed in a future major release.\n\n` +
        createTool.definition.description,
    },
  };

  return [
    createTool,
    deprecatedDeployAlias,
    {
      name: ApplicationToolName.Redeploy,
      category: ServiceCategory.Application,
      definition: {
        title: 'Redeploy Application',
        description: `Rebuild and redeploy an existing Aiven application service after new code has been pushed to its repository.

Use this ONLY when:
- The application service already exists and was previously created successfully with \`aiven_application_create\`
- The user has pushed a code change to the same repository and branch the service was deployed from
- Everything else stays the same: same repo, same port, same service configuration

Do NOT use this tool:
- When the Aiven service itself was never created (e.g. \`aiven_application_create\` returned an API error and no service exists) — call \`aiven_application_create\` again instead.
- To change service configuration (plan, cloud, env vars) — use \`aiven_service_update\`.
- To add, update, or remove connected data services — use \`aiven_service_integration_create\`, \`aiven_service_integration_update\`, or \`aiven_service_integration_delete\`.
- To update an existing application via \`aiven_application_create\` — it is create-only and returns 409 when the service already exists.

Runtime errors in the app (500s, crashes, SSL errors) are NOT deploy failures — the service exists and is running. Use this tool to pick up a code fix in those cases.

The rebuild pulls the latest commit from the configured branch and rebuilds the Docker image. Optionally, pass \`branch\` to switch to a different branch or tag before rebuilding — all other service settings remain unchanged.

A successful response means the redeploy was triggered, not that it completed. The service state may not reflect the redeploy immediately. Tell the user it was triggered and ask when they want to check its status with \`aiven_service_get\`; do not poll in a loop. A newly created application may return 409 until its initial deployment has created the underlying application resource.`,
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

          // Switching branch is a service-config change, so PUT user_config first.
          // An empty PUT does NOT rebuild — only the dedicated redeploy endpoint does.
          if (branch) {
            await client.put<Record<string, unknown>>(
              `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}`,
              { user_config: { application: { source: { branch } } } },
              opts
            );
          }

          // Triggers the actual pull + rebuild + deploy. Returns 204 No Content.
          await client.post<Record<string, unknown>>(
            `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(serviceName)}/application/redeploy`,
            {},
            opts
          );

          return toolSuccess(
            wrapUntrustedResponse(
              withAsyncDeploymentGuidance(
                {
                  service_name: serviceName,
                  branch: branch ?? 'current',
                },
                'Redeploy triggered. The deployment is continuing asynchronously.'
              )
            ),
            ApplicationToolName.Redeploy
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

Use this as the first step when deploying from a repository — run it silently before \`aiven_application_create\` to discover available VCS integrations and their IDs. The organization_id is resolved internally from the project name.

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
            }),
            ApplicationToolName.VcsIntegrationList
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
                }),
                ApplicationToolName.VcsIntegrationRepositoryList
              );
            }
            if (hitItemCap) {
              return toolSuccess(
                wrapUntrustedResponse({
                  repositories,
                  next,
                  truncated: true,
                }),
                ApplicationToolName.VcsIntegrationRepositoryList
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
            }),
            ApplicationToolName.VcsIntegrationRepositoryList
          );
        } catch (err) {
          return toolError(errorMessage(err));
        }
      },
    },
    {
      name: ApplicationToolName.VcsIntegrationRepositoryBranchList,
      category: ServiceCategory.Application,
      definition: {
        title: 'List VCS Repository Branches',
        description: `List branches in a repository accessible through a VCS integration.

Use this after \`aiven_vcs_integration_repository_list\` to select a branch and obtain its current \`commit_sha\`. Pass the commit SHA to the repository manifest tools to inspect that revision, and pass the branch name when scanning so it is included in the resulting service suggestions. Scanning is pinned to the commit SHA, but service creation follows the branch's current HEAD. Before creating a service from a suggestion, list branches again and verify that the branch still points to the inspected commit SHA; if it changed, scan the new commit and use the refreshed suggestions.

The tool follows pagination until there are no more pages, or until ${MAX_VCS_BRANCH_LIST_ITEMS} branches have been collected. If \`truncated\` is true, the repository has more than ${MAX_VCS_BRANCH_LIST_ITEMS} branches and the requested branch may exist outside the returned set. Do not conclude that the branch does not exist; ask the user for its current head commit SHA or use another trusted source to resolve it.`,
        inputSchema: vcsIntegrationRepositoryBranchListInput,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        const {
          organization_id: organizationId,
          vcs_integration_id: vcsIntegrationId,
          remote_repository_id: remoteRepositoryId,
        } = params as z.infer<typeof vcsIntegrationRepositoryBranchListInput>;
        const opts = {
          token: context?.token,
          requestId: context?.requestId,
          toolReasoning: context?.toolReasoning,
        };
        const path = `/organization/${encodeURIComponent(organizationId)}/application/vcs-integrations/${encodeURIComponent(vcsIntegrationId)}/repositories/${encodeURIComponent(remoteRepositoryId)}/branches`;

        try {
          type BranchRow = { name: string; commit_sha: string };
          type Page = { branches: BranchRow[]; next: string | null };
          const branches: BranchRow[] = [];
          let cursor: string | undefined;

          for (let page = 0; page < MAX_VCS_BRANCH_LIST_PAGES; page++) {
            const result = await client.get<Page>(path, {
              ...opts,
              query: cursor ? { cursor } : { limit: 100 },
            });
            const next = result.next ?? null;
            const room = MAX_VCS_BRANCH_LIST_ITEMS - branches.length;
            branches.push(...result.branches.slice(0, Math.max(0, room)));

            if (!next) {
              return toolSuccess(
                wrapUntrustedResponse({ branches, next: null, truncated: false }),
                ApplicationToolName.VcsIntegrationRepositoryBranchList
              );
            }
            if (branches.length >= MAX_VCS_BRANCH_LIST_ITEMS) {
              return toolSuccess(
                wrapUntrustedResponse({ branches, next, truncated: true }),
                ApplicationToolName.VcsIntegrationRepositoryBranchList
              );
            }
            cursor = next;
          }

          return toolSuccess(
            wrapUntrustedResponse({
              branches,
              next: cursor ?? null,
              truncated: true,
              note: `Pagination stopped after ${MAX_VCS_BRANCH_LIST_PAGES} pages (safety limit).`,
            }),
            ApplicationToolName.VcsIntegrationRepositoryBranchList
          );
        } catch (err) {
          return toolErrorWithRequestId(errorMessage(err), context?.requestId);
        }
      },
    },
    {
      name: ApplicationToolName.VcsIntegrationRepositoryContainerManifestFilesList,
      category: ServiceCategory.Application,
      definition: {
        title: 'List Repository Container Manifest Candidates',
        description: `Find repository files whose names match recognized Containerfile, Dockerfile, or Compose naming patterns at a specific commit. Discovery does not validate file contents.

Use \`aiven_vcs_integration_repository_branch_list\` first and pass the selected branch's current \`commit_sha\`. The result contains each candidate's \`file_path\`, \`file_sha\`, and filename-derived \`container_manifest_type\`.

Files larger than 1 MiB are omitted by the repository scanner. If an expected manifest is missing, do not conclude that it does not exist until its filename and size have been checked.

Pass a selected \`file_path\` to \`aiven_vcs_integration_repository_scan_container_manifest\` to validate and inspect its suggested service configuration.`,
        inputSchema: vcsIntegrationRepositoryContainerManifestFilesListInput,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        const {
          organization_id: organizationId,
          vcs_integration_id: vcsIntegrationId,
          remote_repository_id: remoteRepositoryId,
          commit_sha: commitSha,
        } = params as z.infer<typeof vcsIntegrationRepositoryContainerManifestFilesListInput>;
        const opts: RequestOptions = {
          token: context?.token,
          requestId: context?.requestId,
          toolReasoning: context?.toolReasoning,
        };

        try {
          const result = await client.get<Record<string, unknown>>(
            `/organization/${encodeURIComponent(organizationId)}/application/vcs-integrations/${encodeURIComponent(vcsIntegrationId)}/repositories/${encodeURIComponent(remoteRepositoryId)}/refs/${encodeURIComponent(commitSha)}/container-manifest-files`,
            opts
          );

          return toolSuccess(
            wrapUntrustedResponse(redactSensitiveData(result)),
            ApplicationToolName.VcsIntegrationRepositoryContainerManifestFilesList
          );
        } catch (err) {
          return toolErrorWithRequestId(errorMessage(err), context?.requestId);
        }
      },
    },
    {
      name: ApplicationToolName.VcsIntegrationRepositoryScanContainerManifest,
      category: ServiceCategory.Application,
      definition: {
        title: 'Scan Repository Container Manifest',
        description: `Analyze a selected container manifest at a specific repository commit.

Use \`aiven_vcs_integration_repository_container_manifest_files_list\` first and pass one of its \`file_path\` values. The scanner accepts Containerfile/Dockerfile and Compose manifests.

The result includes the manifest type, detected ports and environment variables, and candidate \`service_suggestions\`. For Compose, the scanner recognizes application services with a \`build\` configuration and image-based PostgreSQL, Valkey, OpenSearch, and Kafka services. It may omit image-only services it cannot map and does not implement general Compose deployment. Do not pass a Compose file to \`aiven_application_create\`.

Compose scans fail rather than returning partial suggestions when a referenced Dockerfile cannot be read. A 404 usually means a referenced Dockerfile is missing at the selected commit. A 422 means a Compose build path is invalid, such as resolving outside the repository. Report the error and ask the user to correct the repository; do not retry the same scan unchanged.

To use scan results, present the returned suggestions and scanner limitations to the user. The scan inspected the supplied commit SHA, but each application suggestion deploys from the branch name and is not pinned to that commit. Before creating services, call \`aiven_vcs_integration_repository_branch_list\` again and verify that the branch still points to the inspected commit SHA; if it changed, scan the new commit and use the refreshed suggestions. After the user confirms which services to create, resolve and confirm the required plan and cloud for each accepted suggestion, then call \`aiven_service_create\`. Preserve its \`service_type\`, \`service_name\`, \`user_config\`, and \`service_integrations\`; add \`project\`, \`plan\`, and \`cloud\`. Create referenced services before applications that use them. Whether to wait for them to reach RUNNING depends on how the application handles unavailable services during startup.

For application suggestions integrated with PostgreSQL or Valkey, platform-provided CA certificate file mounts are planned but not yet available through this workflow. In the meantime, the application client can keep TLS enabled while disabling server-certificate validation. Explain that this preserves encryption but does not authenticate the server, and get the user's approval before making that temporary change. Do not disable TLS itself. Remove the workaround once CA certificate file mounts are available. This scan operation itself does not deploy or modify services.`,
        inputSchema: vcsIntegrationRepositoryScanContainerManifestInput,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      handler: async (params, context?: HandlerContext): Promise<ToolResult> => {
        const {
          organization_id: organizationId,
          vcs_integration_id: vcsIntegrationId,
          remote_repository_id: remoteRepositoryId,
          commit_sha: commitSha,
          repository_url: repositoryUrl,
          branch,
          file_path: filePath,
        } = params as z.infer<typeof vcsIntegrationRepositoryScanContainerManifestInput>;
        const opts: RequestOptions = {
          token: context?.token,
          requestId: context?.requestId,
          toolReasoning: context?.toolReasoning,
        };

        try {
          const result = await client.post<Record<string, unknown>>(
            `/organization/${encodeURIComponent(organizationId)}/application/vcs-integrations/${encodeURIComponent(vcsIntegrationId)}/repositories/${encodeURIComponent(remoteRepositoryId)}/refs/${encodeURIComponent(commitSha)}/scan-container-manifest`,
            {
              repository_url: repositoryUrl,
              branch,
              file_path: filePath,
            },
            opts
          );

          return toolSuccess(
            wrapUntrustedResponse(prepareManifestScanResult(result)),
            ApplicationToolName.VcsIntegrationRepositoryScanContainerManifest
          );
        } catch (err) {
          return toolErrorWithRequestId(errorMessage(err), context?.requestId);
        }
      },
    },
  ];
}
