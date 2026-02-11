/**
 * Fetch OpenAPI specification from Aiven API
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const OPENAPI_URL = 'https://api.aiven.io/doc/openapi.json';
const CACHE_DIR = path.join(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'openapi.json');

export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, SchemaObject>;
    parameters?: Record<string, ParameterObject>;
    responses?: Record<string, ResponseObject>;
  };
}

export interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  delete?: Operation;
  patch?: Operation;
  parameters?: ParameterObject[];
}

export interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: RequestBody;
  responses: Record<string, ResponseObject>;
  // MCP overlay extension fields
  'x-aiven-service'?: string;
  'x-mcp-description'?: string;
  'x-mcp-exclude'?: boolean;
  'x-mcp-tool-name'?: string;
  'x-mcp-formatter'?: string;
  'x-mcp-formatter-field'?: string;
  'x-mcp-formatter-needs-input'?: string;
}

export interface ParameterObject {
  $ref?: string;
  name?: string;
  in?: 'path' | 'query' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  schema?: SchemaObject;
}

export interface RequestBody {
  required?: boolean;
  content?: {
    'application/json'?: {
      schema?: SchemaObject;
    };
  };
}

export interface ResponseObject {
  description?: string;
  content?: {
    'application/json'?: {
      schema?: SchemaObject;
    };
  };
}

export interface SchemaObject {
  type?: string;
  format?: string;
  description?: string;
  enum?: string[];
  items?: SchemaObject;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  additionalProperties?: boolean | SchemaObject;
  $ref?: string;
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  default?: unknown;
  nullable?: boolean;
}

async function isCacheValid(): Promise<boolean> {
  try {
    const stats = await fs.stat(CACHE_FILE);
    const age = Date.now() - stats.mtimeMs;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    return age < maxAge;
  } catch {
    return false;
  }
}

async function readCache(): Promise<OpenApiSpec | null> {
  try {
    const content = await fs.readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(content) as OpenApiSpec;
  } catch {
    return null;
  }
}

async function writeCache(spec: OpenApiSpec): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(spec, null, 2));
}

async function fetchRemote(): Promise<OpenApiSpec> {
  console.log(`Fetching OpenAPI spec from ${OPENAPI_URL}...`);

  const response = await fetch(OPENAPI_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`);
  }

  const spec = (await response.json()) as OpenApiSpec;
  console.log(`Fetched OpenAPI ${spec.openapi} - ${spec.info.title} v${spec.info.version}`);

  return spec;
}

export async function fetchOpenApiSpec(options?: { refresh?: boolean }): Promise<OpenApiSpec> {
  if (!options?.refresh && (await isCacheValid())) {
    const cached = await readCache();
    if (cached) {
      console.log('Using cached OpenAPI spec');
      return cached;
    }
  }

  const spec = await fetchRemote();

  await writeCache(spec);
  console.log(`Cached OpenAPI spec to ${CACHE_FILE}`);

  return spec;
}
