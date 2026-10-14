import { z } from 'zod';

export const applicationServiceEnvironmentVariableKey = z
  .string()
  .min(1)
  .max(512)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_]*$/,
    'Environment variable names must start with a letter and contain only letters, numbers, and underscores'
  )
  .describe(
    "The name of the environment variable in the target service's container where the exposed value from the source service is injected at runtime. Inspect the application source to find the environment-variable names it reads. If it accepts multiple fallback names, choose one explicitly."
  );

const exposedValue = z
  .object({
    environment_variable_key: applicationServiceEnvironmentVariableKey,
  })
  .strict();

const connectionStringExposedValues = z
  .object({
    connection_string: exposedValue.describe(
      'Connection URI exposed to the destination application.'
    ),
  })
  .strict();

const sourceServiceParameters = z
  .object({
    user: z
      .string()
      .max(64)
      .optional()
      .describe(
        "Use this service user's credentials in the connection URI instead of the default avnadmin user."
      ),
    database: z
      .string()
      .max(63)
      .optional()
      .describe(
        "Use this database in the connection URI instead of the service's primary database."
      ),
  })
  .strict();

const emptySourceServiceParameters = z.object({}).strict();

const pgApplicationServiceCredentialUserConfig = z
  .object({
    service_type: z.literal('pg'),
    exposed_values: connectionStringExposedValues,
    source_service_parameters: sourceServiceParameters
      .optional()
      .describe('Optional PostgreSQL user and database overrides.'),
  })
  .strict();

const valkeyApplicationServiceCredentialUserConfig = z
  .object({
    service_type: z.literal('valkey'),
    exposed_values: connectionStringExposedValues,
    source_service_parameters: emptySourceServiceParameters.optional(),
  })
  .strict();

const opensearchApplicationServiceCredentialUserConfig = z
  .object({
    service_type: z.literal('opensearch'),
    exposed_values: connectionStringExposedValues,
    source_service_parameters: emptySourceServiceParameters.optional(),
  })
  .strict();

const kafkaApplicationServiceCredentialUserConfig = z
  .object({
    service_type: z.literal('kafka'),
    exposed_values: z
      .object({
        bootstrap_servers: exposedValue.describe(
          'Kafka bootstrap servers exposed to the destination application.'
        ),
        security_protocol: exposedValue.describe(
          'Kafka security protocol exposed to the destination application.'
        ),
        access_key: exposedValue.describe(
          'Kafka client private key exposed to the destination application.'
        ),
        access_cert: exposedValue.describe(
          'Kafka client certificate exposed to the destination application.'
        ),
        ca_cert: exposedValue.describe(
          'Kafka CA certificate exposed to the destination application.'
        ),
      })
      .strict(),
    source_service_parameters: emptySourceServiceParameters.optional(),
  })
  .strict();

const mysqlApplicationServiceCredentialUserConfig = z
  .object({
    service_type: z.literal('mysql'),
    exposed_values: connectionStringExposedValues,
    source_service_parameters: sourceServiceParameters
      .optional()
      .describe('Optional MySQL user and database overrides.'),
  })
  .strict();

const clickhouseApplicationServiceCredentialUserConfig = z
  .object({
    service_type: z.literal('clickhouse'),
    exposed_values: z
      .object({
        host: exposedValue.describe('ClickHouse host exposed to the destination application.'),
        port: exposedValue.describe('ClickHouse port exposed to the destination application.'),
        user: exposedValue.describe('ClickHouse user exposed to the destination application.'),
        password: exposedValue.describe(
          'ClickHouse password exposed to the destination application.'
        ),
        database: exposedValue.describe(
          'ClickHouse database exposed to the destination application.'
        ),
        secure: exposedValue.describe(
          'Whether to use a secure (TLS) ClickHouse connection, exposed to the destination application.'
        ),
      })
      .strict(),
    source_service_parameters: emptySourceServiceParameters.optional(),
  })
  .strict();

export const applicationServiceCredentialUserConfig = z
  .discriminatedUnion('service_type', [
    pgApplicationServiceCredentialUserConfig,
    valkeyApplicationServiceCredentialUserConfig,
    kafkaApplicationServiceCredentialUserConfig,
    opensearchApplicationServiceCredentialUserConfig,
    mysqlApplicationServiceCredentialUserConfig,
    clickhouseApplicationServiceCredentialUserConfig,
  ])
  .describe(
    'Typed configuration for an application_service_credential integration from a PostgreSQL, MySQL, ClickHouse, Valkey, Kafka, or OpenSearch service to an application.'
  );

export type ApplicationServiceCredentialUserConfig = z.infer<
  typeof applicationServiceCredentialUserConfig
>;
