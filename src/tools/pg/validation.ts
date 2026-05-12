import { loadModule, parseSync } from 'libpg-query';

interface PgAst {
  stmts: Array<{ stmt: Record<string, unknown> }>;
}

let moduleLoaded = false;
async function ensurePgQueryLoaded(): Promise<void> {
  if (!moduleLoaded) {
    await loadModule();
    moduleLoaded = true;
  }
}

const READONLY_ALLOWED = new Set(['SelectStmt', 'ExplainStmt']);

// Allowlist approach: only explicitly safe write operations are permitted.
// This replaces the previous blocklist (WRITE_BLOCKED) which was incomplete.
//
// Rationale: A blocklist is inherently incomplete -- new statement types can be
// added by PostgreSQL or pg_query at any time, and each unlisted type becomes an
// implicit bypass. An allowlist inverts this: only known-safe DDL/DML operations
// are permitted, and any unknown or dangerous statement type is rejected by default.
//
// Allowed operations are limited to standard data manipulation and schema changes
// that cannot be used for:
//   - Server-Side Request Forgery (SSRF) via dblink/postgres_fdw/foreign tables
//   - Arbitrary code execution via CREATE FUNCTION, LOAD, or triggers
//   - Privilege escalation via role or configuration modification
//   - Authentication or security policy changes
//
// If you need to add a new statement type to this set, evaluate it against the
// threat categories above and document the justification here.
const WRITE_ALLOWED = new Set([
  'InsertStmt',          // INSERT INTO ... VALUES/SELECT
  'UpdateStmt',          // UPDATE ... SET
  'DeleteStmt',          // DELETE FROM ...
  'CreateStmt',          // CREATE TABLE
  'CreateTableAsStmt',   // CREATE TABLE AS / CREATE MATERIALIZED VIEW ... AS
  'IndexStmt',           // CREATE INDEX / CREATE UNIQUE INDEX
  'AlterTableStmt',      // ALTER TABLE (column/constraint changes)
  'CommentStmt',         // COMMENT ON (table, column, etc.)
  'CreateSchemaStmt',    // CREATE SCHEMA
  'ViewStmt',            // CREATE [OR REPLACE] VIEW
  'RefreshMatViewStmt',  // REFRESH MATERIALIZED VIEW
  'CreateSeqStmt',       // CREATE SEQUENCE
  'AlterSeqStmt',        // ALTER SEQUENCE
]);

export type SqlValidationResult =
  | { valid: true; stmtType: string }
  | { valid: false; error: string };

function extractStmtType(query: string): string {
  let ast: PgAst;
  try {
    ast = parseSync(query) as PgAst;
  } catch {
    throw new Error('SQL parse error: the query could not be parsed as valid PostgreSQL.');
  }
  if (ast.stmts.length !== 1) {
    throw new Error('Multiple SQL statements are not allowed. Please send one query at a time.');
  }
  const stmtType = Object.keys(ast.stmts[0]?.stmt ?? {})[0];
  if (!stmtType) {
    throw new Error('Empty statement.');
  }
  return stmtType;
}

export async function validateReadQuery(query: string): Promise<SqlValidationResult> {
  await ensurePgQueryLoaded();
  let stmtType: string;
  try {
    stmtType = extractStmtType(query);
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
  if (!READONLY_ALLOWED.has(stmtType)) {
    return { valid: false, error: `Only SELECT and EXPLAIN statements are allowed in read-only mode.` };
  }
  return { valid: true, stmtType };
}

export async function validateWriteQuery(query: string): Promise<SqlValidationResult> {
  await ensurePgQueryLoaded();
  let stmtType: string;
  try {
    stmtType = extractStmtType(query);
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
  if (!WRITE_ALLOWED.has(stmtType)) {
    return {
      valid: false,
      error: `Blocked statement type: ${stmtType}. Only INSERT, UPDATE, DELETE, CREATE TABLE, CREATE INDEX, ALTER TABLE, COMMENT, CREATE SCHEMA, CREATE VIEW, REFRESH MATERIALIZED VIEW, and CREATE/ALTER SEQUENCE statements are allowed through this tool.`,
    };
  }
  return { valid: true, stmtType };
}
