# Aiven MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for the [Aiven](https://aiven.io/) cloud data platform.

Manage PostgreSQL, Apache Kafka, and other Aiven services directly from LLM-powered assistants.

## Quick Start

Install via `npx` — no clone required. Add this to your MCP client config:

```json
{
  "mcpServers": {
    "mcp-aiven": {
      "command": "npx",
      "args": ["-y", "mcp-aiven"],
      "env": {
        "AIVEN_TOKEN": "your-token-here",
        "AIVEN_BASE_URL": "https://api.aiven.io/v1", // Optional
        "AIVEN_SERVICES": "core,pg,kafka" // Optional
      }
    }
  }
}
```

### Config file locations

| Client | Location |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%/Claude/claude_desktop_config.json` |
| Cursor | Cursor → Settings → Cursor Settings → MCP Servers |
| VS Code | `.vscode/mcp.json` in your workspace |

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `AIVEN_TOKEN` | Yes | — | Aiven API token ([create one here](https://console.aiven.io/profile/auth)) |
| `AIVEN_BASE_URL` | No | `https://api.aiven.io/v1` | Aiven API base URL |
| `AIVEN_SERVICES` | No | `all` | Comma-separated list of service categories to enable: `core`, `pg`, `kafka` |

## Tools

97 tools across three categories. Use `AIVEN_SERVICES` to load only the categories you need (e.g., `AIVEN_SERVICES=core,pg`).

### Core

| Tool | Description |
|---|---|
| `aiven_list_project_clouds` | List cloud platforms for a project |
| `aiven_list_project_vpc_peering_connection_types` | List VPC peering connection types for a project |
| `aiven_project_alerts_list` | List active alerts for a project |
| `aiven_project_get` | Get project details |
| `aiven_project_get_event_logs` | Get project event log entries |
| `aiven_project_get_service_logs` | Get service log entries |
| `aiven_project_list` | List projects |
| `aiven_project_service_plan_list` | List service plans |
| `aiven_project_service_plan_price_get` | Get plan pricing |
| `aiven_project_service_plan_specs_get` | Get service plan details |
| `aiven_project_service_types_get` | Get service type details |
| `aiven_project_service_types_list` | List service types |
| `aiven_service_alerts_list` | List active alerts for service |
| `aiven_service_backups_get` | Get service backup information |
| `aiven_service_cancel_query` | Cancel specified query from service |
| `aiven_service_create` | Create a new Aiven managed service |
| `aiven_service_database_create` | Create a new logical database for service |
| `aiven_service_database_list` | List service databases |
| `aiven_service_get` | Get service information |
| `aiven_service_get_migration_status` | Get migration status |
| `aiven_service_list` | List services |
| `aiven_service_maintenance_start` | Start maintenance updates |
| `aiven_service_metrics_fetch` | Fetch service metrics |
| `aiven_service_query_activity` | Fetch current queries for the service |
| `aiven_service_update` | Update an existing Aiven service |
| `aiven_service_user_create` | Create a new (sub) user for service |
| `aiven_service_user_get` | Get details for a single user |
| `aiven_vpc_create` | Create a VPC in a cloud for the project |
| `aiven_vpc_delete` | Delete a project VPC |
| `aiven_vpc_get` | Get VPC information |
| `aiven_vpc_list` | List VPCs for a project |
| `aiven_vpc_peering_connection_create` | Create a peering connection for a project VPC |
| `aiven_vpc_peering_connection_delete` | Delete a peering connection for a project VPC |
| `aiven_vpc_peering_connection_update` | Update user-defined peer network CIDRs for a project VPC |

### PostgreSQL

| Tool | Description |
|---|---|
| `aiven_pg_bouncer_create` | Create a new connection pool for service |
| `aiven_pg_bouncer_delete` | Delete a connection pool |
| `aiven_pg_bouncer_update` | Update a connection pool |
| `aiven_pg_describe_table` | Describe table structure: columns, types, constraints, and indexes |
| `aiven_pg_explain_query` | Run EXPLAIN ANALYZE on a query and return the execution plan |
| `aiven_pg_list_foreign_keys` | List foreign key relationships (outgoing and incoming) for a table |
| `aiven_pg_list_indexes` | List indexes on a table with type, size, and usage statistics |
| `aiven_pg_list_schemas` | List database schemas with table and view counts |
| `aiven_pg_list_tables` | List tables in a schema with row counts, sizes, and descriptions |
| `aiven_pg_optimize_query` | Get AI-powered query optimization using EverSQL |
| `aiven_pg_read` | Execute a read-only SQL query against an Aiven PostgreSQL service |
| `aiven_pg_service_available_extensions` | List PostgreSQL extensions available for this service |
| `aiven_pg_service_query_statistics` | Fetch PostgreSQL service query statistics |
| `aiven_pg_write` | Execute a write SQL statement (INSERT, UPDATE, DELETE, CREATE TABLE, etc.) |

### Kafka

