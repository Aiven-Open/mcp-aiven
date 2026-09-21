import { describe, expect, it } from 'vitest';
import { applicationServiceCredentialUserConfig } from '../../src/tools/integrations/schemas.js';

const connectionStringConfigs = [
  {
    service_type: 'pg',
    exposed_values: {
      connection_string: { environment_variable_key: 'DATABASE_URL' },
    },
    source_service_parameters: {
      user: 'app_user',
      database: 'app_database',
    },
  },
  {
    service_type: 'valkey',
    exposed_values: {
      connection_string: { environment_variable_key: 'VALKEY_URL' },
    },
  },
  {
    service_type: 'opensearch',
    exposed_values: {
      connection_string: { environment_variable_key: 'OPENSEARCH_URL' },
    },
  },
] as const;

const kafkaConfig = {
  service_type: 'kafka',
  exposed_values: {
    bootstrap_servers: { environment_variable_key: 'KAFKA_BROKERS' },
    security_protocol: { environment_variable_key: 'KAFKA_PROTOCOL' },
    access_key: { environment_variable_key: 'KAFKA_SSL_KEY' },
    access_cert: { environment_variable_key: 'KAFKA_SSL_CERT' },
    ca_cert: { environment_variable_key: 'KAFKA_SSL_CA_CERT' },
  },
} as const;

describe('applicationServiceCredentialUserConfig', () => {
  it.each([...connectionStringConfigs, kafkaConfig])(
    'accepts an explicit $service_type configuration without adding defaults',
    (config) => {
      expect(applicationServiceCredentialUserConfig.parse(config)).toEqual(config);
    }
  );

  it.each(['valkey', 'kafka', 'opensearch'] as const)(
    'accepts empty source_service_parameters for $service_type as defined by the API',
    (serviceType) => {
      const config = [...connectionStringConfigs, kafkaConfig].find(
        (candidate) => candidate.service_type === serviceType
      );

      expect(
        applicationServiceCredentialUserConfig.safeParse({
          ...config,
          source_service_parameters: {},
        }).success
      ).toBe(true);
    }
  );

  it.each(connectionStringConfigs)(
    'requires the $service_type connection-string mapping',
    (config) => {
      expect(
        applicationServiceCredentialUserConfig.safeParse({
          ...config,
          exposed_values: {},
        }).success
      ).toBe(false);
    }
  );

  it.each(Object.keys(kafkaConfig.exposed_values))('requires the Kafka %s mapping', (key) => {
    const exposedValues = { ...kafkaConfig.exposed_values };
    delete exposedValues[key as keyof typeof exposedValues];

    expect(
      applicationServiceCredentialUserConfig.safeParse({
        ...kafkaConfig,
        exposed_values: exposedValues,
      }).success
    ).toBe(false);
  });

  it.each(['_DATABASE_URL', '1DATABASE_URL', 'DATABASE-URL', 'DATABASE.URL'])(
    'rejects invalid environment variable name %s',
    (environmentVariableKey) => {
      expect(
        applicationServiceCredentialUserConfig.safeParse({
          service_type: 'pg',
          exposed_values: {
            connection_string: { environment_variable_key: environmentVariableKey },
          },
        }).success
      ).toBe(false);
    }
  );

  it('rejects unexpected configuration fields', () => {
    expect(
      applicationServiceCredentialUserConfig.safeParse({
        ...kafkaConfig,
        password: 'not-allowed',
      }).success
    ).toBe(false);
  });
});
