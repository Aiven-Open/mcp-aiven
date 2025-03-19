# Aiven MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for Aiven.

This provides access to the Aiven for PostgreSQL, Kafka, ClickHouse, Valkey and OpenSearch services running in Aiven and the wider Aiven ecosystem of native connectors. Enabling LLMs to build full stack solutions for all use-cases.

## Features

### Tools

* `list_projects`
  - List all projects on your Aiven account.

* `list_services`
  - List all services in a specific Aiven project.

* `get_service_details`
  - Get the detail of your service in a specific Aiven project.

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
* **Credential Handling:** Be acutely aware that AI Agents may require access credentials (e.g., database connection strings, streaming service tokens) to perform actions on your behalf. Exercise extreme caution when providing such credentials to AI Agents.
* **Risk Assessment:** Adhere to your organization's security policies and conduct thorough risk assessments before granting AI Agents access to sensitive resources.

**API Token Best Practices:**

* **Principle of Least Privilege:** Always adhere to the principle of least privilege. API tokens should be scoped and restricted to the minimum permissions necessary for their intended function.
* **Token Management:** Implement robust token management practices, including regular rotation and secure storage.

**Key Takeaways:**

* Users retain full control and responsibility for MCP execution and security.
* AI Agent permissions are directly tied to API token permissions.
* Exercise extreme caution when providing credentials to AI Agents.
* Strictly adhere to the principle of least privilege when managing API tokens.
