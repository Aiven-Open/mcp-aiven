import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AivenClient } from '../../src/client.js';
import {
  deployApplicationInput,
  vcsIntegrationInitializeInput,
  vcsIntegrationListInput,
  vcsIntegrationRepositoryBranchListInput,
  vcsIntegrationRepositoryContainerManifestFilesListInput,
  vcsIntegrationRepositoryScanContainerManifestInput,
} from '../../src/tools/applications/schemas.js';
import { createApplicationTools } from '../../src/tools/applications/handlers.js';
import { ApplicationToolName, type ToolDefinition } from '../../src/types.js';

function createMockClient(options: {
  getResponse?: unknown;
  getResponses?: unknown[];
  postResponse?: unknown;
}): AivenClient {
  const get = vi.fn();
  const getResponses = options.getResponses ?? [options.getResponse ?? {}];
  for (const response of getResponses) {
    get.mockResolvedValueOnce(response);
  }

  return {
    get,
    post: vi.fn().mockResolvedValue(options.postResponse ?? {}),
    put: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  } as unknown as AivenClient;
}

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`${name} tool not found`);
  return tool;
}

function parseResultPayload(result: Awaited<ReturnType<ToolDefinition['handler']>>): unknown {
  const content = result.content[0];
  if (content?.type !== 'text') throw new Error('Expected text tool result');

  const match = content.text.match(
    /<untrusted-aiven-response-[^>]+>\n([\s\S]*?)\n<\/untrusted-aiven-response-/
  );
  if (!match) throw new Error('Could not find untrusted response in tool result');
  return JSON.parse(match[1] ?? '');
}

const refParams = {
  organization_id: 'org/id',
  vcs_integration_id: 'vcs id',
  remote_repository_id: 'repo/id',
  commit_sha: 'abc/123',
  reasoning: 'Inspect the selected repository',
};