| Tool | Description |
|---|---|
| `aiven_kafka_acl_add` | Add Aiven Kafka ACL entry |
| `aiven_kafka_acl_delete` | Delete a Kafka ACL entry |
| `aiven_kafka_acl_list` | List Aiven ACL entries for Kafka service |
| `aiven_kafka_connect_create_connector` | Create a Kafka Connect connector with auto credential resolution |
| `aiven_kafka_connect_delete_connector` | Delete Kafka Connect connector |
| `aiven_kafka_connect_edit_connector` | Edit Kafka Connect connector with auto credential resolution |
| `aiven_kafka_connect_get_available_connectors` | Get available Kafka Connect connectors |
| `aiven_kafka_connect_get_connector_configuration` | Get Kafka Connect connector configuration schema |
| `aiven_kafka_connect_get_connector_status` | Get a Kafka Connect Connector status |
| `aiven_kafka_connect_list` | List Kafka connectors |
| `aiven_kafka_connect_pause_connector` | Pause a Kafka Connect Connector |
| `aiven_kafka_connect_restart_connector` | Restart a Kafka Connect Connector |
| `aiven_kafka_connect_restart_connector_task` | Restart a Kafka Connect Connector task |
| `aiven_kafka_connect_resume_connector` | Resume a Kafka Connect Connector |
| `aiven_kafka_connect_stop_connector` | Stop a Kafka Connect Connector |
| `aiven_kafka_native_acl_add` | Add a Kafka-native ACL entry |
| `aiven_kafka_native_acl_delete` | Delete a Kafka-native ACL entry |
| `aiven_kafka_native_acl_get` | Get single Kafka-native ACL entry |
| `aiven_kafka_native_acl_list` | List Kafka-native ACL entries |
| `aiven_kafka_quota_create` | Create Kafka quota |
| `aiven_kafka_quota_delete` | Delete Kafka quota |
| `aiven_kafka_quota_describe` | Describe Specific Kafka quotas |
| `aiven_kafka_quota_list` | List Kafka quotas |
| `aiven_kafka_service_schema_registry_acl_add` | Add a Schema Registry ACL entry |
| `aiven_kafka_service_schema_registry_acl_delete` | Delete a Schema Registry ACL entry |
| `aiven_kafka_service_schema_registry_acl_list` | List Schema Registry ACL entries |
| `aiven_kafka_service_schema_registry_compatibility` | Check compatibility of schema in Schema Registry |
| `aiven_kafka_service_schema_registry_global_config_get` | Get global configuration for Schema Registry |
| `aiven_kafka_service_schema_registry_global_config_put` | Edit global configuration for Schema Registry |
| `aiven_kafka_service_schema_registry_schema_get` | Get schema in Schema Registry |
| `aiven_kafka_service_schema_registry_subject_config_get` | Get configuration for Schema Registry subject |
| `aiven_kafka_service_schema_registry_subject_config_put` | Edit configuration for Schema Registry subject |
| `aiven_kafka_service_schema_registry_subject_delete` | Delete Schema Registry subject |
| `aiven_kafka_service_schema_registry_subject_version_delete` | Delete Schema Registry subject version |
| `aiven_kafka_service_schema_registry_subject_version_get` | Get Schema Registry Subject version |
| `aiven_kafka_service_schema_registry_subject_version_post` | Register a new Schema in Schema Registry |
| `aiven_kafka_service_schema_registry_subject_versions_get` | Get Schema Registry subject versions |
| `aiven_kafka_service_schema_registry_subjects` | List Schema Registry subjects |
| `aiven_kafka_tiered_storage_storage_usage_by_topic` | Get Kafka tiered storage usage by topic |
| `aiven_kafka_tiered_storage_storage_usage_total` | Get Kafka tiered storage total usage |
| `aiven_kafka_tiered_storage_summary` | Get Kafka tiered storage summary |
| `aiven_kafka_topic_create` | Create a Kafka topic |
| `aiven_kafka_topic_delete` | Delete a Kafka topic |
| `aiven_kafka_topic_get` | Get Kafka topic info |
| `aiven_kafka_topic_list` | Get Kafka topic list |
| `aiven_kafka_topic_message_list` | List Kafka topic messages |
| `aiven_kafka_topic_message_produce` | Produce message into a Kafka topic |
| `aiven_kafka_topic_update` | Update a Kafka topic |
| `aiven_service_integration_create` | Create a service integration (e.g. link Kafka Connect to Kafka) |

## Development

```bash
git clone https://github.com/aiven/mcp-aiven.git
cd mcp-aiven
pnpm install
pnpm generate   # generate tools from OpenAPI spec
pnpm build
pnpm test
```

### Running locally

Point your MCP client at the built output:

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

### Scripts

| Command | Description |
|---|---|
| `pnpm generate` | Regenerate tools from OpenAPI spec |
| `pnpm build` | Compile TypeScript |

## Security Considerations

**Self-Managed MCPs:**

- **Customer Responsibility:** MCPs are executed within the user's environment, not hosted by Aiven. Users are solely responsible for their operational management, security, and compliance, adhering to the [shared responsibility model](https://aiven.io/responsibility-matrix).
- **Deployment and Maintenance:** Developers must handle all aspects of MCP deployment, updates, and maintenance.

**AI Agent Security:**

- **Permission Control:** Access and capabilities of AI Agents are strictly governed by the permissions granted to the API token used for their authentication. Manage these permissions carefully.
- **Credential Handling:** AI Agents may require access credentials (e.g., database connection strings, streaming service tokens) to perform actions on your behalf. Exercise extreme caution when providing such credentials to AI Agents.
- **Risk Assessment:** Adhere to your organization's security policies and conduct thorough risk assessments before granting AI Agents access to sensitive resources.

**API Token Best Practices:**

- **Principle of Least Privilege:** API tokens should be scoped and restricted to the minimum permissions necessary for their intended function.
- **Token Management:** Implement robust token management practices, including regular rotation and secure storage.

## License

[Apache-2.0](LICENSE)
