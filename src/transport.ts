import { randomUUID } from 'node:crypto';
import express from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Request, Response, NextFunction } from 'express';
import { HOST } from './config.js';
import { httpToolContext, MCP_CLIENT_NAME_HEADER } from './http-tool-context.js';

const MCP_SESSION_HEADER = 'mcp-session-id';

type HttpSessionEntry = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
};

const httpSessions = new Map<string, HttpSessionEntry>();

export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}

interface HttpServerConfig {
  port: number;
  apiOrigin: string;
  scopes: string[];
}

function mcpClientNameFromRequest(req: Request): string | undefined {
  const raw = req.headers[MCP_CLIENT_NAME_HEADER];
  const v = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
  const t = v?.trim();
  return t ? t : undefined;
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ', 2);
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  (req as Request & { token: string }).token = token;
  next();
}

export function startHttpServer(
  createServer: () => McpServer,
  config: HttpServerConfig
): void {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
    res.json({
      resource: HOST,
      authorization_servers: [config.apiOrigin],
      scopes_supported: config.scopes,
      bearer_methods_supported: ['header'],
    });
  });

  /**
   * Stateful Streamable HTTP: one transport + McpServer per `mcp-session-id` so `initialize`
   * stays on the same instance as later `tools/call` requests.
   *
   * Per request: optional `X-MCP-Client-Name` is propagated to Aiven as `X-MCP-Client` on tool calls.
   */
  app.all('/mcp', authMiddleware, (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const token = (req as Request & { token: string }).token;

      (req as Request & { auth: { token: string; clientId: string; scopes: string[] } }).auth = {
        token,
        clientId: 'aiven',
        scopes: [],
      };

      const rawSession = req.headers[MCP_SESSION_HEADER];
      const sessionKey =
        typeof rawSession === 'string' ? rawSession : Array.isArray(rawSession) ? rawSession[0] : undefined;

      let entry: HttpSessionEntry;

      if (sessionKey !== undefined) {
        const existing = httpSessions.get(sessionKey);
        if (!existing) {
          res.status(404).json({ error: 'Unknown or expired MCP session' });
          return;
        }
        entry = existing;
      } else {
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            httpSessions.set(sid, { transport, server });
          },
          onsessionclosed: (sid) => {
            httpSessions.delete(sid);
          },
        });
        await server.connect(transport as unknown as Transport);
        entry = { transport, server };
      }

      const body =
        req.method === 'GET' || req.method === 'HEAD' ? undefined : (req.body as unknown);
      await httpToolContext.run({ mcpClientName: mcpClientNameFromRequest(req) }, () =>
        entry.transport.handleRequest(req, res, body)
      );
    })().catch((err: unknown) => {
      console.error('mcp-aiven: MCP handler error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  });

  app.listen(config.port, () => {
    console.error(`mcp-aiven: HTTP listening on port ${config.port}`);
  });
}