describe('application repository scan tools', () => {
  it('exposes create as the primary application creation tool and keeps deploy as an alias', () => {
    const tools = createApplicationTools(createMockClient({}));
    const createTool = getTool(tools, ApplicationToolName.Create);
    const deployAlias = getTool(tools, ApplicationToolName.Deploy);

    expect(createTool.definition.title).toBe('Create Application on Aiven');
    expect(deployAlias.definition.title).toContain('Deprecated');
    expect(deployAlias.definition.description).toContain(
      `Use \`${ApplicationToolName.Create}\` instead`
    );
    expect(deployAlias.handler).toBe(createTool.handler);
  });

  it('advertises application create arrays and Kafka integrations through MCP tools/list', async () => {
    const tool = getTool(createApplicationTools(createMockClient({})), ApplicationToolName.Create);
    const server = new McpServer({ name: 'application-schema-test', version: '1.0.0' });
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

    const client = new Client({ name: 'application-schema-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const result = await client.listTools();
      const listedTool = result.tools.find(({ name }) => name === tool.name);
      const properties = listedTool?.inputSchema.properties;

      expect(properties).toHaveProperty('environment_variables');
      expect(properties).toHaveProperty('service_integrations');
      expect(properties?.['environment_variables']).toMatchObject({ type: 'array' });
      expect(properties?.['service_integrations']).toMatchObject({ type: 'array' });
      expect(JSON.stringify(properties?.['service_integrations'])).toContain('"kafka"');
      expect(JSON.stringify(properties?.['service_integrations'])).not.toContain('must be RUNNING');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('requires VCS integration and repository IDs together without wrapping the tool schema', async () => {
    const client = createMockClient({});
    const tool = getTool(createApplicationTools(client), ApplicationToolName.Create);
    const baseParams = {
      project: 'test-project',
      service_name: 'example-app',
      repository_url: 'https://github.com/aiven/example',
      branch: 'main',
      port: 3000,
      reasoning: 'Deploy the selected application',
    };

    const missingRepositoryId = deployApplicationInput.parse({
      ...baseParams,
      vcs_integration_id: 'vcs-example',
    });
    const missingIntegrationId = deployApplicationInput.parse({
      ...baseParams,
      remote_repository_id: '123456',
    });

    expect(await tool.handler(missingRepositoryId)).toEqual(
      expect.objectContaining({ isError: true })
    );
    expect(await tool.handler(missingIntegrationId)).toEqual(
      expect.objectContaining({ isError: true })
    );
    expect(
      deployApplicationInput.safeParse({
        ...baseParams,
        vcs_integration_id: 'vcs-example',
        remote_repository_id: '123456',
      }).success
    ).toBe(true);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('passes an explicit containerfile path when creating an application', async () => {
    const client = createMockClient({ postResponse: {} });
    const tool = getTool(createApplicationTools(client), ApplicationToolName.Create);
    const params = deployApplicationInput.parse({
      project: 'test-project',
      service_name: 'example-app',
      repository_url: 'https://github.com/aiven/example',
      branch: 'main',
      build_path: 'backend',
      containerfile_path: 'docker/Dockerfile.prod',
      port: 3000,
      reasoning: 'Deploy the selected application',
    });

    await tool.handler(params);

    expect(client.post).toHaveBeenCalledWith(
      '/project/test-project/service',
      expect.objectContaining({
        user_config: {
          application: expect.objectContaining({
            source: {
              repository_url: 'https://github.com/aiven/example.git',
              branch: 'main',
              build_path: './backend',
              containerfile_path: './docker/Dockerfile.prod',
            },
          }),
        },
      }),
      expect.any(Object)
    );
  });

  it('passes typed Kafka credentials and environment variables through application create', async () => {
    const client = createMockClient({ postResponse: {} });
    const tool = getTool(createApplicationTools(client), ApplicationToolName.Create);
    const params = deployApplicationInput.parse({
      project: 'test-project',
      service_name: 'example-app',
      repository_url: 'https://github.com/aiven/example',
      branch: 'main',
      port: 8080,
      environment_variables: [{ key: 'KAFKA_TOPIC', value: 'events' }],
      service_integrations: [
        {
          service_type: 'kafka',
          service_name: 'example-kafka',
          bootstrap_servers_env: 'KAFKA_BROKERS',
        },
      ],
      reasoning: 'Deploy the application with Kafka credentials',
    });

    await tool.handler(params);

    expect(client.post).toHaveBeenCalledWith(
      '/project/test-project/service',
      expect.objectContaining({
        service_integrations: [
          {
            integration_type: 'application_service_credential',
            source_service: 'example-kafka',
            user_config: {
              service_type: 'kafka',
              exposed_values: {
                bootstrap_servers: { environment_variable_key: 'KAFKA_BROKERS' },
                security_protocol: {
                  environment_variable_key: 'KAFKA_SECURITY_PROTOCOL',
                },
                access_key: { environment_variable_key: 'KAFKA_ACCESS_KEY' },
                access_cert: { environment_variable_key: 'KAFKA_ACCESS_CERT' },
                ca_cert: { environment_variable_key: 'KAFKA_CA_CERT' },
              },
            },
          },
        ],
        user_config: {
          application: expect.objectContaining({
            environment_variables: [
              { key: 'KAFKA_TOPIC', value: 'events', kind: 'variable' },
            ],
          }),
        },
      }),
      expect.any(Object)
    );
  });

  it('does not append a Git suffix to non-GitHub repository URLs', async () => {
    const client = createMockClient({ postResponse: {} });
    const tool = getTool(createApplicationTools(client), ApplicationToolName.Create);
    const params = deployApplicationInput.parse({
      project: 'test-project',
      service_name: 'example-app',
      repository_url: 'https://gitlab.com/aiven/example',
      branch: 'main',
      port: 3000,
      reasoning: 'Deploy the selected application',
    });

    await tool.handler(params);

    expect(client.post).toHaveBeenCalledWith(
      '/project/test-project/service',
      expect.objectContaining({
        user_config: {
          application: expect.objectContaining({
            source: expect.objectContaining({
              repository_url: 'https://gitlab.com/aiven/example',
            }),
          }),
        },
      }),
      expect.any(Object)
    );
  });

  it('reports application creation as asynchronous without replacing the API state', async () => {
    const client = createMockClient({
      postResponse: {
        service: {
          service_name: 'example-app',
          service_type: 'application',
          state: 'BUILDING',
          plan: 'startup-50-1024',
          cloud_name: 'aws-eu-west-1',
        },
      },
    });
    const tool = getTool(createApplicationTools(client), ApplicationToolName.Create);
    const params = deployApplicationInput.parse({
      project: 'test-project',
      service_name: 'example-app',
      repository_url: 'https://github.com/aiven/example',
      branch: 'main',
      port: 3000,
      reasoning: 'Deploy the selected application',
    });

    const result = await tool.handler(params);

    expect(parseResultPayload(result)).toEqual(
      expect.objectContaining({
        service_name: 'example-app',
        state: 'BUILDING',
        message: 'Application created. The initial deployment is continuing asynchronously.',
        next_tool: 'aiven_service_get',
        next_step: expect.stringContaining('may not reflect the deployment immediately'),
      })
    );
  });

  it('reports redeploy as triggered rather than completed', async () => {
    const client = createMockClient({});
    const tool = getTool(createApplicationTools(client), ApplicationToolName.Redeploy);

    const result = await tool.handler({
      project: 'test-project',
      service_name: 'example-app',
      reasoning: 'Redeploy the application',
    });

    expect(client.post).toHaveBeenCalledWith(
      '/project/test-project/service/example-app/application/redeploy',
      {},
      expect.any(Object)
    );
    expect(parseResultPayload(result)).toEqual(
      expect.objectContaining({
        service_name: 'example-app',
        branch: 'current',
        message: 'Redeploy triggered. The deployment is continuing asynchronously.',
        next_tool: 'aiven_service_get',
        next_step: expect.stringContaining('may not reflect the deployment immediately'),
      })
    );
  });

  it('starts the GitHub connection flow and tells the agent to wait for the user', async () => {
    const client = createMockClient({
      getResponse: {
        organization_name: 'Example Organization',
      },
      postResponse: {
        redirect_url: 'https://github.com/apps/aiven/installations/select_target',
      },
    });
    const tool = getTool(
      createApplicationTools(client),
      ApplicationToolName.VcsIntegrationInitialize
    );
    const params = vcsIntegrationInitializeInput.parse({
      organization_id: 'org/id',
      reasoning: 'Connect a GitHub account to Aiven',
    });

    const result = await tool.handler(params, {
      token: 'token',
      requestId: 'request-id',
      toolReasoning: 'Connect a GitHub account to Aiven',
    });

    expect(tool.definition.annotations.readOnlyHint).toBe(false);
    expect(tool.definition.description).toContain('browser-based GitHub connection flow');
    expect(tool.definition.description).toContain("repository owner's GitHub account");
    expect(tool.definition.description).toContain('admin of the Aiven organization');
    expect(tool.definition.description).toContain('owner of that GitHub organization');
    expect(tool.definition.description).toContain('personal GitHub account');
    expect(tool.definition.description).toContain('which named Aiven organization');
    expect(client.get).toHaveBeenCalledWith('/organization/org%2Fid', {
      token: 'token',
      requestId: 'request-id',
      toolReasoning: 'Connect a GitHub account to Aiven',
    });
    expect(client.post).toHaveBeenCalledWith(
      '/organization/org%2Fid/application/vcs-integration-initialize',
      { vcs_type: 'github' },
      {
        token: 'token',
        requestId: 'request-id',
        toolReasoning: 'Connect a GitHub account to Aiven',
      }
    );
    expect(parseResultPayload(result)).toEqual({
      organization_id: 'org/id',
      organization_name: 'Example Organization',
      vcs_type: 'github',
      redirect_url: 'https://github.com/apps/aiven/installations/select_target',
      message: 'Open redirect_url in a browser to connect a GitHub account to Aiven.',
      user_instructions: [
        'Complete the GitHub setup. After being redirected to Aiven Console, select the Aiven organization "Example Organization", then click "Confirm connection". When finished, return to this conversation and confirm the connection was completed.',
      ],
      next_tool: ApplicationToolName.VcsIntegrationList,
      next_step: expect.stringContaining('Wait for the user to confirm'),
    });
  });

  it('lists VCS integrations directly by organization ID', async () => {
    const client = createMockClient({
      getResponse: {
        vcs_integrations: [
          {
            vcs_integration_id: 'vcs-1',
            vcs_account_name: 'aiven',
            vcs_type: 'github',
          },
        ],
      },
    });
    const tool = getTool(createApplicationTools(client), ApplicationToolName.VcsIntegrationList);
    const params = vcsIntegrationListInput.parse({
      organization_id: 'org/id',
      reasoning: 'Find connected repositories',
    });

    const result = await tool.handler(params, {
      token: 'token',
      requestId: 'request-id',
      toolReasoning: 'Find connected repositories',
    });

    expect(tool.definition.description).toContain('organization-wide VCS integrations');
    expect(tool.definition.description).toContain('do not enumerate unrelated repositories');
    expect(client.get).toHaveBeenCalledOnce();
    expect(client.get).toHaveBeenCalledWith('/organization/org%2Fid/application/vcs-integrations', {
      token: 'token',
      requestId: 'request-id',
      toolReasoning: 'Find connected repositories',
    });
    expect(parseResultPayload(result)).toEqual({
      organization_id: 'org/id',
      vcs_integrations: [
        {
          vcs_integration_id: 'vcs-1',
          vcs_account_name: 'aiven',
          vcs_type: 'github',
        },
      ],
      next_step: expect.stringContaining('compare the owner'),
    });
  });

  it('tells the agent a missing repository is recoverable rather than a dead end', async () => {
    const client = createMockClient({
      getResponse: {
        repositories: [
          {
            remote_repository_id: 'repo-1',
            vcs_integration_id: 'vcs-1',
            vcs_type: 'github',
            full_name: 'aiven/other-repo',
            name: 'other-repo',
            source_url: 'https://github.com/aiven/other-repo',
            default_branch_name: 'main',
          },
        ],
        next: null,
      },
    });
    const tool = getTool(
      createApplicationTools(client),
      ApplicationToolName.VcsIntegrationRepositoryList
    );

    const result = await tool.handler({
      organization_id: refParams.organization_id,
      vcs_integration_id: refParams.vcs_integration_id,
      reasoning: 'Find the repository to deploy',
    });
    const payload = parseResultPayload(result) as { no_match_next_step: string };

    expect(payload.no_match_next_step).toContain('grant that repository');
    expect(payload.no_match_next_step).toContain('result is truncated');
    expect(payload.no_match_next_step).toContain(ApplicationToolName.VcsIntegrationInitialize);
  });

  it('defines strict input schemas for manifest discovery and scanning', () => {
    expect(
      vcsIntegrationRepositoryBranchListInput.safeParse({
        organization_id: refParams.organization_id,
        vcs_integration_id: refParams.vcs_integration_id,
        remote_repository_id: refParams.remote_repository_id,
        reasoning: refParams.reasoning,
      }).success
    ).toBe(true);
    expect(
      vcsIntegrationRepositoryContainerManifestFilesListInput.safeParse(refParams).success
    ).toBe(true);
    expect(
      vcsIntegrationRepositoryScanContainerManifestInput.safeParse({
        ...refParams,
        repository_url: 'https://github.com/aiven/example',
        branch: 'main',
        file_path: 'Dockerfile',
      }).success
    ).toBe(true);
    expect(
      vcsIntegrationRepositoryScanContainerManifestInput.safeParse({
        ...refParams,
        repository_url: 'https://github.com/aiven/example',
        branch: 'main',
        file_path: 'Dockerfile',
        unexpected: true,
      }).success
    ).toBe(false);
  });

  it('lists repository branches and their current commit SHAs', async () => {
    const client = createMockClient({
      getResponse: {
        branches: [
          { name: 'main', commit_sha: 'main-sha' },
          { name: 'feature/app', commit_sha: 'feature-sha' },
        ],
        next: null,
      },
    });
    const tool = getTool(
      createApplicationTools(client),
      ApplicationToolName.VcsIntegrationRepositoryBranchList
    );

    const result = await tool.handler(
      {
        organization_id: refParams.organization_id,
        vcs_integration_id: refParams.vcs_integration_id,
        remote_repository_id: refParams.remote_repository_id,
        reasoning: refParams.reasoning,
      },
      {
        token: 'token',
        requestId: 'request-id',
        toolReasoning: 'Resolve the selected branch',
      }
    );

    expect(client.get).toHaveBeenCalledWith(
      '/organization/org%2Fid/application/vcs-integrations/vcs%20id/repositories/repo%2Fid/branches',
      {
        token: 'token',
        requestId: 'request-id',
        toolReasoning: 'Resolve the selected branch',
        query: { limit: 100 },
      }
    );
    expect(parseResultPayload(result)).toEqual({
      branches: [
        { name: 'main', commit_sha: 'main-sha' },
        { name: 'feature/app', commit_sha: 'feature-sha' },
      ],
      next: null,
      truncated: false,
    });
  });

  it('explains when branches beyond the result cap may be omitted', async () => {
    const getResponses = Array.from({ length: 10 }, (_, page) => ({
      branches: Array.from({ length: 100 }, (_, branch) => ({
        name: `branch-${String(page * 100 + branch)}`,
        commit_sha: `sha-${String(page * 100 + branch)}`,
      })),
      next: `cursor-${String(page + 1)}`,
    }));
    const client = createMockClient({ getResponses });
    const tool = getTool(
      createApplicationTools(client),
      ApplicationToolName.VcsIntegrationRepositoryBranchList
    );

    const result = await tool.handler({
      organization_id: refParams.organization_id,
      vcs_integration_id: refParams.vcs_integration_id,
      remote_repository_id: refParams.remote_repository_id,
      reasoning: refParams.reasoning,
    });
    const payload = parseResultPayload(result) as {
      branches: unknown[];
      next: string;
      truncated: boolean;
    };

    expect(payload.branches).toHaveLength(1000);
    expect(payload.next).toBe('cursor-10');
    expect(payload.truncated).toBe(true);
    expect(tool.definition.description).toContain(
      'Do not conclude that the branch does not exist'
    );
  });

  it('lists manifest files at an encoded repository ref', async () => {
    const apiResponse = {
      container_manifest_files: [
        {
          file_path: 'Dockerfile',
          file_sha: 'file-sha',
          container_manifest_type: 'containerfile',
        },
        {
          file_path: 'compose.yaml',
          file_sha: 'compose-sha',
          container_manifest_type: 'compose',
        },
      ],
    };
    const client = createMockClient({ getResponse: apiResponse });
    const tool = getTool(
      createApplicationTools(client),
      ApplicationToolName.VcsIntegrationRepositoryContainerManifestFilesList
    );

    const result = await tool.handler(refParams, {
      token: 'token',
      requestId: 'request-id',
      toolReasoning: 'Inspect the selected repository',
    });

    expect(tool.definition.annotations.readOnlyHint).toBe(true);
    expect(tool.definition.description).toContain('Discovery does not validate file contents');
    expect(tool.definition.description).toContain(
      'aiven_vcs_integration_repository_branch_list'
    );
    expect(tool.definition.description).toContain('larger than 1 MiB');
    expect(client.get).toHaveBeenCalledWith(
      '/organization/org%2Fid/application/vcs-integrations/vcs%20id/repositories/repo%2Fid/refs/abc%2F123/container-manifest-files',
      {
        token: 'token',
        requestId: 'request-id',
        toolReasoning: 'Inspect the selected repository',
      }
    );
    expect(parseResultPayload(result)).toEqual(apiResponse);
  });

  it('scans a selected manifest and returns the useful scan summary', async () => {
    const client = createMockClient({
      postResponse: {
        file_scan: {
          container_manifest_type: 'containerfile',
          raw_contents: [{ file_path: 'Dockerfile', raw_contents: 'RlJPTSBub2Rl' }],
          scanned_attributes: [
            {
              attribute_type: 'port',
              description: 'Exposed port 3000',
              file_path: 'Dockerfile',
              line_number: 2,
              value: '3000',
            },
          ],
          service_suggestions: [{ service_type: 'application', service_name: 'example' }],
        },
      },
    });
    const tool = getTool(
      createApplicationTools(client),
      ApplicationToolName.VcsIntegrationRepositoryScanContainerManifest
    );

    const result = await tool.handler(
      {
        ...refParams,
        repository_url: 'https://github.com/aiven/example',
        branch: 'main',
        file_path: 'Dockerfile',
      },
      { token: 'token' }
    );

    expect(tool.definition.annotations.readOnlyHint).toBe(true);
    expect(client.post).toHaveBeenCalledWith(
      '/organization/org%2Fid/application/vcs-integrations/vcs%20id/repositories/repo%2Fid/refs/abc%2F123/scan-container-manifest',
      {
        repository_url: 'https://github.com/aiven/example',
        branch: 'main',
        file_path: 'Dockerfile',
      },
      {
        token: 'token',
        requestId: undefined,
        toolReasoning: undefined,
      }
    );
    expect(parseResultPayload(result)).toEqual({
      file_scan: {
        container_manifest_type: 'containerfile',
        scanned_attributes: [
          {
            attribute_type: 'port',
            description: 'Exposed port 3000',
            file_path: 'Dockerfile',
            line_number: 2,
            value: '3000',
          },
        ],
        service_suggestions: [{ service_type: 'application', service_name: 'example' }],
      },
    });
  });

  it('turns a Compose scan into actionable service-create suggestions', async () => {
    const serviceSuggestions = [
      {
        service_type: 'pg',
        service_name: 'example-db',
      },
      {
        service_type: 'application',
        service_name: 'example-api',
        service_integrations: [
          {
            integration_type: 'application_service_credential',
            source_service: 'example-db',
            user_config: {
              service_type: 'pg',
              exposed_values: {
                connection_string: {
                  environment_variable_key: 'DATABASE_URL',
                },
              },
            },
          },
        ],
        user_config: {
          application: {
            source: {
              vcs_integration_id: 'vcs id',
              remote_repository_id: 'repo/id',
              repository_url: 'https://github.com/aiven/example.git',
              branch: 'main',
              build_path: './api',
              containerfile_path: './api/Dockerfile',
            },
            ports: [{ name: 'default', port: 3000, protocol: 'HTTP' }],
            environment_variables: [
              { key: 'LOG_LEVEL', value: 'debug', kind: 'variable' },
            ],
          },
        },
      },
    ];
    const client = createMockClient({
      postResponse: {
        file_scan: {
          container_manifest_type: 'compose',
          raw_contents: [{ file_path: 'compose.yaml', raw_contents: 'c2VydmljZXM6' }],
          scanned_attributes: [
            {
              attribute_type: 'environment_variable',
              description: 'Environment variable DATABASE_URL=postgres://user:pass@db/app',
              file_path: 'compose.yaml',
              line_number: 5,
              value: 'DATABASE_URL=postgres://user:pass@db/app',
            },
            {
              attribute_type: 'environment_variable',
              description: 'Environment variable LOG_LEVEL=debug',
              file_path: 'compose.yaml',
              line_number: 6,
              value: 'LOG_LEVEL=debug',
            },
          ],
          service_suggestions: serviceSuggestions,
        },
      },
    });
    const tools = createApplicationTools(client);
    const tool = getTool(
      tools,
      ApplicationToolName.VcsIntegrationRepositoryScanContainerManifest
    );

    const result = await tool.handler({
      ...refParams,
      repository_url: 'https://github.com/aiven/example',
      branch: 'main',
      file_path: 'compose.yaml',
    });
    const payload = parseResultPayload(result) as {
      file_scan: Record<string, unknown>;
    };

    expect(tool.definition.description).toContain(
      'application services with a `build` configuration'
    );
    expect(tool.definition.description).toContain('may omit image-only services');
    expect(tool.definition.description).toContain('aiven_service_create');
    expect(tool.definition.description).toContain(
      'A 404 usually means a referenced Dockerfile is missing'
    );
    expect(tool.definition.description).toContain(
      'keep TLS enabled while disabling server-certificate validation'
    );
    expect(getTool(tools, ApplicationToolName.Create).definition.description).toContain(
      'does not accept a Compose file directly'
    );
    expect(payload.file_scan).not.toHaveProperty('raw_contents');
    expect(payload.file_scan['deployment_guidance']).toEqual(
      expect.objectContaining({
        workflow: 'review_service_suggestions',
        next_tool: 'aiven_service_create',
        limitations: expect.arrayContaining([
          expect.stringContaining('may be omitted'),
        ]),
        tls_guidance: expect.objectContaining({
          applies_to_integrations: ['pg', 'valkey'],
          ca_certificate_file_mounts: 'planned_not_yet_available',
          temporary_workaround: expect.stringContaining(
            'disable server-certificate validation'
          ),
        }),
      })
    );
    expect(payload.file_scan['scanned_attributes']).toEqual([
      expect.objectContaining({
        description: 'Environment variable DATABASE_URL=postgres://user:pass@db/app',
        value: 'DATABASE_URL=postgres://user:pass@db/app',
      }),
      expect.objectContaining({
        description: 'Environment variable LOG_LEVEL=debug',
        value: 'LOG_LEVEL=debug',
      }),
    ]);
    expect(payload.file_scan['service_suggestions']).toEqual(serviceSuggestions);
    expect(serviceSuggestions[1]?.service_integrations).toEqual([
      expect.objectContaining({
        source_service: 'example-db',
        user_config: expect.objectContaining({
          exposed_values: {
            connection_string: {
              environment_variable_key: 'DATABASE_URL',
            },
          },
        }),
      }),
    ]);
    expect(serviceSuggestions[1]?.user_config?.application.environment_variables).toEqual([
      { key: 'LOG_LEVEL', value: 'debug', kind: 'variable' },
    ]);
  });
});
