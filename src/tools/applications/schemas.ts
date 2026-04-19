import { z } from 'zod';

const environmentVariableItem = z.object({
  key: z.string().describe('Environment variable name (e.g. NODE_ENV, API_KEY)'),
  value: z.string().describe('Environment variable value'),
  kind: z
    .enum(['variable', 'secret'])
    .default('variable')
    .describe('variable = visible in UI, secret = masked in UI. Use secret for tokens, passwords, URIs.'),
});

/**
 * One entry in service_integrations. The platform uses these to automatically inject
 * credentials into the running container as environment variables — no manual copy-paste
 * of connection strings needed, and no app code changes required.
 *
 * Set env var names to match what your application already reads.
 *
 * Supported service_type values (must be an existing service in the same project):
 *   - "pg"          → injects a postgres:// connection URI
 *   - "valkey"      → injects a redis:// connection URI
 *   - "opensearch"  → injects an https:// connection URI
 *   - "kafka"       → injects bootstrap servers + SSL certificates (raw PEM strings)
 */
export const serviceIntegrationItem = z.discriminatedUnion('service_type', [
  z.object({
    service_type: z.literal('pg'),
    service_name: z
      .string()
      .describe('Name of the existing Aiven PostgreSQL service in the same project (must be RUNNING).'),
    env_key: z
      .string()
      .default('DATABASE_URL')
      .describe(
        'Env var your app reads for the PostgreSQL connection URI (full postgres:// URI with SSL params). ' +
          'Set to match your app — do not change your app code to fit the default. Default: "DATABASE_URL".'
      ),
  }),

  z.object({
    service_type: z.literal('valkey'),
    service_name: z
      .string()
      .describe('Name of the existing Aiven Valkey service in the same project (must be RUNNING).'),
    env_key: z
      .string()
      .default('REDIS_URL')
      .describe(
        'Env var your app reads for the Valkey connection URI (redis:// URI). ' +
          'Set to match your app — do not change your app code to fit the default. Default: "REDIS_URL".'
      ),
  }),

  z.object({
    service_type: z.literal('opensearch'),
    service_name: z
      .string()
      .describe('Name of the existing Aiven OpenSearch service in the same project (must be RUNNING).'),
    env_key: z
      .string()
      .default('OPENSEARCH_URL')
      .describe(
        'Env var your app reads for the OpenSearch connection URI (https:// URI). ' +
          'Set to match your app — do not change your app code to fit the default. Default: "OPENSEARCH_URL".'
      ),
  }),

  z.object({
    service_type: z.literal('kafka'),
    service_name: z
      .string()
      .describe('Name of the existing Aiven Kafka service in the same project (must be RUNNING).'),
    bootstrap_servers_env: z
      .string()
      .default('KAFKA_BOOTSTRAP_SERVER')
      .describe(
        'Env var your app reads for Kafka bootstrap servers (comma-separated host:port). ' +
          'Set to match your app. Default: "KAFKA_BOOTSTRAP_SERVER".'
      ),
    security_protocol_env: z
      .string()
      .default('KAFKA_SECURITY_PROTOCOL')
      .describe(
        'Env var your app reads for the security protocol (value will be "SSL"). ' +
          'Set to match your app. Default: "KAFKA_SECURITY_PROTOCOL".'
      ),
    access_key_env: z
      .string()
      .default('KAFKA_ACCESS_KEY')
      .describe(
        'Env var your app reads for the SSL client private key (raw PEM string, NOT base64). ' +
          'Set to match your app. Default: "KAFKA_ACCESS_KEY".'
      ),
    access_cert_env: z
      .string()
      .default('KAFKA_ACCESS_CERT')
      .describe(
        'Env var your app reads for the SSL client certificate (raw PEM string, NOT base64). ' +
          'Set to match your app. Default: "KAFKA_ACCESS_CERT".'
      ),
    ca_cert_env: z
      .string()
      .default('KAFKA_CA_CERT')
      .describe(
        'Env var your app reads for the CA certificate (raw PEM string, NOT base64). ' +
          'Set to match your app. Default: "KAFKA_CA_CERT".'
      ),
  }),
]);

export type ServiceIntegrationInput = z.infer<typeof serviceIntegrationItem>;

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
        'VCS integration ID for private repository access. ' +
          'Auto-resolved via aiven_vcs_integration_list + aiven_vcs_integration_repository_list — do NOT ask the user for this value.'
      ),

    remote_repository_id: z
      .string()
      .optional()
      .describe(
        'Repository ID within the VCS integration. ' +
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
        'Path within the repository where the Dockerfile is located. ' +
          'Default: "." (repository root). Use a subdirectory if the Dockerfile is not at the root (e.g. "./backend").'
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
        'Aiven services to connect to this application. The platform automatically injects credentials ' +
          'as environment variables — no manual connection strings needed, and your app code does not need to change. ' +
          'Set env var names to match what your application already reads.\n\n' +
          'Supported service types: "pg", "valkey", "opensearch", "kafka".\n' +
          'Each service must already exist in the same project and be in RUNNING state (verify with aiven_service_get).\n\n' +
          'Example — connect to Postgres and Kafka:\n' +
          '  service_integrations: [\n' +
          '    { service_type: "pg", service_name: "my-pg", env_key: "DATABASE_URL" },\n' +
          '    { service_type: "kafka", service_name: "my-kafka", bootstrap_servers_env: "KAFKA_BROKERS" }\n' +
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
        'VPC to deploy this application into. Normally omit this — the backend auto-selects the VPC ' +
          'when the project has exactly one active VPC in the target cloud. ' +
          'Only provide this if the API returns a CONFLICT error saying the project has multiple VPCs ' +
          'and you must specify one. In that case, call aiven_project_vpc_list to list available VPCs ' +
          'and ask the user which to use.'
      ),
  })
  .strict();

export const redeployApplicationInput = z
  .object({
    project: z.string().describe('Aiven project name'),
    service_name: z.string().describe('Name of the existing application service to redeploy'),
  })
  .strict();

export const vcsIntegrationListInput = z
  .object({
    project: z
      .string()
      .describe(
        'Aiven project name. The organization_id is resolved internally from this project.'
      ),
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
      .describe(
        'VCS integration ID returned by aiven_vcs_integration_list (e.g. "vcs-abc123").'
      ),
  })
  .strict();
