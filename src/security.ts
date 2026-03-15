export const REDACTED_PLACEHOLDER = '[REDACTED]';

export const REDACTED_FIELDS = new Set([
  'password', 'access_key', 'access_secret', 'secret_key', 'api_key',
  'token', 'auth_token', 'private_key', 'client_secret',
  'connection_uri', 'service_uri', 'postgres_uri', 'kafka_uri',
  'redis_uri', 'opensearch_uri', 'mysql_uri', 'connection_string',
  'sasl_password', 'keystore_password', 'truststore_password',
  'ca_cert', 'client_cert', 'client_key', 'ssl_cert', 'ssl_key', 'certificate',
]);

const REDACTED_KEY = /(?:^|\.)(password|token|secret|api_key|access_key|access_secret|secret_key|auth_token|private_key|client_secret|connection_string|sasl_password|keystore_password|truststore_password|.*_uri|.*_url|ca_cert|client_cert|client_key|ssl_cert|ssl_key|certificate|.*_cert|.*_key|.*_ca|.*_certificate|.*_pem)$/i;
const SENSITIVE_VALUE = /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----|^[a-z]+:\/\/[^:]+:[^@]+@/i;

export function redactSensitiveData<T>(data: T): T {
  if (data == null) return data;
  if (typeof data === 'string') {
    return (SENSITIVE_VALUE.test(data) ? REDACTED_PLACEHOLDER : data) as T;
  }
  if (typeof data !== 'object') return data;

  const json = JSON.stringify(data, (key, value: unknown) => {
    if (!key) return value;

    if (REDACTED_KEY.test(key)) return REDACTED_PLACEHOLDER;
    if (typeof value === 'string' && SENSITIVE_VALUE.test(value)) return REDACTED_PLACEHOLDER;

    return value;
  });

  return JSON.parse(json) as T;
}
