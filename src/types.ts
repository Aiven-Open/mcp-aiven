import type { z } from 'zod';
import type { CallToolResult, TextContent } from '@modelcontextprotocol/sdk/types.js';
import { applyToolResultCharCap } from './tool-result-limit.js';

export enum ServiceCategory {
  Core = 'core',
  Pg = 'pg',
  Kafka = 'kafka',
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface AivenConfig {
  readonly token: string | undefined;
  readonly readOnly: boolean;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined> | undefined;
  timeout?: number | undefined;
  token?: string | undefined;
}

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
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

export type ToolResult = CallToolResult;

export interface HandlerContext {
  token?: string | undefined;
}

export interface ToolDefinition<TInput extends z.ZodType = z.ZodType> {
  name: string;
  category: ServiceCategory;
  definition: {
    title: string;
    description: string;
    inputSchema: TInput;
    annotations: ToolAnnotations;
    outputSchema?: z.ZodType | undefined;
  };
  handler: (params: z.infer<TInput>, context?: HandlerContext) => Promise<ToolResult>;
}

function textContent(text: string): TextContent {
  return { type: 'text' as const, text };
}

export function toolSuccess(data: string | Record<string, unknown>): ToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const capped = applyToolResultCharCap(text);
  return {
    content: [textContent(capped)],
  };
}

export function toolError(message: string): ToolResult {
  return {
    content: [textContent(message)],
    isError: true,
  };
}

export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: unknown;
  nullable?: boolean;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  format?: string;
}

export interface ResponseFilterConfig {
  key: string;
  fields: string[];
}

export interface ApiToolConfig {
  name: string;
  title: string;
  description: string;
  category: ServiceCategory;
  method: HttpMethod;
  path: string;
  inputSchema: z.ZodType;
  annotations: ToolAnnotations;
  defaults?: Record<string, unknown> | undefined;
  responseFilter?: ResponseFilterConfig | undefined;
}

export interface ServiceConnectionInfo {
  host: string;
  port: number;
  user: string;
  password: string;
  dbname: string;
}

export enum PgToolName {
  OptimizeQuery = 'aiven_pg_optimize_query',
  Read = 'aiven_pg_read',
  Write = 'aiven_pg_write',
}

export enum PgQueryMode {
  ReadOnly = 'read-only',
  ReadWrite = 'read-write',
}

export interface ExecutePgQueryOptions {
  project: string;
  service_name: string;
  query: string;
  database?: string | undefined;
  mode: PgQueryMode;
  limit?: number | undefined;
  offset?: number | undefined;
  token?: string | undefined;
}

export enum KafkaToolName {
  ConnectCreateConnector = 'aiven_kafka_connect_create_connector',
  ConnectEditConnector = 'aiven_kafka_connect_edit_connector',
}

