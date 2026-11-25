import { loadModule, parseSync } from 'libpg-query';

interface PgAst {
  stmts: Array<{ stmt: Record<string, unknown> }>;
}

// WASM module must be loaded once before parseSync can be used
let moduleLoaded = false;
async function ensurePgQueryLoaded(): Promise<void> {
  if (!moduleLoaded) {
    await loadModule();
    moduleLoaded = true;
  }
}

// Read-only tool: only allow SELECT and EXPLAIN
const READONLY_ALLOWED = new Set(['SelectStmt', 'ExplainStmt']);

// Write tool: block dangerous DDL + SET/transaction injection
const WRITE_BLOCKED = new Set([
  'DropStmt',
  'DropRoleStmt',
  'DropdbStmt',
  'DropTableSpaceStmt',
  'DropSubscriptionStmt',
  'DropOwnedStmt',
  'TruncateStmt',
  'GrantStmt', // also covers REVOKE
  'ReassignOwnedStmt',
  'SecLabelStmt',
  'DoStmt',
  'CreateFunctionStmt',
  'VariableSetStmt',
  'TransactionStmt',
]);

// Inside a read-only statement, the only statement node types that may
// appear are SELECT and EXPLAIN themselves (subqueries, nested EXPLAIN,
// a read-only CTE). Any other *Stmt node — a data-modifying CTE, EXPLAIN
// of a write (including CREATE TABLE AS, which parses as
// CreateTableAsStmt, not CreateStmt) — is a bypass attempt. An allowlist
// is used instead of a denylist so future statement types are rejected
// by default.
//
// NOTE: the allowlist applies to STATEMENT TYPES only. The function
// check below (READONLY_BLOCKED_FUNCTIONS) is still a denylist of known
// side-effecting functions — a function not on that list is allowed, so
// new side-effecting functions must be added here when found. A full
// function allowlist is not realistic: it would reject legitimate
// read-only queries that call ordinary functions (aggregates, now(),
// currval(), ...).
const READ_STMT_TYPES = new Set(['SelectStmt', 'ExplainStmt']);

// Functions with side effects (file access, large objects, backend control,
// dblink) that are callable from an otherwise valid SELECT.
const READONLY_BLOCKED_FUNCTIONS = new Set([
  'pg_read_file',
  'pg_read_binary_file',
  'pg_stat_file',
  'pg_ls_dir',
  'pg_ls_logdir',
  'pg_ls_waldir',
  'pg_ls_archive_statusdir',
  'pg_ls_tmpdir',
  'pg_ls_logicalsnapdir',
  'pg_ls_replslotdir',
  'pg_logdir_ls',
  'pg_file_write',
  'lo_import',
  'lo_import_with_oid',
  'lo_export',
  'lo_create',
  'lo_open',
  'lo_put',
  'lo_unlink',
  'lo_write',
  'lo_lseek',
  'lo_truncate',
  'pg_terminate_backend',
  'pg_cancel_backend',
  'pg_reload_conf',
  'pg_rotate_logfile',
  'pg_sleep',
  'pg_sleep_for',
  'pg_sleep_until',
  'pg_promote',
  'pg_switch_wal',
  'pg_backup_start',
  'pg_backup_stop',
  'pg_start_backup',
  'pg_stop_backup',
  'pg_create_restore_point',
  'pg_import_system_collations',
  'pg_logical_emit_message',
  'pg_logical_slot_peek_changes',
  'pg_logical_slot_get_changes',
  'pg_replication_origin_advance',
  'pg_replication_origin_create',
  'pg_replication_origin_drop',
  'pg_replication_origin_session_setup',
  'pg_replication_origin_session_reset',
  'pg_notify',
  'set_config',
  'nextval',
  'setval',
  'pg_advisory_lock',
  'pg_advisory_unlock',
  'pg_advisory_unlock_all',
  'pg_try_advisory_lock',
  'pg_advisory_xact_lock',
  'pg_try_advisory_xact_lock',
  'dblink',
  'dblink_exec',
  'dblink_open',
  'dblink_fetch',
  'dblink_close',
  'dblink_get_pkey',
  'dblink_build_sql_insert',
  'dblink_build_sql_delete',
  'dblink_build_sql_update',
  'dblink_current_query',
]);

