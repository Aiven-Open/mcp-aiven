const DEFAULT_MAX_CHARS = 100_000;

export function getMaxToolResultChars(): number {
  const raw = process.env['MCP_MAX_TOOL_RESULT_CHARS'];
  if (raw === undefined || raw === '') return DEFAULT_MAX_CHARS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_MAX_CHARS;
  if (n <= 0) return 0;
  return n;
}

function trimSuffix(originalLength: number, limit: number): string {
  return (
    `\n\n---\n**Trimmed:** This response was cut because it exceeded the maximum tool output size ` +
    `(${originalLength} characters; cap ${limit} from MCP_MAX_TOOL_RESULT_CHARS). ` +
    `Only the beginning of the payload is included—the rest was omitted. ` +
    `If this was JSON, the tail may be incomplete. Narrow the request or raise the cap if needed.`
  );
}

/**
 * If over cap, returns a prefix of `text` plus a trim notice so total length ≤ `limit`.
 * Logs to stderr (safe for stdio MCP: protocol uses stdout). No-op when under cap or uncapped.
 */
export function applyToolResultCharCap(text: string): string {
  const limit = getMaxToolResultChars();
  if (limit <= 0 || text.length <= limit) return text;

  const suffix = trimSuffix(text.length, limit);
  let headLen = limit - suffix.length;

  if (headLen < 0) {
    const minimal = `\n… [mcp-aiven: trimmed ${String(text.length)}→${String(limit)} chars]`;
    headLen = limit - minimal.length;
    if (headLen <= 0) {
      console.error(
        'mcp-aiven: Tool result trim: cap %d too small for payload of %d chars; returning truncated notice only',
        limit,
        text.length
      );
      return minimal.slice(0, limit);
    }
    const out = text.slice(0, headLen) + minimal;
    console.error(
      'mcp-aiven: Tool result trimmed: %d -> %d chars (MCP_MAX_TOOL_RESULT_CHARS=%d)',
      text.length,
      out.length,
      limit
    );
    return out;
  }

  const out = text.slice(0, headLen) + suffix;
  console.error(
    'mcp-aiven: Tool result trimmed: %d -> %d chars (MCP_MAX_TOOL_RESULT_CHARS=%d)',
    text.length,
    out.length,
    limit
  );
  return out;
}
