import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import express from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Request, Response, NextFunction } from 'express';
import { HOST, parseScopes, parseWriteAllowlist, isMaintenanceMode, isExtraProtectionEnabled, loadEdgeAuthSecret } from './config.js';
import type { HttpMcpRateLimitConfig } from './config.js';
import type { McpServerFactory, McpRequestOptions } from './types.js';
import { resolveAuthorizationServer, buildResourceUrl } from './marketplace.js';
import { captureException } from './instrumentation/index.js';
import { createEdgeAuthMiddleware, hasValidEdgeAuth } from './edge-auth.js';

const IPV4_MAPPED_IPV6_PREFIX = '::ffff:';

/** Strip `::ffff:` prefix from IPv4-mapped IPv6 (Node dual-stack sockets emit this form). */
function normalizePeerIp(ip: string | undefined): string | undefined {
  if (ip === undefined) return undefined;
  if (ip.toLowerCase().startsWith(IPV4_MAPPED_IPV6_PREFIX)) {
    const v4 = ip.slice(IPV4_MAPPED_IPV6_PREFIX.length);
    if (isIP(v4) === 4) return v4;
  }
  return ip;
}

export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}

export interface HttpServerConfig {
  port: number;
  apiOrigin: string;
  scopes: string[];
  rateLimit: HttpMcpRateLimitConfig;
  readOnly: boolean;
  extraProtection: boolean;
  edgeAuthSecret: string | undefined;
}

const RATE_LIMIT_PROPERTY = 'rateLimit' as const;
const NO_BEARER_RATE_LIMIT_KEY = '__no_bearer__';

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

function createHttpAuthRateLimit(): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs: 10 * 1000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait before trying again.' },
    handler: rateLimitExceededHandler('http-auth'),
    skip: (req) => req.method === 'GET' && req.path === '/health',
  });
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
    keyGenerator: (req: Request) => bearerRateLimitKey(req),
    message,
    handler: rateLimitExceededHandler('mcp-post-bearer'),
  });
}

/** Set by Cloudflare Transform Rule from ip.src / CF-Connecting-IP at the edge. */
export const CLIENT_IP_HEADER = 'x-client-ip';

function clientIpFromEdgeHeader(req: Request): string | undefined {
  const raw = req.headers[CLIENT_IP_HEADER];
  const value = typeof raw === 'string' ? raw.trim() : undefined;
  if (value === undefined || value.length === 0 || isIP(value) === 0) return undefined;
  return value;
}

export interface ClientIpResolveOptions {
  extraProtection?: boolean;
  edgeAuthSecret?: string | undefined;
}

/** True when X-Client-IP may be trusted (valid X-Edge-Auth under EXTRA_PROTECTION). */
function trustEdgeClientIpHeader(req: Request, opts?: ClientIpResolveOptions): boolean {
  const extraProtection = opts?.extraProtection ?? isExtraProtectionEnabled();
  const secret =
    opts && 'edgeAuthSecret' in opts ? opts.edgeAuthSecret : loadEdgeAuthSecret();
  if (!extraProtection || !secret) return false;
  return hasValidEdgeAuth(req, secret);
}

export function inboundMcpClientIpFromRequest(
  req: Request,
  opts?: ClientIpResolveOptions
): string | undefined {
  if (trustEdgeClientIpHeader(req, opts)) {
    const fromHeader = clientIpFromEdgeHeader(req);
    if (fromHeader !== undefined) return fromHeader;
  }

  const peer = normalizePeerIp(req.socket.remoteAddress);
  const ip = req.ip ?? peer;
  if (!ip || ip === '127.0.0.1' || ip === '::1') return undefined;
  return ip;
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

export function bearerRateLimitKey(req: Request): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token.length > 0) {
      return createHash('sha256').update(token).digest('hex');
    }
  }
  return NO_BEARER_RATE_LIMIT_KEY;
}

const ALLOWED_MCP_QUERY_PARAMS = new Set([
  'read_only',
  'services_scope',
  'allow_secrets',
  'write_allowlist',
]);

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

  const rawAllowSecrets = query['allow_secrets'];

  if (Array.isArray(rawAllowSecrets)) {
    return { error: 'Duplicate query parameter: allow_secrets' };
  }

  if (rawAllowSecrets !== undefined && rawAllowSecrets !== 'true' && rawAllowSecrets !== 'false') {
    return { error: `Invalid value for allow_secrets: must be "true" or "false"` };
  }

  const allowSecrets = rawAllowSecrets === 'true';

  const rawWriteAllowlist = query['write_allowlist'];

  if (Array.isArray(rawWriteAllowlist)) {
    return { error: 'Duplicate query parameter: write_allowlist' };
  }

  if (rawWriteAllowlist !== undefined && typeof rawWriteAllowlist !== 'string') {
    return { error: 'Invalid value for write_allowlist: must be a comma-separated string' };
  }

  const writeAllowlist = readOnly ? parseWriteAllowlist(rawWriteAllowlist) : undefined;

  return { options: { readOnly, categories: parsed.categories, allowSecrets, writeAllowlist } };
}

export function startHttpServer(
  createServer: McpServerFactory,
  config: HttpServerConfig
): void {
  if (config.extraProtection && !config.edgeAuthSecret) {
    throw new Error('MCP_EDGE_AUTH_SECRET environment variable is required when EXTRA_PROTECTION=true');
  }

  const app = express();
  const openAiAppsChallengeToken = process.env['OPENAI_APPS_CHALLENGE_TOKEN'];

  if (openAiAppsChallengeToken) {
    app.get('/.well-known/openai-apps-challenge', (_req: Request, res: Response) => {
      res.type('text/plain').set('Cache-Control', 'no-store').send(openAiAppsChallengeToken);
    });
  }

  const edgeAuthMiddleware = createEdgeAuthMiddleware(
    config.extraProtection,
    config.edgeAuthSecret
  );

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

  app.use(createHttpAuthRateLimit());
  app.use(edgeAuthMiddleware);

  const mcpJsonParser = express.json({ limit: '512kb' });

  const mcpPostBearerRateLimit = createMcpPostBearerRateLimit(config.rateLimit, {
    error: 'Too many MCP requests. Please wait before trying again.',
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  const protectedResource = (req: Request, res: Response): void => {
    const tenant = typeof req.params['tenant'] === 'string' ? req.params['tenant'].toLowerCase() : undefined;
    res.json({
      resource: buildResourceUrl(HOST, tenant),
      authorization_servers: [resolveAuthorizationServer(tenant, config.apiOrigin)],
      scopes_supported: config.scopes,
      bearer_methods_supported: ['header'],
    });
  };
  app.get('/.well-known/oauth-protected-resource', protectedResource);
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResource);
  app.get('/.well-known/oauth-protected-resource/mcp/:tenant', protectedResource);

  app.get(['/mcp', '/mcp/:tenant'], (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').json({ error: 'Method Not Allowed' });
  });

  app.delete(['/mcp', '/mcp/:tenant'], (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').json({ error: 'Method Not Allowed' });
  });

  app.post(['/mcp', '/mcp/:tenant'], mcpPostBearerRateLimit, authMiddleware, mcpJsonParser, (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const parsed = parseMcpQueryParams(req.query as Record<string, unknown>, config.readOnly);
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const token = (req as Request & { token: string }).token;
      const clientIp = inboundMcpClientIpFromRequest(req, {
        extraProtection: config.extraProtection,
        edgeAuthSecret: config.edgeAuthSecret,
      });
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
