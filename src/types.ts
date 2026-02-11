import type { z } from 'zod';

export enum ServiceCategory {
  Core = 'core',
  Pg = 'pg',
  Kafka = 'kafka',
}

export const SERVICE_CATEGORIES: ServiceCategory[] = Object.values(ServiceCategory);

export const ALL_SERVICES = 'all' as const;

export const DEFAULT_CONFIG = {
  baseUrl: 'https://api.aiven.io/v1',
  services: [ALL_SERVICES],
} as const;

export interface AivenConfig {
  readonly token: string;
  readonly baseUrl: string;
  readonly services: readonly string[];
}

export function isServiceCategory(value: string): value is ServiceCategory {
  return SERVICE_CATEGORIES.includes(value as ServiceCategory);
}

export function isAllServices(services: readonly string[]): boolean {
  return services.includes(ALL_SERVICES);
}

export function parseServices(servicesEnv: string | undefined): string[] {
  if (!servicesEnv || servicesEnv.trim() === '' || servicesEnv.trim() === ALL_SERVICES) {
    return [ALL_SERVICES];
  }

  const services = servicesEnv.split(',').map((s) => s.trim().toLowerCase());

  const validServices: ServiceCategory[] = [];
  for (const service of services) {
    if (isServiceCategory(service)) {
      validServices.push(service);
    } else if (service !== ALL_SERVICES) {
      console.warn(
        `Unknown service category: ${service}. Valid categories: ${SERVICE_CATEGORIES.join(', ')}`
      );
    }
  }

  if (validServices.length > 0 && !validServices.includes(ServiceCategory.Core)) {
    validServices.unshift(ServiceCategory.Core);
  }

  return validServices.length > 0 ? validServices : [ALL_SERVICES];
}

export interface AivenError {
  message: string;
  status: number;
  moreInfo?: string;
  errorCode?: string;
}

export type ApiResult<T> = { status: 'success'; data: T } | { status: 'error'; error: AivenError };

export function success<T>(data: T): ApiResult<T> {
  return { status: 'success', data };
}

export function error<T>(err: AivenError): ApiResult<T> {
  return { status: 'error', error: err };
}

export type ServiceState = 'POWEROFF' | 'REBALANCING' | 'REBUILDING' | 'RUNNING' | 'UNKNOWN';

export interface ToolAnnotations {
  /** Indicates the tool only reads data, no side effects */
  readOnlyHint: boolean;
  /** Indicates the tool may perform destructive operations */
  destructiveHint: boolean;
  /** Indicates the tool is idempotent (same input = same result) */
  idempotentHint: boolean;
  /** Indicates the tool interacts with external systems */
  openWorldHint: boolean;
}

export const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export const CREATE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export const UPDATE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export const DELETE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

export const WRITE_DML_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolResult {
  [key: string]: unknown;
  content: TextContent[];
  isError?: boolean;
}

export interface ToolDefinition<TInput extends z.ZodType = z.ZodType> {
  name: string;
  category: ServiceCategory;
  definition: {
    title: string;
    description: string;
    inputSchema: TInput;
    annotations: ToolAnnotations;
  };
  handler: (params: z.infer<TInput>) => Promise<ToolResult>;
}

function textContent(text: string): TextContent {
  return { type: 'text', text };
}

export function toolSuccess(data: unknown, format: boolean = false): ToolResult {
  const text = format
    ? JSON.stringify(data, null, 2)
    : typeof data === 'string'
      ? data
      : JSON.stringify(data);
  return {
    content: [textContent(text)],
  };
}

export function toolError(message: string): ToolResult {
  return {
    content: [textContent(message)],
    isError: true,
  };
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface ToolSpec {
  name: string;
  category: ServiceCategory;
  title: string;
  description: string;
  method: HttpMethod;
  path: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  annotations: ToolAnnotations;
  formatter?: string;
}
