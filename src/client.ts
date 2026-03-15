import createClient from 'openapi-fetch';
import type { paths } from './generated/aiven-api.js';
import type { AivenConfig, HttpMethod, RequestOptions } from './types.js';
import { AivenError } from './errors.js';
import { VERSION, API_BASE_URL } from './config.js';

export class AivenClient {
  private readonly token: string | undefined;
  private readonly defaultTimeout: number;
  private readonly fetchClient: ReturnType<typeof createClient<paths>>;

  constructor(config: AivenConfig) {
    this.token = config.token;
    this.defaultTimeout = 30000;
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
    const result = (await this.fetchClient.request(
      method.toLowerCase() as never,
      path as never,
      {
        params: options?.query ? { query: options.query } : undefined,
        body: body as never,
        headers: { Authorization: `Bearer ${token}` },
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
