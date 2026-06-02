export const REDACTED_PLACEHOLDER = '[REDACTED]';
export const REDACTED_PASSWORD_PLACEHOLDER = '<REDACTED_PASSWORD>';

const URI_WITH_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^:/?#@\s]+:)([^/?#\s'"]+)(@[^/?#@\s'"]+)/gi;

export function maskUriPassword(value: string): string {
  return value.replace(URI_WITH_PASSWORD, `$1${REDACTED_PASSWORD_PLACEHOLDER}$3`);
}

export const REDACTED_FIELDS = new Set([
  'password', 'access_key', 'access_secret', 'secret_key', 'api_key',
  'token', 'auth_token', 'private_key', 'client_secret',
  'connection_uri', 'service_uri', 'postgres_uri', 'kafka_uri',
  'redis_uri', 'opensearch_uri', 'mysql_uri', 'connection_string',
  'sasl_password', 'keystore_password', 'truststore_password',
  'ca_cert', 'client_cert', 'client_key', 'ssl_cert', 'ssl_key', 'certificate',
]);

const REDACTED_KEY = /(?:^|\.)(password|token|secret|api_key|access_key|access_secret|secret_key|auth_token|private_key|client_secret|connection_string|sasl_password|keystore_password|truststore_password|.*_uri|.*_url|ca_cert|client_cert|client_key|ssl_cert|ssl_key|certificate|.*_cert|.*_key|.*_ca|.*_certificate|.*_pem)$/i;

const CERT_OR_KEY_BLOB = /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/i;
const URI_WITH_CREDENTIALS = /[a-z][a-z0-9+.-]*:\/\/[^:/@\s]+:[^@\s]+@/i;

const SCRUB_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  {
    pattern: /-----BEGIN [A-Z ]*CERTIFICATE-----[\s\S]*?-----END [A-Z ]*CERTIFICATE-----/g,
    replacement: '[REDACTED_CERTIFICATE]',
  },
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_KEY]',
  },
];

export function scrubSensitiveValues(value: string): string {
  let result = value;
  for (const { pattern, replacement } of SCRUB_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return maskUriPassword(result);
}

export function redactSensitiveData<T>(data: T): T {
  if (data == null) return data;
  if (typeof data === 'string') {
    if (CERT_OR_KEY_BLOB.test(data)) return REDACTED_PLACEHOLDER as T;
    return maskUriPassword(data) as T;
  }
  if (typeof data !== 'object') return data;

  const json = JSON.stringify(data, (key, value: unknown) => {
    if (!key) return value;

    if (typeof value === 'string' && URI_WITH_CREDENTIALS.test(value)) {
      return maskUriPassword(value);
    }
    if (REDACTED_KEY.test(key)) return REDACTED_PLACEHOLDER;
    if (typeof value === 'string' && CERT_OR_KEY_BLOB.test(value)) return REDACTED_PLACEHOLDER;

    return value;
  });

  return JSON.parse(json) as T;
}
