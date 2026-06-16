import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import express from 'express';
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Request, Response, NextFunction } from 'express';
import { HOST, parseScopes, isMaintenanceMode } from './config.js';
import type { HttpMcpRateLimitConfig } from './config.js';
import type { McpServerFactory, McpRequestOptions } from './types.js';
import { isCloudflareAddress, normalizePeerIp } from './cloudflare-ips.js';
import { captureException } from './instrumentation/index.js';
import { inboundMcpClientIpFromRequest } from './inbound-tcp-client-ip.js';
import { createEdgeAuthMiddleware } from './edge-auth.js';
import { logInboundMcpRequestHeaders } from './inbound-request-headers.js';

export { inboundMcpClientIpFromTcpPeer } from './inbound-tcp-client-ip.js';

export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}

export interface HttpServerConfig {
  port: number;
  apiOrigin: string;
  scopes: string[];
  rateLimit: HttpMcpRateLimitConfig;
  readOnly: boolean;
  /** When set, POST /mcp requires matching X-Edge-Auth (Cloudflare-injected). */
  edgeAuthSecret?: string | undefined;
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

function createMcpPostBearerRateLimit(
  cfg: HttpMcpRateLimitConfig,
  message: { error: string }
): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs: cfg.windowMs,
    limit: cfg.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request) => bearerOrIpKey(req),
    message,
    handler: rateLimitExceededHandler('mcp-post-bearer'),
  });
}

/**
 * IP-keyed limiter applied alongside the bearer-keyed one. Catches
 * bearer-rotation floods where each request uses a fresh fake token (which
 * would otherwise get its own per-bearer bucket and bypass the cap). Uses
 * the same limit/window — whichever bucket fills first triggers the 429.
 */
function createMcpPostIpRateLimit(
  cfg: HttpMcpRateLimitConfig,
  message: { error: string }
): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs: cfg.windowMs,
    limit: cfg.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: clientIpKey,
    message,
    handler: rateLimitExceededHandler('mcp-post-ip'),
  });
}

export function clientIpKey(req: Request): string {
  const peer = normalizePeerIp(req.socket.remoteAddress);
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && isIP(cf) !== 0 && isCloudflareAddress(peer)) {
    return ipKeyGenerator(cf);
  }
  return ipKeyGenerator(req.ip ?? peer ?? '0.0.0.0');
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

export function bearerOrIpKey(req: Request): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token.length > 0) {
      return createHash('sha256').update(token).digest('hex');
    }
  }
  return clientIpKey(req);
}

const ALLOWED_MCP_QUERY_PARAMS = new Set(['read_only', 'services_scope']);

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

  const rawScope = query['services_scope'];

  if (Array.isArray(rawScope)) {
    return { error: 'Duplicate query parameter: services_scope' };
  }

  if (rawScope !== undefined && typeof rawScope !== 'string') {
    return { error: 'Invalid value for services_scope: must be a comma-separated string' };
  }

  const parsed = parseScopes(rawScope);
  if ('error' in parsed) {
    return { error: `Invalid value for services_scope: ${parsed.error}` };
  }

  return { options: { readOnly, categories: parsed.categories } };
}

export function startHttpServer(
  createServer: McpServerFactory,
  config: HttpServerConfig
): void {
  const app = express();

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isMaintenanceMode()) {
      next();
      return;
    }
    if (req.path === '/health') {
      res.json({ status: 'maintenance' });
      return;
    }
    res.status(503).json({
      error: 'Service is under maintenance. Please try again later.',
    });
  });

  const mcpJsonParser = express.json({ limit: '512kb' });

  const mcpPostIpRateLimit = createMcpPostIpRateLimit(config.rateLimit, {
    error: 'Too many MCP requests from this client. Please wait before trying again.',
  });

  const mcpPostBearerRateLimit = createMcpPostBearerRateLimit(config.rateLimit, {
    error: 'Too many MCP requests. Please wait before trying again.',
  });

  const edgeAuthMiddleware = createEdgeAuthMiddleware(config.edgeAuthSecret);

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

  app.post('/mcp', edgeAuthMiddleware, mcpPostIpRateLimit, mcpPostBearerRateLimit, authMiddleware, mcpJsonParser, (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      logInboundMcpRequestHeaders(req);

      const parsed = parseMcpQueryParams(req.query as Record<string, unknown>, config.readOnly);
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const token = (req as Request & { token: string }).token;
      const clientIp = inboundMcpClientIpFromRequest(req);
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
      const mcpServer = createServer({
        ...parsed.options,
        ...(clientIp !== undefined ? { clientIp } : {}),
      });
      await mcpServer.connect(transport as unknown as Transport);
      (req as Request & { auth: { token: string; clientId: string; scopes: string[] } }).auth = {
        token,
        clientId: 'aiven',
        scopes: [],
      };

      await transport.handleRequest(req, res, req.body);
    })().catch((err: unknown) => {
      captureException(err);
      console.error('mcp-aiven: MCP handler error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  });

  // Catch errors from Express middleware (e.g. malformed JSON body from body-parser).
  // Only reports to Sentry for 5xx (server bugs); 4xx are client errors and just get logged.
  app.use((err: Error & { status?: number }, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? 500;
    if (status >= 500) captureException(err);
    const label = status >= 500 ? 'unhandled exception' : 'bad input';
    console.error(`mcp-aiven: ${req.method} ${req.path} ${label} (${status}):`, err.message);
    if (!res.headersSent) {
      res.status(status).json({ error: err.message || 'Internal server error' });
    }
  });

  app.listen(config.port, () => {
    console.error(`mcp-aiven: HTTP listening on port ${config.port}`);
  });
}
