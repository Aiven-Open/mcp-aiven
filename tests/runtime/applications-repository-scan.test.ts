import { describe, expect, it, vi } from 'vitest';
import type { AivenClient } from '../../src/client.js';
import {
  deployApplicationInput,
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
