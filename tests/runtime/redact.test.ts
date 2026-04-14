import { describe, it, expect } from 'vitest';
import {
  redactSensitiveData,
  REDACTED_PLACEHOLDER,
  REDACTED_FIELDS,
} from '../../src/security.js';

describe('redactSensitiveData', () => {
  it('should redact password fields', () => {
    const input = { password: 'secret123', username: 'admin' };
    const result = redactSensitiveData(input);

    expect(result.password).toBe(REDACTED_PLACEHOLDER);
    expect(result.username).toBe('admin');
  });

  it('should redact api_key fields', () => {
    const input = { api_key: 'aivenv1_abc123', name: 'test' };
    const result = redactSensitiveData(input);

    expect(result.api_key).toBe(REDACTED_PLACEHOLDER);
    expect(result.name).toBe('test');
  });

  it('should redact connection_uri fields', () => {
    const input = { connection_uri: 'postgres://user:pass@host:5432/db' };
    const result = redactSensitiveData(input);

    expect(result.connection_uri).toBe(REDACTED_PLACEHOLDER);
  });

  it('should redact postgres URIs in string values', () => {
    const input = { uri: 'postgres://user:pass@host:5432/db' };
    const result = redactSensitiveData(input);

    expect(result.uri).toBe(REDACTED_PLACEHOLDER);
  });

  it('should redact kafka URIs in string values', () => {
    const input = { uri: 'kafka://user:pass@host:9092' };
    const result = redactSensitiveData(input);

    expect(result.uri).toBe(REDACTED_PLACEHOLDER);
  });

  it('should redact certificate fields', () => {
    const input = {
      ca_cert: '-----BEGIN CERTIFICATE-----\nLongCertContent\n-----END CERTIFICATE-----',
    };
    const result = redactSensitiveData(input);

    expect(result.ca_cert).toBe(REDACTED_PLACEHOLDER);
  });

  it('should handle nested objects', () => {
    const input = {
      service: {
        name: 'my-service',
        credentials: {
          password: 'secret',
          username: 'admin',
        },
      },
    };
    const result = redactSensitiveData(input);

    expect(result.service.name).toBe('my-service');
    expect(result.service.credentials.password).toBe(REDACTED_PLACEHOLDER);
    expect(result.service.credentials.username).toBe('admin');
  });

  it('should handle arrays', () => {
    const input = {
      users: [
        { name: 'user1', password: 'pass1' },
        { name: 'user2', password: 'pass2' },
      ],
    };
    const result = redactSensitiveData(input);

    expect(result.users[0]?.name).toBe('user1');
    expect(result.users[0]?.password).toBe(REDACTED_PLACEHOLDER);
    expect(result.users[1]?.name).toBe('user2');
    expect(result.users[1]?.password).toBe(REDACTED_PLACEHOLDER);
  });

  it('should handle null and undefined', () => {
    expect(redactSensitiveData(null)).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    const result = redactSensitiveData(undefined);
    expect(result).toBeUndefined();
  });

  it('should preserve non-sensitive fields', () => {
    const input = {
      service_name: 'my-pg',
      state: 'RUNNING',
      plan: 'business-8',
      cloud_name: 'google-us-east1',
    };
    const result = redactSensitiveData(input);

    expect(result).toEqual(input);
  });
});

describe('sensitive field patterns', () => {
  it('should identify known sensitive field names', () => {
    expect(REDACTED_FIELDS.has('password')).toBe(true);
    expect(REDACTED_FIELDS.has('api_key')).toBe(true);
    expect(REDACTED_FIELDS.has('connection_uri')).toBe(true);
  });

  it('should identify certificate fields as redacted', () => {
    expect(REDACTED_FIELDS.has('ca_cert')).toBe(true);
    expect(REDACTED_FIELDS.has('client_key')).toBe(true);
  });

  it('should not include non-sensitive fields', () => {
    expect(REDACTED_FIELDS.has('username')).toBe(false);
    expect(REDACTED_FIELDS.has('service_name')).toBe(false);
    expect(REDACTED_FIELDS.has('plan')).toBe(false);
  });

  it('should redact sensitive URIs in values via redactSensitiveData', () => {
    // Test via behavior rather than directly calling removed helpers
    expect(redactSensitiveData('postgres://user:pass@host:5432/db')).toBe(REDACTED_PLACEHOLDER);
    expect(redactSensitiveData('postgresql://admin:secret@localhost/mydb')).toBe(
      REDACTED_PLACEHOLDER
    );
    expect(redactSensitiveData('kafka://user:pass@host:9092')).toBe(REDACTED_PLACEHOLDER);
    expect(redactSensitiveData('https://user:pass@api.example.com')).toBe(REDACTED_PLACEHOLDER);
  });

  it('should not redact URLs without credentials', () => {
    expect(redactSensitiveData('https://api.aiven.io/v1/project')).toBe(
      'https://api.aiven.io/v1/project'
    );
    expect(redactSensitiveData('https://example.com')).toBe('https://example.com');
  });

  it('should not redact regular strings', () => {
    expect(redactSensitiveData('hello world')).toBe('hello world');
    expect(redactSensitiveData('my-service-name')).toBe('my-service-name');
  });

  it('should redact dot-notation keys like database.password', () => {
    const input = {
      'connector.class': 'io.debezium.connector.postgresql.PostgresConnector',
      'database.hostname': 'pg-host.aivencloud.com',
      'database.port': '5432',
      'database.user': 'avnadmin',
      'database.password': 'AVNS_secret123',
      'database.dbname': 'defaultdb',
      'topic.prefix': 'cdc',
    };
    const result = redactSensitiveData(input) as Record<string, unknown>;

    expect(result['database.password']).toBe(REDACTED_PLACEHOLDER);
    expect(result['database.hostname']).toBe('pg-host.aivencloud.com');
    expect(result['database.port']).toBe('5432');
    expect(result['connector.class']).toBe('io.debezium.connector.postgresql.PostgresConnector');
  });

  it('should redact dot-notation keys like connection.password', () => {
    const input = {
      'connection.user': 'admin',
      'connection.password': 'secret',
      'connection.url': 'jdbc:postgresql://host:5432/db',
    };
    const result = redactSensitiveData(input) as Record<string, unknown>;

    expect(result['connection.password']).toBe(REDACTED_PLACEHOLDER);
    expect(result['connection.user']).toBe('admin');
  });
});
