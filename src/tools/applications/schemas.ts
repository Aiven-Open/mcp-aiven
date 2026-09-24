import { z } from 'zod';
import { reasoningField } from '../shared-schemas.js';
import { applicationServiceCredentialUserConfig } from '../integrations/schemas.js';

const environmentVariableItem = z.object({
  key: z.string().describe('Environment variable name (e.g. NODE_ENV, API_KEY)'),
  value: z.string().describe('Environment variable value'),
  kind: z
    .enum(['variable', 'secret'])
    .default('variable')
      .describe(
      'variable = visible in UI, secret = masked in UI. Use secret for tokens, passwords, URIs.'
      ),
});

export const serviceIntegrationItem = z
  .object({
    integration_type: z.literal('application_service_credential'),
    source_service: z
      .string()
      .describe('Name of the existing source service in the same project.'),
    user_config: applicationServiceCredentialUserConfig,
  })
  .strict();

export const deployApplicationInput = z
  .object({
    project: z.string().describe('Aiven project name — use aiven_project_list to get valid names'),

    service_name: z
      .string()
      .describe(
        'Unique name for this application service within the project. ' +
          'Use lowercase letters, numbers, and dashes only (e.g. "my-todo-app").'
      ),

    repository_url: z
      .string()
      .describe(
        'Git repository HTTPS URL (e.g. https://github.com/user/repo). ' +
          'IMPORTANT: NEVER assume the repository URL — always ask the user to confirm or provide it. ' +
          'You may push code for the user, but ALWAYS ask for confirmation before pushing.'
      ),

    vcs_integration_id: z
      .string()
      .optional()
      .describe(
        'VCS integration ID for deploying through a connected repository. ' +
          'Auto-resolved via aiven_vcs_integration_list + aiven_vcs_integration_repository_list — do NOT ask the user for this value.'
      ),

    remote_repository_id: z
      .string()
      .optional()
      .describe(
        'Repository ID within the connected VCS integration. ' +
          'Auto-resolved by matching source_url in aiven_vcs_integration_repository_list — do NOT ask the user for this value.'
      ),

    branch: z
      .string()
      .describe(
        'Git branch to deploy from (required — no default). ' +
          'IMPORTANT: NEVER assume the branch — always ask the user to confirm which branch to deploy from.'
      ),

    build_path: z
      .string()
      .default('')
      .describe(
        'Repository-root-relative image build context, equivalent to the final argument in ' +
          '`podman build -f <containerfile_path> <build_path>`. Default: ".".'
      ),

    containerfile_path: z
      .string()
      .optional()
      .describe(
        'Repository-root-relative path passed as `-f` in ' +
          '`podman build -f <containerfile_path> <build_path>`. It is independent of build_path ' +
          'and does not need to be inside it (e.g. "./docker/Dockerfile.prod").'
      ),

    port: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .describe(
        'The port the application listens on inside the container. ' +
          'This MUST match the port in the Dockerfile EXPOSE directive AND the port the app binds to in code. ' +
          'The app MUST listen on 0.0.0.0 (not 127.0.0.1 or localhost). Common values: 3000, 8000, 8080.'
      ),

    port_name: z
      .string()
      .default('default')
      .describe('Logical name for the port. Default: "default". Rarely needs changing.'),

    plan: z
      .string()
      .default('startup-50-1024')
      .describe(
        'Service plan. Default: "startup-50-1024" (0.5 vCPU, 1024 MB RAM). ' +
          'Use aiven_service_type_plans with service_type="application" to list available plans.'
      ),

    cloud: z
      .string()
      .default('aws-eu-west-1')
      .describe(
        'Cloud region for deployment. Always confirm with the user before proceeding unless they have already explicitly specified a region. If service_integrations are provided, call aiven_service_get on each integrated service first and check their cloud_name: if all share the same cloud, propose that cloud and ask the user to confirm; if they differ, list the options and ask the user to choose. If there are no integrated services, ask the user which cloud region to deploy into.'
      ),

    environment_variables: z
      .array(environmentVariableItem)
      .optional()
      .describe(
        'Additional environment variables to inject into the running container. ' +
          'Do NOT include credentials for services listed in service_integrations — those are auto-injected by the platform. ' +
          'Common additions: NODE_ENV=production, PORT (matching the port param).'
      ),

    service_integrations: z
      .array(serviceIntegrationItem)
      .optional()
      .describe(
        'Application service credential integrations in the same shape returned by repository scan and accepted by the Aiven API. ' +
          'Each source_service must already exist in the project. Inspect the application source and explicitly set each ' +
          'user_config.exposed_values.<value>.environment_variable_key; this MCP supplies no defaults.\n\n' +
          'Example:\n' +
          '  service_integrations: [\n' +
          '    { integration_type: "application_service_credential", source_service: "my-pg", user_config: { service_type: "pg", exposed_values: { connection_string: { environment_variable_key: "DATABASE_URL" } } } }\n' +
          '  ]'
      ),

    app_service_name: z
      .string()
      .optional()
      .describe(
        'Name of an EXISTING Aiven Application service in the same project whose public URL ' +
          'should be injected as an environment variable. The target service must be in RUNNING state ' +
          'with a public URL available. Use aiven_service_get to verify before deploying.'
      ),

    app_env_key: z
      .string()
      .default('API_URL')
      .describe(
        'Environment variable name for the connected application URL. Default: "API_URL". ' +
          'Only relevant when app_service_name is set.'
      ),

    project_vpc_id: z
      .string()
      .optional()
      .describe(
        'VPC to deploy this application into. Only set when the user explicitly asks to deploy into a VPC. ' +
          'Call aiven_project_vpc_list to list available VPCs, confirm the choice with the user, then pass the ' +
          'project_vpc_id here. If omitted, the deploy sends project_vpc_id: null so the app is not auto-placed ' +
          'into a project VPC.'
      ),

    reasoning: reasoningField,
  })
  // MCP SDK tool inputs must remain root ZodObject schemas. Wrapping this in
  // refine/superRefine turns it into ZodEffects, which tools/list advertises
  // as an empty object. Cross-field VCS validation is done in the handler.
  .strict();

