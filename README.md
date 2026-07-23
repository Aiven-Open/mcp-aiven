# Aiven MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for the [Aiven](https://aiven.io/) cloud data platform.

Manage PostgreSQL, Apache Kafka, applications, and other Aiven services directly from AI assistants like Claude, Cursor, and VS Code Copilot.

> [!WARNING]
> **Use with care.** This MCP server can create, modify, and delete Aiven services and data on your behalf. AI agents may execute destructive actions (dropping databases, deleting services, producing messages) based on their interpretation of your prompts. You are fully responsible for the actions taken through this tool.
>
> **Permissions:** Access is governed by the Aiven user permissions associated with the authenticated account. The MCP server can only perform actions that your Aiven user is allowed to do.
>
> **AI Agent Security:** AI agents may need access credentials (database connection strings, streaming tokens) to act on your behalf. Review what your agent is doing, especially in production environments. Follow your organization's security policies and do a risk assessment before giving AI agents access to sensitive resources.



## Quick Start

### Option 1: Remote (hosted by Aiven)

The MCP server is hosted at `https://mcp.aiven.live/mcp`. Your MCP client will prompt you to authorize on Aiven.

**Claude Code**

```bash
claude mcp add --scope user --transport http aiven-mcp "https://mcp.aiven.live/mcp"
```

**Cursor**

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en-US/install-mcp?name=aiven-mcp&config=eyJ1cmwiOiJodHRwczovL21jcC5haXZlbi5saXZlL21jcCJ9)

Or manually add to Cursor MCP settings:

```json
{
  "mcpServers": {
    "aiven-mcp": {
      "url": "https://mcp.aiven.live/mcp"
    }
  }
}
```

**VS Code / Copilot**

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "aiven-mcp": {
      "type": "http",
      "url": "https://mcp.aiven.live/mcp"
    }
  }
}
```

#### Read-Only Mode (Remote)

Enable read-only mode by adding `?read_only=true` to the URL. All write operations will be excluded from the MCP:

```json
{
  "mcpServers": {
    "aiven-mcp": {
      "url": "https://mcp.aiven.live/mcp?read_only=true"
    }
  }
}
```

#### Scoped Tools (Remote)

Reduce the tool surface exposed to your AI agent by adding `?services_scope=` to the URL. Useful when you only work with a subset of Aiven services and want to keep the agent's context focused. Combine values with commas. `core` (project/service discovery) is always included implicitly.

Valid scopes: `all`, `core`, `pg`, `kafka`, `application`, `integrations`. Use `all` to explicitly load every tool (same as omitting the param). `all` cannot be combined with other scopes.

```json
{
  "mcpServers": {
    "aiven-mcp": {
      "url": "https://mcp.aiven.live/mcp?services_scope=kafka"
    }
  }
}
```

You can also combine with `read_only`:

```
https://mcp.aiven.live/mcp?services_scope=pg&read_only=true
```

#### Write Exceptions in Read-Only Mode (Remote)

When `read_only=true`, add `?write_allowlist=` to re-enable specific write tools while keeping
everything else read-only. Useful when you want mostly-read access but still need to allow one
write action, for example creating Kafka topics. Combine multiple tool names with commas. Ignored
when `read_only` is not enabled.

```
https://mcp.aiven.live/mcp?read_only=true&write_allowlist=aiven_kafka_topic_create
```

#### Marketplace Customers (Remote)

If you subscribed to Aiven through a cloud marketplace, add your marketplace as a path segment so sign-in uses the correct console:

| Marketplace | Path segment |
| --- | --- |
| AWS Marketplace | `https://mcp.aiven.live/mcp/aws` |
| Azure Marketplace | `https://mcp.aiven.live/mcp/azure` |
| Google Cloud Marketplace | `https://mcp.aiven.live/mcp/gcp` |

```json
{
  "mcpServers": {
    "aiven-mcp": {
      "url": "https://mcp.aiven.live/mcp/<marketplace>"
    }
  }
}
```

The path segment combines with the query parameters above, for example `https://mcp.aiven.live/mcp/gcp?services_scope=pg&read_only=true`.

### Option 2: stdio (local)

Run the server locally as a child process of your MCP client. Requires Node.js 18+.

