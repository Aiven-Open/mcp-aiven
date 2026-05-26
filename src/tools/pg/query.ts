import { createHash } from 'node:crypto';
import type { AivenClient } from '../../client.js';
import type { ToolResult, ExecutePgQueryOptions } from '../../types.js';
import { PgQueryMode, toolSuccess, toolError, toolErrorWithRequestId } from '../../types.js';
import { errorMessage } from '../../errors.js';
import { redactSensitiveData } from '../../security.js';
import { wrapUntrustedResponse } from '../../untrusted.js';
import { postPgEditorRunQuery } from './pg-editor.js';
import { validateReadQuery, validateWriteQuery } from './validation.js';

export const MAX_ROWS = 1000;
export const DEFAULT_LIMIT = 100;
const MAX_CELL_LENGTH = 4096;

const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitBuckets = new Map<string, number[]>();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function checkRateLimit(token?: string): string | null {
  const key = token ? hashToken(token) : '__stdio__';
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;

  let timestamps = rateLimitBuckets.get(key);
  if (timestamps) {
    while (timestamps.length > 0 && (timestamps[0] ?? 0) <= cutoff) {
      timestamps.shift();
    }
    if (timestamps.length === 0) {
      rateLimitBuckets.delete(key);
      timestamps = undefined;
    }
  }

  if (timestamps && timestamps.length >= RATE_LIMIT_MAX) {
    return `Rate limit exceeded: maximum ${RATE_LIMIT_MAX} queries per ${RATE_LIMIT_WINDOW_MS / 1000} seconds. Please wait before issuing more queries.`;
  }

  if (!timestamps) {
    timestamps = [];
    rateLimitBuckets.set(key, timestamps);
  }
  timestamps.push(now);
  return null;
}

function truncateCells(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' && value.length > MAX_CELL_LENGTH) {
      result[key] = value.slice(0, MAX_CELL_LENGTH) + '... (truncated)';
    } else {
      result[key] = value;
    }
  }
  return result;
}

function fieldNames(fields: unknown): string[] {
  if (!Array.isArray(fields)) return [];
  return fields.map((f) => {
    if (typeof f === 'string') return f;
    if (f && typeof f === 'object' && 'name' in f) return String((f as { name: unknown }).name);
    return String(f);
  });
}

function extractRows(data: Record<string, unknown>): Record<string, unknown>[] {
  const results = data['results'];
  if (Array.isArray(results)) return results as Record<string, unknown>[];
  const nested = data['result'];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const rows = (nested as Record<string, unknown>)['rows'];
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  }
  const rows = data['rows'];
  if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  return [];
}

function extractRowCount(data: Record<string, unknown>, rows: Record<string, unknown>[]): number {
  const candidates = [data['row_count'], data['rowCount']];
  const nested = data['result'];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const n = nested as Record<string, unknown>;
    candidates.push(n['row_count'], n['rowCount']);
  }
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return rows.length;
}

function extractCommand(data: Record<string, unknown>): string | undefined {
  const candidates = [data['command']];
  const nested = data['result'];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    candidates.push((nested as Record<string, unknown>)['command']);
  }
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return undefined;
}

function wrapInBoundary(data: unknown): string {
  return wrapUntrustedResponse(redactSensitiveData(data));
}

export function formatPgEditorQueryResult(
  data: Record<string, unknown>,
  options: Pick<ExecutePgQueryOptions, 'limit' | 'offset' | 'mode'>
): { meta: Record<string, unknown>; rows: Record<string, unknown>[] } {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const offset = options.offset ?? 0;

  const allRows = extractRows(data).slice(0, MAX_ROWS);
  const paged = allRows.slice(offset, offset + limit);
  const truncatedRows = paged.map((row) => truncateCells(row));

  const rowCount = extractRowCount(data, extractRows(data));
  const nestedResult = data['result'];
  const nestedFields =
    nestedResult && typeof nestedResult === 'object' && !Array.isArray(nestedResult)
      ? (nestedResult as Record<string, unknown>)['fields']
      : undefined;
  const fields = fieldNames(data['fields'] ?? nestedFields);

  const meta: Record<string, unknown> = {
    rowCount,
    returnedRows: paged.length,
    totalRowsCapped: allRows.length,
    truncated: rowCount > MAX_ROWS,
    offset,
    limit,
    hasMore: offset + limit < allRows.length,
    fields,
  };

  const command = extractCommand(data);
  if (options.mode === PgQueryMode.ReadWrite && command) {
    meta['command'] = command;
  }

  return { meta, rows: truncatedRows };
}

export async function executePgQuery(
  client: AivenClient,
  options: ExecutePgQueryOptions
): Promise<ToolResult> {
  const {
    project,
    service_name,
    query,
    database,
    schema,
    mode,
    limit = DEFAULT_LIMIT,
    offset = 0,
    token,
  } = options;

  const validation =
    mode === PgQueryMode.ReadOnly
      ? await validateReadQuery(query)
      : await validateWriteQuery(query);
  if (!validation.valid) {
    return toolError(validation.error);
  }

  const rateLimitError = checkRateLimit(token);
  if (rateLimitError) return toolError(rateLimitError);

  const apiOpts = {
    token,
    mcpClient: options.mcpClient,
    clientIp: options.clientIp,
    toolName: options.toolName,
    requestId: options.requestId,
    toolReasoning: options.toolReasoning,
  };

  try {
    const data = await postPgEditorRunQuery(client, project, service_name, {
      query,
      database,
      schema_name: schema,
      expect_readonly: mode === PgQueryMode.ReadOnly,
    }, apiOpts);
    const { meta, rows } = formatPgEditorQueryResult(data, { limit, offset, mode });
    return toolSuccess(wrapInBoundary({ meta, rows }));
  } catch (err) {
    return toolErrorWithRequestId(errorMessage(err), options.requestId);
  }
}
