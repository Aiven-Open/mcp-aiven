import { createHash } from 'node:crypto';
import express from 'express';
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Request, Response, NextFunction } from 'express';
import { HOST } from './config.js';
import type { HttpMcpRateLimitConfig } from './config.js';
import type { McpServerFactory, McpRequestOptions } from './types.js';

export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}

export interface HttpServerConfig {
  port: number;
  apiOrigin: string;
  scopes: string[];
  rateLimit: HttpMcpRateLimitConfig;
  trustProxy: boolean;
  readOnly: boolean;
}

const RATE_LIMIT_PROPERTY = 'rateLimit' as const;

/** Logs and sends the same response as express-rate-limit's default handler. */
function rateLimitExceededHandler(scope: string) {
  return (request: Request, response: Response, _next: NextFunction, optionsUsed: Options): void => {
    const rl = (request as Request & { [RATE_LIMIT_PROPERTY]?: { limit: number; used: number; key: string } })[
      RATE_LIMIT_PROPERTY
    ];
    const ip = request.ip ?? 'unknown';
    const path = request.path || request.url || '';
    console.warn(
      `mcp-aiven: rate limit exceeded (${scope}) ${request.method} ${path} ip=${ip}` +
        (rl !== undefined ? ` limit=${rl.limit} used=${rl.used} keyPrefix=${rl.key.slice(0, 8)}` : '')
    );
    response.status(optionsUsed.statusCode);
    const message = optionsUsed.message;
    if (typeof message === 'function') {
      void Promise.resolve(message(request, response)).then((body) => {
        if (!response.writableEnded) response.send(body);
      });
    } else if (!response.writableEnded) {
      response.send(message);
    }
  };
}

function createMcpPostRateLimit(
  cfg: HttpMcpRateLimitConfig,
  message: { error: string }
): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs: cfg.windowMs,
    limit: cfg.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request) => mcpRequestKey(req),
    message,
    handler: rateLimitExceededHandler('mcp-post'),
  });
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

function mcpRequestKey(req: Request): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token.length > 0) {
      return createHash('sha256').update(token).digest('hex');
    }
  }
  return ipKeyGenerator(req.ip ?? '0.0.0.0');
}

const ALLOWED_MCP_QUERY_PARAMS = new Set(['read_only']);

export function parseMcpQueryParams(
  query: Record<string, unknown>,
  serverReadOnly: boolean
): { options: McpRequestOptions } | { error: string } {
  const unknownParams = Object.keys(query).filter((k) => !ALLOWED_MCP_QUERY_PARAMS.has(k));
  if (unknownParams.length > 0) {
    return { error: `Unknown query parameter(s): ${unknownParams.join(', ')}` };
  }

  const rawReadOnly = query['read_only'];

  if (Array.isArray(rawReadOnly)) {
    return { error: 'Duplicate query parameter: read_only' };
  }

  if (rawReadOnly !== undefined && rawReadOnly !== 'true' && rawReadOnly !== 'false') {
    return { error: `Invalid value for read_only: must be "true" or "false"` };
  }

  const readOnly = serverReadOnly || rawReadOnly === 'true';

  return { options: { readOnly } };
}

export function startHttpServer(
  createServer: McpServerFactory,
  config: HttpServerConfig
): void {
  const app = express();
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }
  app.use(express.json({ limit: '5mb' }));

  const mcpPostRateLimit = createMcpPostRateLimit(config.rateLimit, {
    error: 'Too many MCP requests. Please wait before trying again.',
  });

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

  app.delete('/mcp', (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').json({ error: 'Method Not Allowed' });
  });

  app.post('/mcp', mcpPostRateLimit, authMiddleware, (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const parsed = parseMcpQueryParams(req.query as Record<string, unknown>, config.readOnly);
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const token = (req as Request & { token: string }).token;
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
      const mcpServer = createServer(parsed.options);
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
