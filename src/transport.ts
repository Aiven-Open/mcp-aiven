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

  app.post('/mcp', authMiddleware, (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const token = (req as Request & { token: string }).token;
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
      const mcpServer = createServer();
      await mcpServer.connect(transport as unknown as Transport);

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
