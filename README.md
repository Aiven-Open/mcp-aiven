# Aiven MCP Server

An MCP server for Aiven.

## Features

### Tools

* `list_projects`
  - List all projects on your Aiven account.

* `list_services`
  - List all services in a specific Aiven project.

* `get_service_details`
  - Get the detail of your service in a specific Aiven project.

* `get_metadata`
  - Get the metadata of a specific Aiven service, currently only working for Aiven for PostgreSQL®.

* `run_query`
  - Run a query against a specific Aiven service, currently only working for Aiven for PostgreSQL®.

## Configuration for Claude Desktop

1. Open the Claude Desktop configuration file located at:
   - On macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

2. Add the following:

```json
{
  "mcpServers": {
    "mcp-clickhouse": {
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
        "AIVEN_PROJECT_NAME": "$DEFAULT_PROJECT_NAME",
        "AIVEN_TOKEN": "$AIVEN_TOKEN"
      }
    }
  }
}
```

Update the environment variables:
* `$REPOSITORY_DIRECTORY` to point to the folder cointaining the repository
* `AIVEN_PROJECT_NAME` to the default project name
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
AIVEN_PROJECT_NAME=$DEFAULT_PROJECT_NAME
AIVEN_TOKEN=$AIVEN_TOKEN
```

2. Run `uv sync` to install the dependencies. To install `uv` follow the instructions [here](https://docs.astral.sh/uv/). Then do `source .venv/bin/activate`.

3. For easy testing, you can run `mcp dev mcp_aiven/mcp_server.py` to start the MCP server.

### Environment Variables

The following environment variables are used to configure the ClickHouse connection:

#### Required Variables
* `AIVEN_BASE_URL`: The Aiven API url
* `AIVEN_PROJECT_NAME`: The default project name
* `AIVEN_TOKEN`: The authentication token