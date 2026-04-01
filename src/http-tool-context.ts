import { AsyncLocalStorage } from 'node:async_hooks';

/** Incoming HTTP clients should send this on every Streamable HTTP request to `/mcp`. */
export const MCP_CLIENT_NAME_HEADER = 'x-mcp-client-name';

export type HttpToolContextStore = {
  mcpClientName?: string | undefined;
};

export const httpToolContext = new AsyncLocalStorage<HttpToolContextStore>();
