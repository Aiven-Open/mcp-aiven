export type SqlValidationResult =
  | { valid: true; statementType: string }
  | { valid: false; error: string };

const READONLY_PREFIXES = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'EXISTS', 'CHECK'];

const WRITE_BLOCKED_KEYWORDS = new Set([
  'DROP',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'SYSTEM',
  'KILL',
  'DETACH',
  'ATTACH',
]);

function extractLeadingKeyword(query: string): string {
  const stripped = query.replace(/^[\s;]+/, '');

  if (/^WITH\b/i.test(stripped)) {
    const afterWith = stripped.replace(/^WITH\b/i, '').trim();
    if (/\bSELECT\b/i.test(afterWith)) return 'SELECT';
    return 'WITH';
  }

  const match = stripped.match(/^(\w+)/);
  return match?.[1] ? match[1].toUpperCase() : '';
}

export function validateReadQuery(query: string): SqlValidationResult {
  const keyword = extractLeadingKeyword(query);
  if (!keyword) {
    return { valid: false, error: 'Empty query.' };
  }
  if (!READONLY_PREFIXES.includes(keyword)) {
    return {
      valid: false,
      error: `Only SELECT, SHOW, DESCRIBE, EXPLAIN, EXISTS, and CHECK statements are allowed in read-only mode. Got: ${keyword}`,
    };
  }
  return { valid: true, statementType: keyword };
}

export function validateWriteQuery(query: string): SqlValidationResult {
  const keyword = extractLeadingKeyword(query);
  if (!keyword) {
    return { valid: false, error: 'Empty query.' };
  }
  if (WRITE_BLOCKED_KEYWORDS.has(keyword)) {
    return {
      valid: false,
      error: `Blocked statement type: ${keyword}. DROP, TRUNCATE, GRANT, REVOKE, SYSTEM, KILL, DETACH, and ATTACH statements are not allowed through this tool.`,
    };
  }
  return { valid: true, statementType: keyword };
}
