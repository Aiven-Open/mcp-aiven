import { randomUUID, createHash } from 'node:crypto';
import type { AivenClient } from '../../client.js';
import type { ToolResult, ExecuteClickHouseQueryOptions } from '../../types.js';
import { ClickHouseQueryMode, toolSuccess, toolError } from '../../types.js';
import { errorMessage } from '../../errors.js';
import { redactSensitiveData } from '../../security.js';
import { UNTRUSTED_DATA_WARNING } from '../../prompts.js';
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

interface ClickHouseQueryResponse {
  meta?: Array<{ name: string; type: string }>;
  data?: Array<Record<string, unknown>>;
  rows?: number;
  statistics?: { elapsed: number; rows_read: number; bytes_read: number };
}

export async function executeClickHouseQuery(
  client: AivenClient,
  options: ExecuteClickHouseQueryOptions
): Promise<ToolResult> {
  const {
    project,
    service_name,
    query,
    database = 'default',
    mode,
    limit = DEFAULT_LIMIT,
    offset = 0,
    token,
  } = options;

  const validation =
    mode === ClickHouseQueryMode.ReadOnly ? validateReadQuery(query) : validateWriteQuery(query);
  if (!validation.valid) {
    return toolError(validation.error);
  }

  const rateLimitError = checkRateLimit(token);
  if (rateLimitError) return toolError(rateLimitError);

  const apiOpts = { token, mcpClient: options.mcpClient, toolName: options.toolName };
  const apiPath = `/project/${encodeURIComponent(project)}/service/${encodeURIComponent(service_name)}/clickhouse/query`;

  try {
    const response = await client.post<ClickHouseQueryResponse>(
      apiPath,
      { query, database },
      apiOpts
    );

    const allRows = (response.data ?? []).slice(0, MAX_ROWS);
    const paged = allRows.slice(offset, offset + limit);
    const truncatedRows = paged.map((row) => truncateCells(row));
    const totalRows = response.rows ?? allRows.length;

    const meta: Record<string, unknown> = {
      rowCount: totalRows,
      returnedRows: paged.length,
      totalRowsCapped: allRows.length,
      truncated: totalRows > MAX_ROWS,
      offset,
      limit,
      hasMore: offset + limit < allRows.length,
    };

    if (response.meta) {
      meta['fields'] = response.meta.map((f) => ({ name: f.name, type: f.type }));
    }

    if (response.statistics) {
      meta['statistics'] = response.statistics;
    }

    return toolSuccess(wrapInBoundary({ meta, rows: truncatedRows }));
  } catch (err) {
    return toolError(`ClickHouse query error: ${errorMessage(err)}`);
  }
}
