/**
 * Public instrumentation API.
 * No-ops when SENTRY_DSN is not set — the app behaves exactly as without this module.
 *
 * Must be the first import in the app entry point so backends can
 * instrument Express and other modules before they are loaded.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as sentry from './sentry.js';

const sentryDsn = process.env['SENTRY_DSN'];
const sentryEnabled = !!sentryDsn;

if (sentryEnabled) {
  await sentry.initialize(sentryDsn);
}

export function instrumentServer(server: McpServer): McpServer {
  if (!sentryEnabled) return server;
  return sentry.instrumentServer(server);
}

export function captureException(error: unknown): void {
  if (!sentryEnabled) return;
  sentry.captureException(error);
}

export async function flushAndExit(error: unknown, exitCode = 1): Promise<never> {
  if (sentryEnabled) {
    sentry.captureException(error);
    await sentry.flush();
  }
  process.exit(exitCode);
}