// dblink has several similarly-named variants; block the whole family.
const READONLY_BLOCKED_FUNCTION_PREFIXES = ['dblink'];

export type SqlValidationResult =
  { valid: true; stmtType: string } | { valid: false; error: string };

function parseSingleStatement(query: string): {
  stmt: Record<string, unknown>;
  stmtType: string;
} {
  let ast: PgAst;
  try {
    ast = parseSync(query) as PgAst;
  } catch {
    throw new Error('SQL parse error: the query could not be parsed as valid PostgreSQL.');
  }

  if (ast.stmts.length !== 1) {
    throw new Error('Multiple SQL statements are not allowed. Please send one query at a time.');
  }

  const stmt = ast.stmts[0]?.stmt ?? {};
  const stmtType = Object.keys(stmt)[0];
  if (!stmtType) {
    throw new Error('Empty statement.');
  }

  return { stmt, stmtType };
}

// Extracts the (lowercased) function name from a FuncCall AST node, or null
// if it cannot be determined. The name is the last part of `funcname`, so a
// schema-qualified call such as pg_catalog.pg_read_file is still detected.
function funcCallName(funcCall: Record<string, unknown>): string | null {
  const funcname = funcCall['funcname'];
  if (!Array.isArray(funcname) || funcname.length === 0) return null;
  const last = funcname[funcname.length - 1] as Record<string, unknown> | string;
  if (typeof last === 'string') return last.toLowerCase();
  const stringNode = (last as { String?: { sval?: unknown } }).String;
  if (stringNode && typeof stringNode.sval === 'string') {
    return stringNode.sval.toLowerCase();
  }
  return null;
}

// Recursively checks a SELECT/EXPLAIN statement body for constructs that
// escape the read-only guard. Returns an error message, or null if clean.
// Walks the whole tree (subqueries included) because a side-effecting call
// can hide in a FROM clause, a WHERE clause, or a nested CTE.
function findReadOnlyViolation(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const err = findReadOnlyViolation(item);
      if (err) return err;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'intoClause' && value !== null && value !== undefined) {
      return 'SELECT ... INTO is not allowed in read-only mode: it creates a table.';
    }
    if (key === 'FuncCall' && value && typeof value === 'object') {
      const name = funcCallName(value as Record<string, unknown>);
      if (
        name &&
        (READONLY_BLOCKED_FUNCTIONS.has(name) ||
          READONLY_BLOCKED_FUNCTION_PREFIXES.some((prefix) => name.startsWith(prefix)))
      ) {
        return `Function ${name}() is not allowed in read-only mode.`;
      }
    }
    if (key.endsWith('Stmt') && !READ_STMT_TYPES.has(key) && value && typeof value === 'object') {
      return `Statement type ${key} is not allowed in read-only mode.`;
    }
    const err = findReadOnlyViolation(value);
    if (err) return err;
  }
  return null;
}

export async function validateReadQuery(query: string): Promise<SqlValidationResult> {
  await ensurePgQueryLoaded();
  let stmt: Record<string, unknown>;
  let stmtType: string;
  try {
    ({ stmt, stmtType } = parseSingleStatement(query));
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
  if (!READONLY_ALLOWED.has(stmtType)) {
    return {
      valid: false,
      error: `Only SELECT and EXPLAIN statements are allowed in read-only mode.`,
    };
  }
  const violation = findReadOnlyViolation(stmt);
  if (violation) {
    return { valid: false, error: violation };
  }
  return { valid: true, stmtType };
}

export async function validateWriteQuery(query: string): Promise<SqlValidationResult> {
  await ensurePgQueryLoaded();
  let stmtType: string;
  try {
    ({ stmtType } = parseSingleStatement(query));
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
  if (WRITE_BLOCKED.has(stmtType)) {
    return {
      valid: false,
      error: `Blocked statement type: ${stmtType}. DROP, TRUNCATE, GRANT, REVOKE, DO, CREATE FUNCTION, SET, and transaction control statements are not allowed through this tool.`,
    };
  }
  return { valid: true, stmtType };
}
