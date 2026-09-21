import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AivenClient } from '../../src/client.js';
import { createApplicationTools } from '../../src/tools/applications/handlers.js';
import { deployApplicationInput } from '../../src/tools/applications/schemas.js';
import { loadApiTools } from '../../src/tools/registry.js';
import type { ApplicationServiceCredentialUserConfig } from '../../src/tools/integrations/schemas.js';
import type { ToolDefinition } from '../../src/types.js';

const configs: Array<{
  serviceType: ApplicationServiceCredentialUserConfig['service_type'];
  userConfig: ApplicationServiceCredentialUserConfig;
}> = [
  {
    serviceType: 'pg',
    userConfig: {
      service_type: 'pg',
      exposed_values: {
        connection_string: { environment_variable_key: 'DATABASE_URL' },
      },
      source_service_parameters: {
        user: 'app_user',
        database: 'app_database',
      },
    },
  },
  {
    serviceType: 'valkey',
    userConfig: {
      service_type: 'valkey',
      exposed_values: {
        connection_string: { environment_variable_key: 'VALKEY_URL' },
      },
    },
  },
  {
    serviceType: 'kafka',
    userConfig: {
      service_type: 'kafka',
      exposed_values: {
        bootstrap_servers: { environment_variable_key: 'KAFKA_BROKERS' },
        security_protocol: { environment_variable_key: 'KAFKA_PROTOCOL' },
        access_key: { environment_variable_key: 'KAFKA_SSL_KEY' },
        access_cert: { environment_variable_key: 'KAFKA_SSL_CERT' },
        ca_cert: { environment_variable_key: 'KAFKA_SSL_CA_CERT' },
      },
    },
  },
  {
    serviceType: 'opensearch',
    userConfig: {
      service_type: 'opensearch',
      exposed_values: {
        connection_string: { environment_variable_key: 'OPENSEARCH_URL' },
      },
    },
  },
];

const applicationCreateInputs = configs.map(({ serviceType, userConfig }) => ({
  integration_type: 'application_service_credential' as const,
  source_service: `${serviceType}-service`,
  user_config: userConfig,
}));

function integration(
  serviceType: string,
  userConfig: ApplicationServiceCredentialUserConfig
): Record<string, unknown> {
  return {
    service_integration_id: `integration-${serviceType}`,
    integration_type: 'application_service_credential',
    source_project: 'test-project',
    source_service: `${serviceType}-service`,
    source_service_type: serviceType,
    dest_project: 'test-project',
    dest_service: 'example-app',
    dest_service_type: 'application',
    enabled: true,
    active: true,
    user_config: userConfig,
    password: 'resolved-password-must-not-be-returned',
    service_uri: `${serviceType}://user:password@example.invalid`,
  };
}

function createMockClient(
  serviceType: string,
  userConfig: ApplicationServiceCredentialUserConfig
): AivenClient {
  const value = integration(serviceType, userConfig);
  return {
    get: vi.fn().mockImplementation((path: string) => {
      if (path.endsWith('/integration')) {
        return Promise.resolve({ service_integrations: [value] });
      }
      return Promise.resolve({ service_integration: value });
    }),
    request: vi.fn().mockResolvedValue({ service_integration: value }),
    delete: vi.fn().mockResolvedValue({}),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  } as unknown as AivenClient;
}

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`${name} tool not found`);
  return tool;
}

function resultText(result: Awaited<ReturnType<ToolDefinition['handler']>>): string {
  const content = result.content[0];
  if (content?.type !== 'text') throw new Error('Expected text tool result');
  return content.text;
}

function parseResult(result: Awaited<ReturnType<ToolDefinition['handler']>>): unknown {
  const match = resultText(result).match(
    /<untrusted-aiven-response-[^>]+>\n([\s\S]*?)\n<\/untrusted-aiven-response-/
  );
  if (!match) throw new Error('Could not find untrusted response in tool result');
  return JSON.parse(match[1] ?? '');
}

