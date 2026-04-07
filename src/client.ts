import createClient from 'openapi-fetch';
import type { paths } from './generated/aiven-api.js';
import type { AivenConfig, HttpMethod, RequestOptions } from './types.js';
import { AivenError } from './errors.js';
import { VERSION, API_BASE_URL } from './config.js';

export class AivenClient {
  private readonly token: string | undefined;
  private readonly defaultTimeout: number;
  private readonly transport: 'stdio' | 'http';
  private readonly fetchClient: ReturnType<typeof createClient<paths>>;

  constructor(config: AivenConfig) {
    this.token = config.token;
    this.defaultTimeout = 30000;
    this.transport = config.transport;
    this.fetchClient = createClient<paths>({
      baseUrl: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': `mcp-aiven/${VERSION}`,
      },
    });
  }

  async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    const token = options?.token ?? this.token;
    if (!token) {
      throw new AivenError(401, 'No authentication token available');
    }

    const timeout = options?.timeout ?? this.defaultTimeout;
    const perRequestHeaders = this.buildHeaders(token, options);
    this.logAivenRequest(method, path, perRequestHeaders);

    const result = (await this.fetchClient.request(
      method.toLowerCase() as never,
      path as never,
      {
        params: options?.query ? { query: options.query } : undefined,
        body: body as never,
        headers: perRequestHeaders,
        signal: AbortSignal.timeout(timeout),
      } as never,
    )) as {
      data?: unknown;
      error?: { message?: string; error_code?: string; more_info?: string };
      response: Response;
    };

    if (result.error) {
      throw new AivenError(
        result.response.status,
        `${result.error.message ?? result.response.statusText} [${method} ${API_BASE_URL}${path}]`,
        result.error.error_code,
        result.error.more_info,
      );
    }

    if (result.response.status === 204 || result.data === undefined) {
      return {} as T;
    }

    return result.data as T;
  }

  private logAivenRequest(method: HttpMethod, path: string, perRequestHeaders: Record<string, string>): void {
    const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
    const merged: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': `mcp-aiven/${VERSION}`,
      ...perRequestHeaders,
    };
    const forLog = { ...merged };
    if (forLog['Authorization']?.startsWith('Bearer ')) {
      forLog['Authorization'] = 'Bearer [REDACTED]';
    }
    console.error('mcp-aiven: Aiven request %s %s headers=%s', method, url, JSON.stringify(forLog));
  }

  private buildHeaders(token: string, options?: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'X-MCP-Transport': this.transport,
    };
    if (options?.toolName) {
      headers['X-MCP-Tool-Name'] = options.toolName;
    }
    if (options?.mcpClient) {
      headers['X-MCP-Client'] = options.mcpClient;
    }
    return headers;
  }

  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }
}
