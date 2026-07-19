import { describe, it, expect, vi } from 'vitest';
import type { AivenClient } from '../../src/client.js';
import { buildConnectorConfig } from '../../src/tools/kafka/helpers.js';

const SERVICE_CONN = {
  host: 'pg-host.aiven.io',
  port: '12345',
  user: 'avnadmin',
  password: 'secret-password',
  dbname: 'defaultdb',
};

function createMockClient(): AivenClient {
  const getMock = vi.fn().mockResolvedValue({
    service: { service_uri_params: { ...SERVICE_CONN } },
  });
  return { get: getMock } as unknown as AivenClient;
}

describe('buildConnectorConfig', () => {
  it('forwards config map entries and maps connector_class', async () => {
    const config = await buildConnectorConfig(createMockClient(), {
      project: 'p',
      service_name: 'kafka',
      connector_class: 'io.aiven.kafka.connect.s3.AivenKafkaConnectS3SinkConnector',
      name: 'sink',
      config: { 'topic.prefix': 'cdc', 'flush.size': '1000' },
    });

    expect(config['connector.class']).toBe('io.aiven.kafka.connect.s3.AivenKafkaConnectS3SinkConnector');
    expect(config['name']).toBe('sink');
    expect(config['topic.prefix']).toBe('cdc');
    expect(config['flush.size']).toBe('1000');
    // Routing keys are not forwarded to the connector config
    expect(config['project']).toBeUndefined();
    expect(config['connector_class']).toBeUndefined();
    expect(config['reasoning']).toBeUndefined();
  });

  it('injects connection fields from source_service for postgres connectors', async () => {
    const config = await buildConnectorConfig(createMockClient(), {
      project: 'p',
      service_name: 'kafka',
      connector_class: 'io.debezium.connector.postgresql.PostgresConnector',
      name: 'cdc',
      source_service: 'my-pg',
    });

    expect(config['database.hostname']).toBe('pg-host.aiven.io');
    expect(config['database.port']).toBe(12345);
    expect(config['database.user']).toBe('avnadmin');
    expect(config['database.password']).toBe('secret-password');
    expect(config['database.dbname']).toBe('defaultdb');
  });

  it('rejects the call if the caller also supplies a mapped connection field', async () => {
    await expect(
      buildConnectorConfig(createMockClient(), {
        project: 'p',
        service_name: 'kafka',
        connector_class: 'io.debezium.connector.postgresql.PostgresConnector',
        name: 'cdc',
        source_service: 'my-pg',
        // Attacker-supplied host — must not be combined with injected credentials
        config: { 'database.hostname': 'evil.attacker.com' },
      })
    ).rejects.toThrow(/database\.hostname/);
  });

  it('rejects conflicting JDBC connection fields when source_service is set', async () => {
    await expect(
      buildConnectorConfig(createMockClient(), {
        project: 'p',
        service_name: 'kafka',
        connector_class: 'io.aiven.connect.jdbc.JdbcSourceConnector',
        name: 'jdbc',
        source_service: 'my-pg',
        config: { 'connection.url': 'jdbc:postgresql://evil.attacker.com:5432/db' },
      })
    ).rejects.toThrow(/connection\.url/);
  });

  it('allows caller-supplied connection fields when source_service is omitted', async () => {
    const config = await buildConnectorConfig(createMockClient(), {
      project: 'p',
      service_name: 'kafka',
      connector_class: 'io.debezium.connector.postgresql.PostgresConnector',
      name: 'cdc',
      config: { 'database.hostname': 'my-own-host.example.com', 'database.password': 'my-own-password' },
    });

    expect(config['database.hostname']).toBe('my-own-host.example.com');
    expect(config['database.password']).toBe('my-own-password');
  });
});
