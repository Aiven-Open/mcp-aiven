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

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `AIVEN_TOKEN` | stdio only | -- | Aiven API token ([create one here](https://console.aiven.io/profile/tokens)) |
| `AIVEN_READ_ONLY` | No | `false` | Set to `true` to expose only read-only tools |
| `MCP_HOST` | No | `https://mcp.aiven.live` | Public base URL of this server, advertised in OAuth protected resource metadata. Override when deploying behind a custom domain. |

In remote (HTTP) mode, `AIVEN_TOKEN` is not needed. Your MCP client sends your token as a Bearer token with each request.

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, running locally, and adding new tools.

## License

[Apache-2.0](LICENSE)
