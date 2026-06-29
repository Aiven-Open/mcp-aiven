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
// NOTE: the URI branch is intentionally NOT ^-anchored — secrets frequently appear
// mid-string (e.g. "error connecting to postgres://user:pass@host/db" in log lines).
// `\s` in the password class stops a match from greedily spanning whitespace.
const SENSITIVE_VALUE = /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----|[a-z]+:\/\/[^:\s]+:[^@\s]+@/i;

const SCRUB_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  {
    pattern: /-----BEGIN [A-Z ]*CERTIFICATE-----[\s\S]*?-----END [A-Z ]*CERTIFICATE-----/g,
    replacement: '[REDACTED_CERTIFICATE]',
  },
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_KEY]',
  },
  {
    pattern: /[a-z]+:\/\/[^:]+:[^@\s]+@[^\s'"]+/gi,
    replacement: '[REDACTED_URI]',
  },
];

export function scrubSensitiveValues(value: string): string {
  let result = value;
  for (const { pattern, replacement } of SCRUB_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Only redact a candidate digit run if it is a plausible Luhn-valid card number.
function replaceCardCandidate(match: string): string {
  const digits = match.replace(/[^0-9]/g, '');
  return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? '[REDACTED_CARD]' : match;
}

// Only redact a dotted-quad if every octet is a valid IPv4 octet.
function replaceIpCandidate(match: string): string {
  return match.split('.').every((octet) => Number(octet) <= 255) ? '[REDACTED_IP]' : match;
}

// Only redact a long token if it mixes character classes and is high-entropy,
// so ordinary long words or repeated characters are left intact.
function replaceSecretCandidate(match: string): string {
  const mixed = /[A-Za-z]/.test(match) && /[0-9+/=_-]/.test(match);
  return mixed && shannonEntropy(match) >= 3.5 ? '[REDACTED_SECRET]' : match;
}

// Substring-level scrubbers for free-text (the model-generated `reasoning` field),
// where secrets/PII appear embedded in prose rather than as a whole-string value.
// Ordered most-specific first so structured secrets are consumed before the
// broad high-entropy pass. Each entry may use a callback to add a false-positive guard.
const REASONING_SCRUB_PATTERNS: { pattern: RegExp; replacement: string | ((match: string) => string) }[] = [
  {
    pattern: /-----BEGIN [A-Z ]*CERTIFICATE-----[\s\S]*?-----END [A-Z ]*CERTIFICATE-----/g,
    replacement: '[REDACTED_CERTIFICATE]',
  },
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_KEY]',
  },
  {
    pattern: /[a-z][a-z0-9+.-]*:\/\/[^:/\s]+:[^@\s]+@[^\s'"]+/gi,
    replacement: '[REDACTED_URI]',
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replacement: '[REDACTED_JWT]',
  },
  {
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    pattern:
      /\b(?:AVNS_[A-Za-z0-9_-]{8,}|aivenv1_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,})\b/g,
    replacement: '[REDACTED_TOKEN]',
  },
  {
    // Bounded quantifiers only; linear-time despite the unsafe-regex heuristic.
    // eslint-disable-next-line security/detect-unsafe-regex
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    replacement: replaceCardCandidate,
  },
  {
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    replacement: '[REDACTED_UUID]',
  },
  {
    // Bounded quantifiers only; linear-time despite the unsafe-regex heuristic.
    // eslint-disable-next-line security/detect-unsafe-regex
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: replaceIpCandidate,
  },
  {
    pattern: /[A-Za-z0-9+/=_-]{25,}/g,
    replacement: replaceSecretCandidate,
  },
];

// Scrubs secrets and PII embedded anywhere within free text. Unlike
// `redactSensitiveData`, this operates at the substring level and is intended
// for the untrusted `reasoning` field that is forwarded to analytics storage.
export function scrubReasoning(value: string): string {
  let result = value;
  for (const { pattern, replacement } of REASONING_SCRUB_PATTERNS) {
    result =
      typeof replacement === 'string'
        ? result.replace(pattern, replacement)
        : result.replace(pattern, replacement);
  }
  return result;
}

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
