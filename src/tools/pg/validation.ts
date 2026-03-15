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
  if (WRITE_BLOCKED.has(stmtType)) {
    return {
      valid: false,
      error: `Blocked statement type: ${stmtType}. DROP, TRUNCATE, GRANT, REVOKE, DO, CREATE FUNCTION, SET, and transaction control statements are not allowed through this tool.`,
    };
  }
  return { valid: true, stmtType };
}
