/**
 * Sentry helpers for wrapping the MCP server and capturing errors.
 *
 * All functions are safe to call unconditionally — they no-op when
 * SENTRY_DSN is not set so the rest of the codebase stays Sentry-unaware.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sentry } from './init.js';

/**
 * Wraps the McpServer with Sentry instrumentation.
 * Auto-captures spans and errors for every tool call.
 * Returns the original server unchanged when Sentry is not enabled.
 */
export function wrapServerWithSentry(server: McpServer): McpServer {
  if (!sentry) return server;
  return sentry.wrapMcpServerWithSentry(server);
}

/**
 * Reports an error to Sentry. No-ops when Sentry is not enabled.
 */
export function captureException(error: unknown): void {
  sentry?.captureException(error);
}

/**
 * Reports an error to Sentry, flushes pending events, then exits the process.
 * Falls back to immediate exit when Sentry is not enabled.
 */
export async function flushAndExit(error: unknown, exitCode = 1): Promise<never> {
  if (sentry) {
    try {
      sentry.captureException(error);
      await sentry.flush(2000);
    } catch {
      // Ignore flush errors — we're exiting anyway
    }
  }
  process.exit(exitCode);
}

/**
 * Hooks the MCP server's onerror handler to capture protocol-level errors.
 * No-ops when Sentry is not enabled.
 */
export function setupServerErrorHandler(server: McpServer): void {
  if (!sentry) return;
  server.server.onerror = (error: unknown) => {
    console.error('mcp-aiven: MCP server error:', error);
    captureException(error);
  };
}
