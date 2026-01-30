# Aiven MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for Aiven.

This provides access to the Aiven for PostgreSQL, Kafka, ClickHouse, Valkey and OpenSearch services running in Aiven and the wider Aiven ecosystem of native connectors. Enabling LLMs to build full stack solutions for all use-cases.

## Security

This MCP server implements credential filtering to prevent sensitive information from being exposed through API responses. The following types of data are automatically redacted:

- Passwords and secrets
- Connection URIs and connection info
- SSL/TLS certificates and private keys
- Access tokens and API keys

**Important**: To retrieve actual credentials for connecting to services, use the Aiven console or CLI directly.

## Features

### Project Tools

* `list_projects` - List all projects on your Aiven account.

### Service Tools

* `list_services` - List all services in a specific Aiven project.
* `get_service_details` - Get the details of a service (credentials redacted).
* `list_service_types` - List available service types and plans.
* `create_service` - Create a new Aiven service.
* `update_service` - Update service configuration (plan, cloud, settings).
* `delete_service` - Permanently delete a service.

### Service User Tools

* `create_service_user` - Create a new database/service user.
* `list_service_users` - List all users for a service (credentials redacted).
* `delete_service_user` - Delete a service user.
* `reset_service_user_password` - Reset a user's password.

### Database Tools (PostgreSQL/MySQL)

* `create_database` - Create a new database.
* `list_databases` - List all databases in a service.
* `delete_database` - Delete a database.

### Integration Tools

* `list_integration_types` - List available integration types.
* `create_integration` - Create an integration between services.
* `list_integrations` - List integrations for a service.
* `delete_integration` - Remove an integration.

### Authentication Tools

* `get_user_info` - Get current user profile information.
* `list_access_tokens` - List access tokens (metadata only).
* `create_access_token` - Create a new API access token.
* `revoke_access_token` - Revoke an access token.

### Account Management Tools

* `create_user` - Create a new Aiven user account (password set via email verification).
* `open_signup_page` - Open the Aiven signup page in your browser.
* `login` - Authenticate with Aiven after signup (token stored for session, not exposed).

## Configuration for Claude Desktop

1. Open the Claude Desktop configuration file located at:
   - On macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

2. Add the following:

```json
{
  "mcpServers": {
    "mcp-aiven": {
      "command": "uv",
      "args": [
        "--directory",
        "$REPOSITORY_DIRECTORY",
        "run",
        "--with-editable",
        "$REPOSITORY_DIRECTORY",
        "--python",
        "3.13",
        "mcp-aiven"
      ],
      "env": {
        "AIVEN_BASE_URL": "https://api.aiven.io",
        "AIVEN_TOKEN": "$AIVEN_TOKEN"
      }
    }
  }
}
```

Update the environment variables:
* `$REPOSITORY_DIRECTORY` to point to the folder cointaining the repository
* `AIVEN_TOKEN` to the [Aiven login token](https://aiven.io/docs/platform/howto/create_authentication_token).


3. Locate the command entry for `uv` and replace it with the absolute path to the `uv` executable. This ensures that the correct version of `uv` is used when starting the server. On a mac, you can find this path using `which uv`.

4. Restart Claude Desktop to apply the changes.

## Configuration for Cursor

1. Navigate to Cursor -> Settings -> Cursor Settings

2. Select "MCP Servers"

3. Add a new server with

    * Name: `mcp-aiven`
    * Type: `command`
    * Command: `uv --directory $REPOSITORY_DIRECTORY run --with-editable $REPOSITORY_DIRECTORY --python 3.13 mcp-aiven`

Where `$REPOSITORY_DIRECTORY` is the path to the repository. You might need to add the `AIVEN_BASE_URL`, `AIVEN_PROJECT_NAME` and `AIVEN_TOKEN` as variables

## Development

1. Add the following variables to a `.env` file in the root of the repository.

```
AIVEN_BASE_URL=https://api.aiven.io
AIVEN_TOKEN=$AIVEN_TOKEN
```

2. Run `uv sync` to install the dependencies. To install `uv` follow the instructions [here](https://docs.astral.sh/uv/). Then do `source .venv/bin/activate`.

3. For easy testing, you can run `mcp dev mcp_aiven/mcp_server.py` to start the MCP server.

4. Run tests with `pytest tests/`.

### Environment Variables

The following environment variables are used to configure the Aiven connection:

#### Required Variables
* `AIVEN_BASE_URL`: The Aiven API url
* `AIVEN_TOKEN`: The authentication token

## Developer Considerations for Model Context Protocols (MCPs) and AI Agents

This section outlines key developer responsibilities and security considerations when working with Model Context Protocols (MCPs) and AI Agents within this system.
**Self-Managed MCPs:**

* **Customer Responsibility:** MCPs are executed within the user's environment, not hosted by Aiven. Therefore, users are solely responsible for their operational management, security, and compliance, adhering to the shared responsibility model. (https://aiven.io/responsibility-matrix)
* **Deployment and Maintenance:** Developers must handle all aspects of MCP deployment, updates, and maintenance.

**AI Agent Security:**

* **Permission Control:** Access and capabilities of AI Agents are strictly governed by the permissions granted to the API token used for their authentication. Developers must meticulously manage these permissions.
* **Credential Handling:** This MCP server automatically redacts sensitive credentials in API responses. However, be aware that AI Agents may still request access to external credentials. Exercise caution when providing such credentials to AI Agents.
* **Risk Assessment:** Adhere to your organization's security policies and conduct thorough risk assessments before granting AI Agents access to sensitive resources.

**API Token Best Practices:**

* **Principle of Least Privilege:** Always adhere to the principle of least privilege. API tokens should be scoped and restricted to the minimum permissions necessary for their intended function.
* **Token Management:** Implement robust token management practices, including regular rotation and secure storage.

**Credential Security:**

* **Automatic Filtering:** All API responses are automatically filtered to remove sensitive data including passwords, connection strings, certificates, and keys.
* **Retrieve Credentials Separately:** To access actual service credentials, use the Aiven console or CLI directly. Never ask an AI Agent to retrieve and display credentials.
* **Audit Logging:** Operations are logged without exposing sensitive values.

**Key Takeaways:**

* Users retain full control and responsibility for MCP execution and security.
* AI Agent permissions are directly tied to API token permissions.
* Sensitive credentials are automatically redacted in all tool responses.
* Retrieve actual credentials through the Aiven console, not through AI Agents.
* Strictly adhere to the principle of least privilege when managing API tokens.
