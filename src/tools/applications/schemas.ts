import { z } from 'zod';

const environmentVariableItem = z.object({
  key: z.string().describe('Environment variable name (e.g. NODE_ENV, API_KEY)'),
  value: z.string().describe('Environment variable value'),
  kind: z
    .enum(['variable', 'secret'])
    .default('variable')
    .describe('variable = visible in UI, secret = masked in UI. Use secret for tokens, passwords, URIs.'),
});

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
        'Public Git repository HTTPS URL (e.g. https://github.com/user/repo). ' +
          'The repository must already exist with all code pushed to the target branch. ' +
          'Do NOT push code on behalf of the user — ask them to push first.'
      ),

    branch: z
      .string()
      .default('main')
      .describe('Git branch to deploy from. Default: main.'),

    build_path: z
      .string()
      .default('.')
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
      .default('free-10-256')
      .describe(
        'Service plan. Default: "free-10-256" (free tier: shared CPU, 256MB RAM). ' +
          'Use aiven_service_type_plans with service_type="application" to list available plans.'
      ),

    cloud: z
      .string()
      .default('aws-eu-west-1')
      .describe(
        'Cloud region for deployment. Always use the default "aws-eu-west-1" unless the user explicitly requests a different region.'
      ),

    environment_variables: z
      .array(environmentVariableItem)
      .optional()
      .describe(
        'Additional environment variables to inject into the running container. ' +
          'Do NOT include DATABASE_URL or PROJECT_CA_CERT here if using pg_service_name — those are auto-injected. ' +
          'Common additions: NODE_ENV=production, PORT (matching the port param).'
      ),

    pg_service_name: z
      .string()
      .optional()
      .describe(
        'Name of an EXISTING Aiven PostgreSQL service in the same project. ' +
          'When set, two env vars are auto-injected into the container:\n' +
          '  1. DATABASE_URL (or custom pg_env_key) — full postgres:// connection URI with SSL params\n' +
          '  2. PROJECT_CA_CERT — the project CA certificate, BASE64-ENCODED\n\n' +
          'CRITICAL: The application code MUST base64-decode PROJECT_CA_CERT before using it for SSL. ' +
          'Example (Node.js): Buffer.from(process.env.PROJECT_CA_CERT, "base64").toString()\n' +
          'Example (Python): base64.b64decode(os.environ["PROJECT_CA_CERT"]).decode()\n\n' +
          'The PG service must be in RUNNING state. Use aiven_service_get to verify before deploying.'
      ),

    pg_env_key: z
      .string()
      .default('DATABASE_URL')
      .describe(
        'Environment variable name for the PostgreSQL connection URI. Default: "DATABASE_URL". ' +
          'Only relevant when pg_service_name is set.'
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
  })
  .strict();