describe('application service credential integration tools', () => {
  it.each(configs)(
    'supports the create, inspect, update, and delete workflow for $serviceType',
    async ({ serviceType, userConfig }) => {
      const client = createMockClient(serviceType, userConfig);
      const tools = loadApiTools(client);
      const create = getTool(tools, 'aiven_service_integration_create');
      const list = getTool(tools, 'aiven_service_integration_list');
      const get = getTool(tools, 'aiven_service_integration_get');
      const update = getTool(tools, 'aiven_service_integration_update');
      const remove = getTool(tools, 'aiven_service_integration_delete');
      const integrationId = `integration-${serviceType}`;

      await create.handler({
        project: 'test-project',
        integration_type: 'application_service_credential',
        source_service: `${serviceType}-service`,
        dest_service: 'example-app',
        user_config: userConfig,
      });
      const listResult = await list.handler({
        project: 'test-project',
        service_name: `${serviceType}-service`,
      });
      const getResult = await get.handler({
        project: 'test-project',
        integration_id: integrationId,
      });
      await update.handler({
        project: 'test-project',
        integration_id: integrationId,
        user_config: userConfig,
      });
      await remove.handler({
        project: 'test-project',
        integration_id: integrationId,
      });

      expect(client.request).toHaveBeenCalledWith(
        'POST',
        '/project/test-project/integration',
        {
          integration_type: 'application_service_credential',
          source_service: `${serviceType}-service`,
          dest_service: 'example-app',
          user_config: userConfig,
        },
        expect.any(Object)
      );
      expect(client.request).toHaveBeenCalledWith(
        'PUT',
        `/project/test-project/integration/${integrationId}`,
        { user_config: userConfig },
        expect.any(Object)
      );
      expect(client.delete).toHaveBeenCalledWith(
        `/project/test-project/integration/${integrationId}`,
        expect.any(Object)
      );

      expect(parseResult(listResult)).toEqual(
        expect.objectContaining({
          service_integrations: [
            expect.objectContaining({
              service_integration_id: integrationId,
              source_service: `${serviceType}-service`,
              dest_service: 'example-app',
              user_config: userConfig,
            }),
          ],
        })
      );
      expect(parseResult(getResult)).toEqual({
        service_integration: expect.objectContaining({
          user_config: userConfig,
          password: '[REDACTED]',
          service_uri: '[REDACTED]',
        }),
      });
      expect(resultText(getResult)).not.toContain('resolved-password-must-not-be-returned');
      expect(resultText(getResult)).not.toContain('user:password');
    }
  );

  it.each(configs)(
    'rejects omitted $serviceType mappings before create',
    async ({ userConfig }) => {
      const client = createMockClient(userConfig.service_type, userConfig);
      const create = getTool(loadApiTools(client), 'aiven_service_integration_create');
      const result = await create.handler({
        project: 'test-project',
        integration_type: 'application_service_credential',
        source_service: `${userConfig.service_type}-service`,
        dest_service: 'example-app',
        user_config: {
          service_type: userConfig.service_type,
          exposed_values: {},
        },
      });

      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain('Invalid application_service_credential user_config');
      expect(client.request).not.toHaveBeenCalled();
    }
  );

  it('validates a complete update before sending the PUT', async () => {
    const kafka = configs.find(({ serviceType }) => serviceType === 'kafka');
    if (!kafka) throw new Error('Kafka test configuration missing');
    const client = createMockClient(kafka.serviceType, kafka.userConfig);
    const update = getTool(loadApiTools(client), 'aiven_service_integration_update');

    const result = await update.handler({
      project: 'test-project',
      integration_id: 'integration-kafka',
      user_config: {
        service_type: 'kafka',
        exposed_values: {
          bootstrap_servers: { environment_variable_key: 'KAFKA_BROKERS' },
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(client.get).toHaveBeenCalledWith(
      '/project/test-project/integration/integration-kafka',
      expect.any(Object)
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('directs source service type changes to delete and recreate', async () => {
    const pg = configs.find(({ serviceType }) => serviceType === 'pg');
    const valkey = configs.find(({ serviceType }) => serviceType === 'valkey');
    if (!pg || !valkey) throw new Error('Connection-string test configurations missing');
    const client = createMockClient(pg.serviceType, pg.userConfig);
    const update = getTool(loadApiTools(client), 'aiven_service_integration_update');

    const result = await update.handler({
      project: 'test-project',
      integration_id: 'integration-pg',
      user_config: valkey.userConfig,
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('Delete and recreate');
    expect(client.request).not.toHaveBeenCalled();
  });

  it('keeps other integration types available through generic user_config', async () => {
    const client = createMockClient(
      'pg',
      configs[0]?.userConfig as ApplicationServiceCredentialUserConfig
    );
    const create = getTool(loadApiTools(client), 'aiven_service_integration_create');
    const input = {
      project: 'test-project',
      integration_type: 'metrics',
      source_service: 'pg-service',
      dest_endpoint_id: 'endpoint-id',
      user_config: { database: 'metrics' },
    };

    expect(create.definition.inputSchema.safeParse(input).success).toBe(true);
    await create.handler(input);

    expect(client.request).toHaveBeenCalledWith(
      'POST',
      '/project/test-project/integration',
      {
        integration_type: 'metrics',
        source_service: 'pg-service',
        dest_endpoint_id: 'endpoint-id',
        user_config: { database: 'metrics' },
      },
      expect.any(Object)
    );
  });

  it('passes other integration updates through after inspecting their type', async () => {
    const client = {
      get: vi.fn().mockResolvedValue({
        service_integration: {
          service_integration_id: 'metrics-integration',
          integration_type: 'metrics',
          user_config: { database: 'previous' },
        },
      }),
      request: vi.fn().mockResolvedValue({}),
      delete: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as AivenClient;
    const update = getTool(loadApiTools(client), 'aiven_service_integration_update');

    await update.handler({
      project: 'test-project',
      integration_id: 'metrics-integration',
      user_config: { database: 'metrics' },
    });

    expect(client.request).toHaveBeenCalledWith(
      'PUT',
      '/project/test-project/integration/metrics-integration',
      { user_config: { database: 'metrics' } },
      expect.any(Object)
    );
  });

  it('advertises typed mappings without MCP defaults', async () => {
    const client = createMockClient(
      'pg',
      configs[0]?.userConfig as ApplicationServiceCredentialUserConfig
    );
    const create = getTool(loadApiTools(client), 'aiven_service_integration_create');
    const update = getTool(loadApiTools(client), 'aiven_service_integration_update');
    const server = new McpServer({ name: 'integration-schema-test', version: '1.0.0' });

    for (const tool of [create, update]) {
      server.registerTool(
        tool.name,
        {
          title: tool.definition.title,
          description: tool.definition.description,
          inputSchema: tool.definition.inputSchema,
          annotations: tool.definition.annotations,
        },
        (params) => tool.handler(params)
      );
    }

    const mcpClient = new Client({ name: 'integration-schema-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
      const listedTools = await mcpClient.listTools();
      for (const name of [create.name, update.name]) {
        const schema = JSON.stringify(
          listedTools.tools.find((tool) => tool.name === name)?.inputSchema
        );
        expect(schema).toContain('bootstrap_servers');
        expect(schema).toContain('connection_string');
        expect(schema).not.toContain('"default"');
      }
    } finally {
      await mcpClient.close();
      await server.close();
    }
  });
});

describe('application creation with service credentials', () => {
  it.each(applicationCreateInputs)(
    'passes explicit $service_type mappings through unchanged',
    async (serviceIntegration) => {
      const client = {
        get: vi.fn().mockResolvedValue({ certificate: 'project-ca' }),
        post: vi.fn().mockResolvedValue({}),
        put: vi.fn(),
        delete: vi.fn(),
        patch: vi.fn(),
        request: vi.fn(),
      } as unknown as AivenClient;
      const create = getTool(createApplicationTools(client), 'aiven_application_create');
      const params = deployApplicationInput.parse({
        project: 'test-project',
        service_name: 'example-app',
        repository_url: 'https://github.com/aiven/example',
        branch: 'main',
        port: 8080,
        service_integrations: [serviceIntegration],
        reasoning: 'Create the application with an existing data service',
      });

      await create.handler(params);

      expect(client.post).toHaveBeenCalledWith(
        '/project/test-project/service',
        expect.objectContaining({
          service_integrations: [serviceIntegration],
        }),
        expect.any(Object)
      );
    }
  );
});
