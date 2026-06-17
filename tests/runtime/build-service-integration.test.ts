import { describe, it, expect } from 'vitest';
import { buildServiceIntegration } from '../../src/tools/applications/handlers.js';

describe('buildServiceIntegration', () => {
  describe('pg', () => {
    it('produces nested exposed_values with connection_string', () => {
      const result = buildServiceIntegration({
        service_type: 'pg',
        service_name: 'my-pg',
        env_key: 'DATABASE_URL',
      });

      expect(result).toEqual({
        integration_type: 'application_service_credential',
        source_service: 'my-pg',
        user_config: {
          service_type: 'pg',
          exposed_values: {
            connection_string: { environment_variable_key: 'DATABASE_URL' },
          },
        },
      });
    });

    it('uses the provided env_key', () => {
      const result = buildServiceIntegration({
        service_type: 'pg',
        service_name: 'pg-prod',
        env_key: 'PG_CONN_STR',
      });

      expect(result.user_config.exposed_values.connection_string.environment_variable_key).toBe(
        'PG_CONN_STR'
      );
    });
  });

  describe('valkey', () => {
    it('produces nested exposed_values with connection_string', () => {
      const result = buildServiceIntegration({
        service_type: 'valkey',
        service_name: 'my-valkey',
        env_key: 'REDIS_URL',
      });

      expect(result).toEqual({
        integration_type: 'application_service_credential',
        source_service: 'my-valkey',
        user_config: {
          service_type: 'valkey',
          exposed_values: {
            connection_string: { environment_variable_key: 'REDIS_URL' },
          },
        },
      });
    });
  });

  describe('opensearch', () => {
    it('produces nested exposed_values with connection_string', () => {
      const result = buildServiceIntegration({
        service_type: 'opensearch',
        service_name: 'my-os',
        env_key: 'OPENSEARCH_URL',
      });

      expect(result).toEqual({
        integration_type: 'application_service_credential',
        source_service: 'my-os',
        user_config: {
          service_type: 'opensearch',
          exposed_values: {
            connection_string: { environment_variable_key: 'OPENSEARCH_URL' },
          },
        },
      });
    });
  });

  describe('kafka', () => {
    it('produces nested exposed_values with all five credential kinds', () => {
      const result = buildServiceIntegration({
        service_type: 'kafka',
        service_name: 'my-kafka',
        bootstrap_servers_env: 'KAFKA_BOOTSTRAP_SERVER',
        security_protocol_env: 'KAFKA_SECURITY_PROTOCOL',
        access_key_env: 'KAFKA_ACCESS_KEY',
        access_cert_env: 'KAFKA_ACCESS_CERT',
        ca_cert_env: 'KAFKA_CA_CERT',
      });

      expect(result).toEqual({
        integration_type: 'application_service_credential',
        source_service: 'my-kafka',
        user_config: {
          service_type: 'kafka',
          exposed_values: {
            bootstrap_servers: { environment_variable_key: 'KAFKA_BOOTSTRAP_SERVER' },
            security_protocol: { environment_variable_key: 'KAFKA_SECURITY_PROTOCOL' },
            access_key: { environment_variable_key: 'KAFKA_ACCESS_KEY' },
            access_cert: { environment_variable_key: 'KAFKA_ACCESS_CERT' },
            ca_cert: { environment_variable_key: 'KAFKA_CA_CERT' },
          },
        },
      });
    });

    it('uses custom env var names', () => {
      const result = buildServiceIntegration({
        service_type: 'kafka',
        service_name: 'kafka-prod',
        bootstrap_servers_env: 'MY_BROKERS',
        security_protocol_env: 'MY_PROTOCOL',
        access_key_env: 'MY_KEY',
        access_cert_env: 'MY_CERT',
        ca_cert_env: 'MY_CA',
      });

      const ev = result.user_config.exposed_values;
      expect(ev.bootstrap_servers.environment_variable_key).toBe('MY_BROKERS');
      expect(ev.security_protocol.environment_variable_key).toBe('MY_PROTOCOL');
      expect(ev.access_key.environment_variable_key).toBe('MY_KEY');
      expect(ev.access_cert.environment_variable_key).toBe('MY_CERT');
      expect(ev.ca_cert.environment_variable_key).toBe('MY_CA');
    });
  });

  describe('common fields', () => {
    it('always sets integration_type to application_service_credential', () => {
      const types = ['pg', 'valkey', 'opensearch'] as const;
      for (const t of types) {
        const result = buildServiceIntegration({
          service_type: t,
          service_name: `svc-${t}`,
          env_key: 'URL',
        });
        expect(result.integration_type).toBe('application_service_credential');
      }

      const kafka = buildServiceIntegration({
        service_type: 'kafka',
        service_name: 'svc-kafka',
        bootstrap_servers_env: 'A',
        security_protocol_env: 'B',
        access_key_env: 'C',
        access_cert_env: 'D',
        ca_cert_env: 'E',
      });
      expect(kafka.integration_type).toBe('application_service_credential');
    });

    it('passes through source_service from service_name', () => {
      const result = buildServiceIntegration({
        service_type: 'pg',
        service_name: 'exact-service-name',
        env_key: 'URL',
      });
      expect(result.source_service).toBe('exact-service-name');
    });

    it('never includes flat *_environment_variable_name keys', () => {
      const pg = buildServiceIntegration({
        service_type: 'pg',
        service_name: 'pg',
        env_key: 'DB',
      });
      expect(pg.user_config).not.toHaveProperty('connection_string_environment_variable_name');

      const kafka = buildServiceIntegration({
        service_type: 'kafka',
        service_name: 'kafka',
        bootstrap_servers_env: 'A',
        security_protocol_env: 'B',
        access_key_env: 'C',
        access_cert_env: 'D',
        ca_cert_env: 'E',
      });
      expect(kafka.user_config).not.toHaveProperty('bootstrap_servers_environment_variable_name');
      expect(kafka.user_config).not.toHaveProperty('security_protocol_environment_variable_name');
      expect(kafka.user_config).not.toHaveProperty('access_key_environment_variable_name');
      expect(kafka.user_config).not.toHaveProperty('access_cert_environment_variable_name');
      expect(kafka.user_config).not.toHaveProperty('ca_cert_environment_variable_name');
    });
  });
});
