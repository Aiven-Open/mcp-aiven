import type { AivenConfig, HttpMethod } from './types.js';
import { type ApiResult, success, error } from './types.js';
import { createErrorFromResponse, createErrorFromException } from './errors.js';

export type { HttpMethod };

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  timeout?: number;
}

export class AivenClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly defaultTimeout: number;

  constructor(config: AivenConfig) {
    this.baseUrl = config.baseUrl;
    this.token = config.token;
    this.defaultTimeout = 30000; // 30 seconds
  }

  async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<ApiResult<T>> {
    try {
      const url = this.buildUrl(path, options?.query);
      const timeout = options?.timeout ?? this.defaultTimeout;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeout);

      try {
        const requestInit: RequestInit = {
          method,
          headers: {
            Authorization: `aivenv1 ${this.token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          signal: controller.signal,
        };

        if (body !== undefined) {
          requestInit.body = JSON.stringify(body);
        }

        const response = await fetch(url, requestInit);

        clearTimeout(timeoutId);

        if (!response.ok) {
          const apiError = await createErrorFromResponse(response);
          return error(apiError);
        }

        if (response.status === 204) {
          return success({} as T);
        }

        const data = (await response.json()) as T;
        return success(data);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return error({
          message: 'Request timed out',
          status: 0,
        });
      }
      return error(createErrorFromException(err));
    }
  }

  async get<T>(path: string, options?: RequestOptions): Promise<ApiResult<T>> {
    return this.request<T>('GET', path, undefined, options);
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<T>> {
    return this.request<T>('POST', path, body, options);
  }

  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<T>> {
    return this.request<T>('PUT', path, body, options);
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<ApiResult<T>> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  async patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<T>> {
    return this.request<T>('PATCH', path, body, options);
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>
  ): string {
    const base = this.baseUrl.replace(/\/$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${base}${normalizedPath}`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }
}
