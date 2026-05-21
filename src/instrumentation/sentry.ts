/**
 * Sentry backend for instrumentation.
 * Loaded only when SENTRY_DSN is set.
 */

import type * as SentryType from '@sentry/node';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

let sentry: typeof SentryType | undefined;

export async function initialize(dsn: string): Promise<void> {
  try {
    sentry = await import('@sentry/node');
    sentry.init({
      dsn,
      tracesSampleRate: 1.0, // All traces
      sendDefaultPii: false,
      enableLogs: true,
      registerEsmLoaderHooks: false, // Already registered via --import @sentry/node/preload in Dockerfile
      integrations: [
        sentry.consoleLoggingIntegration({ levels: ['log', 'info', 'warn', 'error'] }),
      ],
      ignoreErrors: [
        // Client disconnect events — not actionable server errors
        /ECONNRESET/,
        /socket hang up/i,
        /aborted/i,
      ],
    });
    console.log('mcp-aiven: Sentry enabled (errors, performance, logging)');
  } catch (err: unknown) {
    console.error('mcp-aiven: Sentry initialization failed, continuing without it:', err);
    sentry = undefined;
  }
}

export function instrumentServer(server: McpServer): McpServer {
  if (!sentry) return server;
  const wrapped = sentry.wrapMcpServerWithSentry(server);
  wrapped.server.onerror = (error: unknown): void => {
    console.error('mcp-aiven: MCP server error:', error);
    sentry?.captureException(error);
  };
  return wrapped;
}

export function captureException(error: unknown): void {
  sentry?.captureException(error);
}

export async function flush(): Promise<void> {
  if (!sentry) return;
  try {
    await sentry.flush(2000);
  } catch {
    // Ignore flush errors
  }
}