You must provide your Aiven API token via the `AIVEN_TOKEN` environment variable. [Create a token here](https://console.aiven.io/profile/tokens).

**Claude Code**

```bash
claude mcp add --scope user aiven-mcp -e AIVEN_TOKEN=your-token-here -- npx -y mcp-aiven
```

**Cursor, VS Code** -- add to your MCP client config:

```json
{
  "mcpServers": {
    "aiven-mcp": {
      "command": "npx",
      "args": ["-y", "mcp-aiven"],
      "env": {
        "AIVEN_TOKEN": "your-token-here"
      }
    }
  }
}
```

Config file locations:
- Cursor: Cursor Settings > MCP Servers
- VS Code: `.vscode/mcp.json` in your workspace

### Option 3: Local development

Run a local build of the server (useful for development and testing):

```bash
pnpm install && pnpm generate:api-types && pnpm generate && pnpm build && AIVEN_TOKEN="<YOUR_TOKEN>" MCP_TRANSPORT="http" PORT=3000 node dist/index.js
```

The server listens on port 3000 by default. Connect your MCP client to `http://localhost:3000/mcp`.

To point a remote deployment at a custom host (e.g. your local build), set `MCP_HOST`:

```bash
MCP_HOST=http://localhost:3000 node dist/index.js
```

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `AIVEN_TOKEN` | stdio only | -- | Aiven API token ([create one here](https://console.aiven.io/profile/tokens)) |
| `AIVEN_READ_ONLY` | No | `false` | Set to `true` to expose only read-only tools |
| `AIVEN_SERVICES_SCOPE` | No | -- | Comma-separated scopes to expose (e.g. `kafka`, `pg,kafka`, or `all`). Valid: `all`, `core`, `pg`, `kafka`, `application`, `integrations`. `core` is always included. Omitting the var or setting `all` loads every tool. |
| `AIVEN_ALLOW_SECRETS` | No | `false` | Set to `true` to expose the `aiven_service_connection_info` tool, which returns live credentials (passwords, connection URIs, certs) into the conversation. Disabled while `AIVEN_READ_ONLY=true`. |
| `AIVEN_WRITE_ALLOWLIST` | No | -- | Comma-separated tool names to re-enable while `AIVEN_READ_ONLY=true` (e.g. `aiven_kafka_topic_create`). Ignored when read-only mode is not enabled. |
| `MCP_HOST` | No | `https://mcp.aiven.live` | Override the OAuth protected resource host |
| `MCP_TRANSPORT` | No | `stdio` | Set to `http` to start an HTTP server instead of stdio |
| `MCP_HTTP_RATE_LIMIT_MAX` | No | `1000` | Max requests per window on `POST /mcp` (HTTP transport), per bearer token. Client IP rate limiting is expected at Cloudflare. |
| `MCP_HTTP_RATE_LIMIT_WINDOW_MS` | No | `60000` | Window length in milliseconds for `MCP_HTTP_RATE_LIMIT_MAX`. |
| `EXTRA_PROTECTION` | No | `false` | Set to `true` on HTTP deployments to require a valid `X-Edge-Auth` header on every request except `GET /health`. See [Edge protection rollout](#edge-protection-rollout) below. |
| `MCP_EDGE_AUTH_SECRET` | When `EXTRA_PROTECTION=true` | -- | Shared secret; must match the value Cloudflare injects as `X-Edge-Auth` via Transform Rules. |

In remote (HTTP) mode, `AIVEN_TOKEN` is not needed. Your MCP client sends your token as a Bearer token with each request.

Production HTTP traffic is rate-limited in two layers: Cloudflare enforces a per-client-IP limit (configured in the Cloudflare dashboard), and this server enforces `MCP_HTTP_RATE_LIMIT_*` per bearer token on `POST /mcp`.

### Edge protection rollout

When `EXTRA_PROTECTION=true`, any mismatch between `MCP_EDGE_AUTH_SECRET` and the value Cloudflare injects as `X-Edge-Auth` causes **every request to return 403** (except `GET /health`). Both values are environment/config on opposite sides of the wire, so the only recovery path is to fix the secret and redeploy or update Cloudflare.

**Enable in this order:**

1. **Cloudflare Transform Rule** — Add a rule that sets `X-Edge-Auth` (and, if used for PG tools, `X-Client-IP`) on traffic to the MCP origin. Note the secret value you configure.
2. **`MCP_EDGE_AUTH_SECRET`** — Deploy the server with this env var set to the **same** secret as the Transform Rule. Leave `EXTRA_PROTECTION` unset or `false` for now; verify the origin still accepts traffic.
3. **`EXTRA_PROTECTION=true`** — Enable only after steps 1–2 are live and matched. Confirm a normal MCP request succeeds and direct origin access without `X-Edge-Auth` is rejected.
4. **Secret rotation** — Update Cloudflare and `MCP_EDGE_AUTH_SECRET` together (or briefly set `EXTRA_PROTECTION=false`), redeploy, then re-enable. Never rotate one side alone while the flag is on.

If `EXTRA_PROTECTION=true` at startup and `MCP_EDGE_AUTH_SECRET` is missing, the process exits immediately with an error.

While rejections continue, the server logs a misconfig warning at most once every 15 minutes (reset after a request with valid `X-Edge-Auth`), so a secret mismatch is visible in logs without one line per rejected request.

## Tools

### Core

| Tool | Description |
|---|---|
| `aiven_project_list` | List projects |
| `aiven_project_get` | Get project details |
| `aiven_list_project_clouds` | List cloud platforms for a project |
| `aiven_project_vpc_list` | List VPCs for a project |
| `aiven_service_list` | List services |
| `aiven_service_type_plans` | List plans with cloud availability |
| `aiven_service_plan_pricing` | Get pricing for a plan in a specific cloud |
| `aiven_service_create` | Create a service |
| `aiven_service_get` | Get service information |
| `aiven_service_update` | Update a service (plan, config, power state) |
| `aiven_service_metrics_fetch` | Fetch metrics for managed data services |
| `aiven_service_application_metrics_get` | Fetch metrics for application services |
| `aiven_project_get_service_logs` | Get service log entries |
| `aiven_service_query_activity` | Fetch current queries for a service |
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

### Applications

| Tool | Description |
|---|---|
| `aiven_application_deploy` | Deploy a Dockerized application to Aiven |
| `aiven_application_redeploy` | Rebuild and redeploy an existing application |
| `aiven_vcs_integration_list` | List connected VCS (GitHub) accounts |
| `aiven_vcs_integration_repository_list` | List repositories for a VCS integration |

### Documentation

| Tool | Description |
|---|---|
| `aiven_docs_search` | Search the official Aiven documentation in natural language. Only available on the hosted server (`https://mcp.aiven.live/mcp`) — not exposed in self-hosted deployments. |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, running locally, and adding new tools.

## License

[Apache-2.0](LICENSE)
