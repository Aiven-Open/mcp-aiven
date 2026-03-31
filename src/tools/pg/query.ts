import { randomUUID, createHash } from 'node:crypto';
import type { AivenClient } from '../../client.js';
import type { ToolResult, ExecutePgQueryOptions } from '../../types.js';
import { PgQueryMode, toolSuccess, toolError } from '../../types.js';
import { errorMessage } from '../../errors.js';
import { redactSensitiveData } from '../../security.js';
import { UNTRUSTED_DATA_WARNING } from '../../prompts.js';
import { connectToService } from './connection.js';
import { validateReadQuery, validateWriteQuery } from './validation.js';

export const MAX_ROWS = 1000;
export const DEFAULT_LIMIT = 100;
const MAX_CELL_LENGTH = 4096;
const STATEMENT_TIMEOUT_MS = 30000;

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitBuckets = new Map<string, number[]>();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function checkRateLimit(token?: string): string | null {
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

function sanitizePgError(err: unknown): string {
  if (!(err instanceof Error)) return 'PostgreSQL query error: query execution failed';
  const code = 'code' in err && typeof err.code === 'string' ? ` [${err.code}]` : '';
  return `PostgreSQL error${code}: ${err.message}`;
}

function wrapInBoundary(data: unknown): string {
  const uuid = randomUUID();
  const redacted = redactSensitiveData(data);
  return [
    UNTRUSTED_DATA_WARNING,
    `<untrusted-query-result-${uuid}>`,
    JSON.stringify(redacted, null, 2),
    `</untrusted-query-result-${uuid}>`,
  ].join('\n');
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

  const apiOpts = { token, mcpClient: options.mcpClient, toolName: options.toolName };

  let pgClient;
  try {
    pgClient = await connectToService(client, project, service_name, database, apiOpts);
  } catch (err) {
    return toolError(errorMessage(err));
  }

  try {
    await pgClient.query(mode === PgQueryMode.ReadOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    await pgClient.query(`SET LOCAL statement_timeout = '${String(STATEMENT_TIMEOUT_MS)}'`);

    const result = await pgClient.query(query);
    await pgClient.query('COMMIT');

    const allRows = result.rows.slice(0, MAX_ROWS);
    const paged = allRows.slice(offset, offset + limit);
    const truncatedRows = paged.map((row: Record<string, unknown>) => truncateCells(row));

    const meta: Record<string, unknown> = {
      rowCount: result.rowCount ?? 0,
      returnedRows: paged.length,
      totalRowsCapped: allRows.length,
      truncated: (result.rowCount ?? 0) > MAX_ROWS,
      offset,
      limit,
      hasMore: offset + limit < allRows.length,
      fields: result.fields.map((f) => f.name),
    };

    if (mode === PgQueryMode.ReadWrite) {
      meta['command'] = result['command'];
    }

    return toolSuccess(wrapInBoundary({ meta, rows: truncatedRows }));
  } catch (err: unknown) {
    await pgClient.query('ROLLBACK').catch(() => {});
    return toolError(sanitizePgError(err));
  } finally {
    await pgClient.end();
  }
}
