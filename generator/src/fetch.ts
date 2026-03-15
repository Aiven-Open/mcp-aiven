/**
 * Fetch OpenAPI specification from Aiven API
 */

const OPENAPI_URL = 'https://api.aiven.io/doc/openapi.json';

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

export async function fetchOpenApiSpec(): Promise<OpenApiSpec> {
  console.log(`Fetching OpenAPI spec from ${OPENAPI_URL}...`);

  const response = await fetch(OPENAPI_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`);
  }

  const spec = (await response.json()) as OpenApiSpec;
  console.log(`Fetched OpenAPI ${spec.openapi} - ${spec.info.title} v${spec.info.version}`);

  return spec;
}
