import json
import logging
import os
from typing import Any, Dict, List, Optional, Callable, Type, Set

import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field, create_model

from mcp_aiven.mcp_env import config

MCP_SERVER_NAME = "mcp-aiven"

# Configure logging
logging.basicConfig(
    level=logging.DEBUG, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(MCP_SERVER_NAME)

# Dependencies required for this MCP server
deps = [
    "httpx",
    "python-dotenv",
    "uvicorn",
    "pip-system-certs",
]


class AivenAPI:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.client = httpx.AsyncClient(
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        )
        self._load_openapi_spec()
        self._create_models()
        self._index_operations()

    def _load_openapi_spec(self) -> None:
        """Load and parse the OpenAPI specification."""
        spec_path = os.path.join(os.path.dirname(__file__), "openapi.json")
        try:
            with open(spec_path, "r") as f:
                self.spec = json.load(f)
            logger.debug(
                "Loaded OpenAPI spec with paths: %s", list(self.spec.get("paths", {}).keys())
            )
        except Exception as e:
            logger.error(f"Failed to load OpenAPI spec: {e}")
            raise

    def _create_models(self) -> None:
        """Create Pydantic models from OpenAPI components."""
        self.models = {}
        components = self.spec.get("components", {}).get("schemas", {})

        for name, schema in components.items():
            try:
                # Create a model for each component
                fields = {}
                for field_name, field_schema in schema.get("properties", {}).items():
                    field_type = self._get_python_type(field_schema.get("type", "string"))
                    required = field_name in schema.get("required", [])

                    if required:
                        fields[field_name] = (
                            field_type,
                            Field(description=field_schema.get("description", "")),
                        )
                    else:
                        fields[field_name] = (
                            field_type,
                            Field(default=None, description=field_schema.get("description", "")),
                        )

                self.models[name] = create_model(name, **fields)
                logger.debug(f"Created model: {name}")
            except Exception as e:
                logger.warning(f"Error creating model {name}: {e}")

    def _get_python_type(self, openapi_type: str) -> Type:
        """Convert OpenAPI types to Python types."""
        type_mapping = {
            "string": str,
            "integer": int,
            "number": float,
            "boolean": bool,
            "array": list,
            "object": dict,
        }
        return type_mapping.get(openapi_type, str)

    def _index_operations(self) -> None:
        """Index GET operations by their tags."""
        self.operations = {}

        logger.debug("Indexing GET operations from OpenAPI spec")
        for path, path_item in self.spec.get("paths", {}).items():
            if "get" not in path_item:
                continue

            operation = path_item["get"]
            operation_id = operation.get("operationId", "")
            if not operation_id:
                continue

            tags = operation.get("tags", ["default"])
            for tag in tags:
                if tag not in self.operations:
                    self.operations[tag] = {}

                self.operations[tag][operation_id] = (path, operation)
                logger.debug(f"Indexed operation: {tag} - {operation_id} - {path}")

        logger.debug(f"Indexed operations by tag: {list(self.operations.keys())}")

    async def _make_request(self, path: str, **kwargs) -> Any:
        """Make an HTTP request to the Aiven API."""
        url = f"{self.base_url}{path}"
        try:
            response = await self.client.get(url, **kwargs)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            status = 500
            if isinstance(e, httpx.HTTPStatusError):
                status = e.response.status_code
            logger.error(f"HTTP error occurred: {e}")
            return {"error": str(e), "status_code": status}
        except Exception as e:
            logger.error(f"Error making request: {e}")
            return {"error": str(e), "status_code": 500}

    def create_tag_tool(self, tag: str) -> Optional[Callable]:
        """Create a tool function for a tag of operations."""
        if tag not in self.operations:
            return None

        operations = self.operations[tag]
        if not operations:
            return None

        async def tag_tool(operation_id: str, **kwargs) -> Dict[str, Any]:
            if not operation_id or operation_id not in operations:
                return {
                    "error": f"Invalid operation_id. Available operations: {list(operations.keys())}",
                    "status_code": 400,
                }

            path, operation = operations[operation_id]
            params = {k: v for k, v in kwargs.items() if v is not None}

            # Get response schema if available
            response_schema = (
                operation.get("responses", {})
                .get("200", {})
                .get("content", {})
                .get("application/json", {})
                .get("schema", {})
            )
            response_ref = response_schema.get("$ref", "")

            if response_ref and response_ref.startswith("#/components/schemas/"):
                model_name = response_ref.split("/")[-1]
                if model_name in self.models:
                    # Use the model to validate the response
                    try:
                        response_data = await self._make_request(path, params=params)
                        return self.models[model_name](**response_data).model_dump()
                    except Exception as e:
                        return {"error": f"Response validation failed: {str(e)}", "status_code": 400}

            # If no model available, just return the raw response
            return await self._make_request(path, params=params)

        # Set function metadata
        tag_tool.__name__ = f"{tag}_resource"
        tag_tool.__doc__ = f"Perform {tag} operations on Aiven resources. Available operations: {list(operations.keys())}"

        # Create a simple model for the tool
        class TagResourceArguments(BaseModel):
            operation_id: str = Field(description="The operation to perform")
            model_config = {"extra": "allow"}

        setattr(tag_tool, "__input_type__", TagResourceArguments)

        return tag_tool

    def create_tools(self) -> List[Callable]:
        """Create tag-based tool functions."""
        tools = []
        logger.debug("Creating tools from tags: %s", list(self.operations.keys()))
        for tag in self.operations.keys():
            logger.debug("Creating tool for tag: %s", tag)
            tool = self.create_tag_tool(tag)
            if tool is not None:
                logger.debug("Created tool: %s", tool.__name__)
                tools.append(tool)
            else:
                logger.debug("No tool created for tag: %s", tag)
        logger.debug("Created %d tools", len(tools))
        return tools


# Initialize the MCP server
mcp = FastMCP(MCP_SERVER_NAME, dependencies=deps)

# Create Aiven API client and tools
aiven_api = AivenAPI(base_url=config.url, token=config.token)
tools = aiven_api.create_tools()
logger.debug("Created tools: %s", [tool.__name__ for tool in tools])

# Add tools to MCP server
for tool in tools:
    try:
        mcp.add_tool(tool)
        logger.debug(f"Added tool: {tool.__name__}")
    except Exception as e:
        logger.error(f"Error adding tool {tool.__name__}: {e}")


async def list_tools():
    """List all available tools."""
    tools = await mcp.list_tools()
    logger.info(f"Available tools: {tools}")


if __name__ == "__main__":
    import asyncio

    asyncio.run(list_tools())