export const redeployApplicationInput = z
  .object({
    project: z.string().describe('Aiven project name'),
    service_name: z.string().describe('Name of the existing application service to redeploy'),
    branch: z
      .string()
      .optional()
      .describe(
        'Git branch or tag to switch to before rebuilding (e.g. "my-feature-branch", "v1.2.3"). ' +
          'If omitted, redeploys from the branch the service is currently configured on.'
      ),
    reasoning: reasoningField,
  })
  .strict();

export const vcsIntegrationInitializeInput = z
  .object({
    organization_id: z
      .string()
      .describe(
        'Aiven organization ID. Use aiven_project_list to obtain the organization_id associated with a project in the target organization.'
      ),
    reasoning: reasoningField,
  })
  .strict();

export const vcsIntegrationListInput = z
  .object({
    organization_id: z
      .string()
      .describe(
        'Aiven organization ID. Use aiven_project_list to obtain the organization_id associated with a project in the target organization.'
      ),
    reasoning: reasoningField,
  })
  .strict();

export const vcsIntegrationRepositoryListInput = z
  .object({
    organization_id: z
      .string()
      .describe(
        'Organization ID returned by aiven_vcs_integration_list. Use that tool first to obtain this value.'
      ),
    vcs_integration_id: z
      .string()
      .describe('VCS integration ID returned by aiven_vcs_integration_list (e.g. "vcs-abc123").'),
    reasoning: reasoningField,
  })
  .strict();

const vcsIntegrationRepositoryInput = {
  organization_id: z
    .string()
    .describe(
      'Organization ID returned by aiven_vcs_integration_list. Use that tool first to obtain this value.'
    ),
  vcs_integration_id: z
    .string()
    .describe('VCS integration ID returned by aiven_vcs_integration_list (e.g. "vcs-abc123").'),
  remote_repository_id: z
    .string()
    .describe('Repository ID returned by aiven_vcs_integration_repository_list.'),
};

export const vcsIntegrationRepositoryBranchListInput = z
  .object({
    ...vcsIntegrationRepositoryInput,
    reasoning: reasoningField,
  })
  .strict();

const vcsIntegrationRepositoryRefInput = {
  ...vcsIntegrationRepositoryInput,
  commit_sha: z
    .string()
    .describe(
      'Commit SHA returned for the selected branch by aiven_vcs_integration_repository_branch_list.'
    ),
};

export const vcsIntegrationRepositoryContainerManifestFilesListInput = z
  .object({
    ...vcsIntegrationRepositoryRefInput,
    reasoning: reasoningField,
  })
  .strict();

export const vcsIntegrationRepositoryScanContainerManifestInput = z
  .object({
    ...vcsIntegrationRepositoryRefInput,
    repository_url: z
      .string()
      .describe('Repository source URL returned by aiven_vcs_integration_repository_list.'),
    branch: z.string().describe('Branch containing the selected commit.'),
    file_path: z
      .string()
      .describe(
        'Candidate path returned by aiven_vcs_integration_repository_container_manifest_files_list.'
      ),
    reasoning: reasoningField,
  })
  .strict();
