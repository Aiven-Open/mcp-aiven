/**
 * Sentry initialization for the MCP server.
 * Completely no-ops when SENTRY_DSN is not set.
 *
 * Must be the first import in index.ts so Sentry can instrument Express
 * and other modules before they are loaded.
 */

import type * as SentryType from '@sentry/node';

export let sentry: typeof SentryType | undefined;

const sentryDsn = process.env['SENTRY_DSN'];

if (sentryDsn) {
  try {
    sentry = await import('@sentry/node');
    sentry.init({
      dsn: sentryDsn,
      tracesSampleRate: 1.0, // All traces
      sendDefaultPii: false,
      enableLogs: true,
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
