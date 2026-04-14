# Contributing

Contributions are very welcome. When contributing please keep this in mind:

- Open an issue to discuss new bigger features.
- Write code consistent with the project style and make sure the tests are passing.
- Stay in touch with us if we have follow up questions or requests for further changes.

## Development

```bash
git clone https://github.com/Aiven-Open/mcp-aiven.git
cd mcp-aiven
pnpm install
pnpm generate:api-types   # generate TypeScript types from OpenAPI spec
pnpm generate             # generate tool schemas from OpenAPI spec
pnpm build
```

### Running locally

**stdio** -- point your MCP client at the built output:

```json
{
  "mcpServers": {
    "mcp-aiven": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-aiven/dist/index.js"],
      "env": {
        "AIVEN_TOKEN": "your-token-here"
      }
    }
  }
}
```

**HTTP** -- start the server and connect your client to it:

```bash
pnpm build && node dist/index.js --transport http --port 3000
```

### Scripts

| Command | Description |
|---|---|
| `pnpm generate:api-types` | Regenerate TypeScript types from OpenAPI spec |
| `pnpm generate` | Regenerate tool schemas from OpenAPI spec |
| `pnpm build` | Compile TypeScript and copy manifests |
| `pnpm test` | Run tests |

### Adding a new API tool

Tools are defined in YAML manifests under `src/manifests/`. Each entry maps to an Aiven API endpoint.

1. **Add a manifest entry** in `src/manifests/<category>.yaml`:

```yaml
- name: aiven_opensearch_index_list
  method: GET
  path: /project/{project}/service/{service_name}/opensearch/index
  category: opensearch
```

Each entry needs `name`, `method`, `path`, and `category`. Optional fields:

```yaml
  description: |              # override the OpenAPI description
    Custom description here.
  readOnly: true              # mark as read-only (useful for POST endpoints that don't mutate)
  destructive: true           # mark as destructive (adds destructiveHint annotation)
  defaults:                   # inject default body fields
    project_vpc_id: null
  response_filter:            # trim the API response before returning to the LLM
    key: services
    fields: [service_name, state]
    summarize: regions        # compact a nested object field
```

2. **Register the category** (if new) -- add it to `ServiceCategory` in `src/types.ts`

3. **Regenerate and build**:

```bash
pnpm generate   # extracts JSON Schema from OpenAPI spec for each manifest entry
pnpm build
```

## Opening a PR

- Commit messages should describe the changes, not the filenames. Win our admiration by following
  the [excellent advice from Chris Beams](https://chris.beams.io/posts/git-commit/) when composing
  commit messages.
- Choose a meaningful title for your pull request.
- The pull request description should focus on what changed and why.
- Check that the tests pass (and add test coverage for your changes if appropriate).
