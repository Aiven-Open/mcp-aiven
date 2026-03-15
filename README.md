# Aiven MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for the [Aiven](https://aiven.io/) cloud data platform.

Manage PostgreSQL, Apache Kafka, and other Aiven services directly from AI assistants like Claude, Cursor, and VS Code Copilot.

> [!WARNING]
> **Security Considerations**
>
> **Self-Managed MCPs:** MCPs run in the user's environment, not hosted by Aiven. Users are responsible for their deployment, security, and compliance, following the [shared responsibility model](https://aiven.io/responsibility-matrix). Developers handle all aspects of MCP deployment, updates, and maintenance.
>
> **AI Agent Security:** Access is governed by the permissions of the API token used for authentication. Scope tokens carefully. AI agents may need access credentials (database connection strings, streaming tokens) to act on your behalf. Be careful when providing these. Follow your organization's security policies and do a risk assessment before giving AI agents access to sensitive resources.
>
> **API Token Best Practices:** Use the minimum permissions needed (principle of least privilege). Rotate tokens regularly and store them securely.

## Quick Start

### Option 1: stdio (local)

Add this to your MCP client config. The client starts the server as a child process:

```json
{
  "mcpServers": {
    "mcp-aiven": {
      "command": "npx",
      "args": ["-y", "mcp-aiven"],
      "env": {
        "AIVEN_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Option 2: Streamable HTTP (remote)

TBD

### Config file locations

| Client | Location |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%/Claude/claude_desktop_config.json` |
| Claude Code | `claude mcp add mcp-aiven -- npx -y mcp-aiven` |
| Cursor | Cursor Settings > MCP Servers |
| VS Code | `.vscode/mcp.json` in your workspace |


## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `AIVEN_TOKEN` | stdio only | -- | Aiven API token ([create one here](https://console.aiven.io/profile/auth)) |
| `AIVEN_READ_ONLY` | No | `false` | Set to `true` to expose only read-only tools |

In HTTP mode, `AIVEN_TOKEN` is not needed. The Bearer token from each request is used instead.

## Tools

### Core

| Tool | Description |
|---|---|
| `aiven_project_list` | List projects |
| `aiven_project_get` | Get project details |
| `aiven_list_project_clouds` | List cloud platforms for a project |
| `aiven_service_list` | List services |
| `aiven_service_type_plans` | List plans with pricing and cloud availability |
| `aiven_service_create` | Create a service |
| `aiven_service_get` | Get service information |
| `aiven_service_update` | Update a service (plan, config, power state) |
| `aiven_project_get_service_logs` | Get service log entries |
| `aiven_service_query_activity` | Fetch current queries for a service |
| `aiven_service_metrics_fetch` | Fetch service metrics |
| `aiven_project_get_event_logs` | Get project event log entries |

### Kafka

| Tool | Description |
|---|---|
| `aiven_kafka_topic_list` | List Kafka topics |
| `aiven_kafka_topic_create` | Create a Kafka topic |
| `aiven_kafka_topic_get` | Get Kafka topic info |
| `aiven_kafka_topic_update` | Update a Kafka topic |
| `aiven_kafka_topic_delete` | Delete a Kafka topic |
| `aiven_kafka_topic_message_list` | Read messages from a Kafka topic |
| `aiven_kafka_topic_message_produce` | Produce messages into a Kafka topic |
| `aiven_kafka_connect_available_connectors` | List available connector types |
| `aiven_kafka_connect_list` | List running connectors |
| `aiven_kafka_connect_create_connector` | Create a connector |
| `aiven_kafka_connect_edit_connector` | Edit a connector |
| `aiven_kafka_connect_get_connector_status` | Get connector status |
| `aiven_kafka_connect_pause_connector` | Pause a connector |
| `aiven_kafka_connect_resume_connector` | Resume a connector |
| `aiven_kafka_connect_restart_connector` | Restart a connector |
| `aiven_kafka_connect_delete_connector` | Delete a connector |
| `aiven_kafka_schema_registry_subjects` | List Schema Registry subjects |
| `aiven_kafka_schema_registry_subject_version_get` | Get Schema Registry subject version |

### PostgreSQL

| Tool | Description |
|---|---|
| `aiven_pg_service_available_extensions` | List available extensions |
| `aiven_pg_service_query_statistics` | Fetch query statistics |
| `aiven_pg_bouncer_create` | Create a PgBouncer connection pool |
| `aiven_pg_bouncer_update` | Update a PgBouncer connection pool |
| `aiven_pg_bouncer_delete` | Delete a PgBouncer connection pool |
| `aiven_pg_read` | Run a read-only SQL query |
| `aiven_pg_write` | Run a write SQL statement (INSERT, UPDATE, DELETE, CREATE TABLE, etc.) |
| `aiven_pg_optimize_query` | AI-powered query optimization (EverSQL) |

## Development

```bash
git clone https://github.com/Aiven-Open/mcp-aiven.git
cd mcp-aiven
pnpm install
pnpm generate   # generate tool schemas from OpenAPI spec
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

## License

[Apache-2.0](LICENSE)
