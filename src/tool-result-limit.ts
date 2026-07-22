const DEFAULT_MAX_CHARS = 100_000;

export function getMaxToolResultChars(): number {
  const raw = process.env['MCP_MAX_TOOL_RESULT_CHARS'];
  if (raw === undefined || raw === '') return DEFAULT_MAX_CHARS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_MAX_CHARS;
  if (n <= 0) return 0;
  return n;
}

function trimSuffix(originalLength: number, limit: number, toolName?: string): string {
  return (
    `\n\n---\n**Trimmed:** The ${toolName ?? 'tool'} response was cut because it exceeded the maximum tool output size ` +
    `(${originalLength} characters; cap ${limit} from MCP_MAX_TOOL_RESULT_CHARS). ` +
    `Only the beginning of the payload is included—later entries were omitted. ` +
    `If this was JSON, open brackets were closed so the retained prefix still parses. ` +
    `The full data is available with a narrower request or a higher cap.`
  );
}

function sliceToLineBoundary(text: string, headLen: number): string {
  const hard = text.slice(0, headLen);
  const lastNewline = hard.lastIndexOf('\n');
  return lastNewline > 0 ? hard.slice(0, lastNewline) : hard;
}

/** Upper bound on characters appended by {@link closeTruncatedJson} (closing brackets). */
const JSON_CLOSE_RESERVE = 64;

function closeTruncatedJson(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }

  if (stack.length === 0 && !inString) return text;

  let out = text.trimEnd();
  if (inString) out += '"';
  else if (out.endsWith(',')) out = out.slice(0, -1);

  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === '{' ? '}' : ']';
  }
  return out;
}

/**
 * If over cap, returns a prefix of `text` plus a trim notice so total length ≤ `limit`.
 * Logs to stderr (safe for stdio MCP: protocol uses stdout). No-op when under cap or uncapped.
 */
export function applyToolResultCharCap(text: string, toolName?: string): string {
  const limit = getMaxToolResultChars();
  if (limit <= 0 || text.length <= limit) return text;

  // Prefer the descriptive notice; fall back to a minimal one when the cap is too tight for it.
  let notice = trimSuffix(text.length, limit, toolName);
  let headLen = limit - notice.length - JSON_CLOSE_RESERVE;
  if (headLen < 0) {
    notice = `\n… [mcp-aiven: trimmed ${String(text.length)}→${String(limit)} chars]`;
    headLen = limit - notice.length - JSON_CLOSE_RESERVE;
    if (headLen <= 0) {
      console.error(
        'mcp-aiven: Tool result trim: cap %d too small for payload of %d chars; returning truncated notice only (tool=%s)',
        limit,
        text.length,
        toolName ?? 'unknown'
      );
      return notice.slice(0, limit);
    }
  }

  const out = closeTruncatedJson(sliceToLineBoundary(text, headLen)) + notice;
  console.error(
    'mcp-aiven: Tool result trimmed: %d -> %d chars (tool=%s, MCP_MAX_TOOL_RESULT_CHARS=%d)',
    text.length,
    out.length,
    toolName ?? 'unknown',
    limit
  );
  return out;
}
