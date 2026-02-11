/**
 * Security: sensitive data patterns and redaction utilities
 * Removes sensitive data from API responses before returning to AI agents
 */

export const REDACTED_FIELDS = new Set([
  'password',
  'access_key',
  'access_secret',
  'secret_key',
  'api_key',
  'token',
  'auth_token',
  'private_key',
  'client_secret',
  'connection_uri',
  'service_uri',
  'postgres_uri',
  'kafka_uri',
  'redis_uri',
  'opensearch_uri',
  'mysql_uri',
  'connection_string',
  'sasl_password',
  'keystore_password',
  'truststore_password',
]);

export const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /^postgres(ql)?:\/\/[^:]+:[^@]+@.*/i,
  /^kafka:\/\/[^:]+:[^@]+@.*/i,
  /^redis:\/\/[^:]+:[^@]+@.*/i,
  /^mysql:\/\/[^:]+:[^@]+@.*/i,
  /^https?:\/\/[^:]+:[^@]+@.*/i,
  /^[a-z]+:\/\/[^:]+:[^@]+@.*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /-----BEGIN [A-Z ]*CERTIFICATE-----/,
];

export const MASKED_FIELDS = new Set([
  'ca_cert',
  'client_cert',
  'client_key',
  'ssl_cert',
  'ssl_key',
  'certificate',
]);

const REDACTED_SUFFIXES = ['_uri', '_url'];
const MASKED_SUFFIXES = ['_cert', '_key', '_ca', '_certificate', '_pem'];

export const REDACTED_PLACEHOLDER = '[REDACTED]';

export const MASKED_PLACEHOLDER = '***';

export function redactSensitiveData<T>(data: T): T {
  if (data == null) return data;
  if (typeof data === 'string') return redactString(data) as T;
  if (Array.isArray(data)) return data.map((item) => redactSensitiveData(item)) as T;
  if (typeof data === 'object') return redactObject(data as Record<string, unknown>) as T;

  return data;
}

function redactString(value: string): string {
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    if (pattern.test(value)) {
      return REDACTED_PLACEHOLDER;
    }
  }
  return value;
}

function lastSegment(key: string): string {
  const dot = key.lastIndexOf('.');
  return dot === -1 ? key : key.slice(dot + 1);
}

function isRedactedKey(lowerKey: string): boolean {
  const segment = lastSegment(lowerKey);
  return (
    REDACTED_FIELDS.has(lowerKey) ||
    REDACTED_FIELDS.has(segment) ||
    REDACTED_SUFFIXES.some((s) => lowerKey.endsWith(s))
  );
}

function isMaskedKey(lowerKey: string): boolean {
  const segment = lastSegment(lowerKey);
  return (
    MASKED_FIELDS.has(lowerKey) ||
    MASKED_FIELDS.has(segment) ||
    MASKED_SUFFIXES.some((s) => lowerKey.endsWith(s))
  );
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    if (isRedactedKey(lowerKey)) {
      // eslint-disable-next-line security/detect-object-injection
      result[key] = REDACTED_PLACEHOLDER;
    } else if (isMaskedKey(lowerKey) && typeof value === 'string') {
      // eslint-disable-next-line security/detect-object-injection
      result[key] = maskValue(value);
    } else {
      // eslint-disable-next-line security/detect-object-injection
      result[key] = redactSensitiveData(value);
    }
  }

  return result;
}

function maskValue(value: string): string {
  if (value.length <= 10) {
    return MASKED_PLACEHOLDER;
  }
  return `${value.slice(0, 4)}${MASKED_PLACEHOLDER}${value.slice(-4)}`;
}
