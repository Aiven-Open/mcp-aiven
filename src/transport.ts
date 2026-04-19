import { randomUUID } from 'node:crypto';
import express from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Request, Response, NextFunction } from 'express';
import { HOST } from './config.js';

export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}

interface HttpServerConfig {
  port: number;
  apiOrigin: string;
  scopes: string[];
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 1000;

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ', 2);
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  (req as Request & { token: string }).token = token;
  next();
}

// Detect MCP initialize requests (single or batched JSON-RPC)
function isInitializeRequest(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some((msg) => typeof msg === 'object' && msg !== null && 'method' in msg && msg.method === 'initialize');
  }
  return typeof body === 'object' && body !== null && 'method' in body && (body as { method: string }).method === 'initialize';
}

export function startHttpServer(
  createServer: () => McpServer,
  config: HttpServerConfig
): void {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Reuse transport+server across requests in the same MCP session,
  // so clients don't re-handshake (initialize + notify) on every tool call.
  const sessions = new Map<string, Session>();

  // Evict stale sessions periodically
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        session.transport.close().catch(() => {});
        sessions.delete(id);
      }
    }
  }, 60_000);
  cleanupInterval.unref();

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

  app.get('/mcp', (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').json({ error: 'Method Not Allowed' });
  });

  app.delete('/mcp', authMiddleware, (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.transport.close().catch(() => {});
      sessions.delete(sessionId);
    }
    res.status(200).json({ status: 'session closed' });
  });

  app.post('/mcp', authMiddleware, (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const token = (req as Request & { token: string }).token;
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      let transport: StreamableHTTPServerTransport;

      if (sessionId && sessions.has(sessionId)) {
        // Existing session — reuse transport (no re-init needed)
        transport = sessions.get(sessionId)!.transport;
      } else if (sessionId) {
        // Session ID provided but not found (expired or wrong instance)
        res.status(404).json({ error: 'Session not found' });
        return;
      } else if (isInitializeRequest(req.body)) {
        // First request — create new session
        if (sessions.size >= MAX_SESSIONS) {
          res.status(503).set('Retry-After', '30').json({ error: 'Too many active sessions' });
          return;
        }

        const mcpServer = createServer();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (newId: string) => {
            sessions.set(newId, { transport, server: mcpServer, createdAt: Date.now() });
          },
        });

        await mcpServer.connect(transport as unknown as Transport);

        transport.onclose = () => {
          const id = transport.sessionId;
          if (id) sessions.delete(id);
        };
      } else {
        res.status(400).json({ error: 'Bad Request: missing session ID or not an initialize request' });
        return;
      }

      (req as Request & { auth: { token: string; clientId: string; scopes: string[] } }).auth = {
        token,
        clientId: 'aiven',
        scopes: [],
      };

      await transport.handleRequest(req, res, req.body);
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
