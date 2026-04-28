/**
 * AI origin tagging for resources created via mcp-aiven.
 *
 * Every Aiven service created through this server is tagged with `origin`
 * so resources can be filtered by their AI source. The same key is intended
 * to be reused by other AI-driven Aiven tooling (skills bundle, future MCPs)
 * with different values (e.g. `skill-cli`, `skill-mcp`).
 *
 * Tag constraints (see `aiven-core/aiven/web/schema.py`):
 *   - Key matches `^[a-zA-Z][a-zA-Z0-9_-]*(:[a-zA-Z][a-zA-Z0-9_-]*)?$`,
 *     length 1-64. The `aiven:` namespace is forbidden.
 *   - Value is a string up to 64 chars.
 *   - At most 25 tags per resource.
 */

export const AI_ORIGIN_TAG_KEY = 'origin';
export const AI_ORIGIN_TAG_VALUE = 'mcp-aiven';

/**
 * Returns a new request body with `tags['origin']` set to the configured
 * AI origin value. Existing tags are preserved, and a caller-supplied
 * `origin` value is never overwritten.
 */
export function withOriginTag(
  body: Record<string, unknown>
): Record<string, unknown> {
  const existing = (body['tags'] as Record<string, string> | undefined) ?? {};
  if (AI_ORIGIN_TAG_KEY in existing) return body;
  return {
    ...body,
    tags: { ...existing, [AI_ORIGIN_TAG_KEY]: AI_ORIGIN_TAG_VALUE },
  };
}
