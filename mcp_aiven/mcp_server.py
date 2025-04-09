import json
import logging
import os
from typing import Any, Dict, List, Optional, Callable, Type
import tempfile
import subprocess

import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

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
    "datamodel-code-generator",
]


def generate_models(openapi_spec: Dict[str, Any], output_dir: str) -> None:
    """Generate Pydantic models from OpenAPI spec using datamodel-code-generator."""
    spec_file = os.path.join(output_dir, "openapi.json")
    output_file = os.path.join(output_dir, "models.py")

    # Write the OpenAPI spec to a temporary file
    with open(spec_file, "w") as f:
        json.dump(openapi_spec, f)

    try:
        # Run datamodel-code-generator
        cmd = [
            "datamodel-codegen",
            "--input",
            spec_file,
            "--input-file-type",
            "openapi",
            "--output",
            output_file,
            "--use-schema-description",
            "--target-python-version",
            "3.13",
        ]
        subprocess.run(cmd, check=True)
        logger.info(f"Generated models in {output_file}")
    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to generate models: {e}")
        raise


class AivenAPI:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.client = httpx.AsyncClient(
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        )
        self._load_openapi_spec()
        self._generate_models()
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

    def _generate_models(self) -> None:
        """Generate Pydantic models from OpenAPI components."""
        try:
            # Create a temporary directory for model generation
            with tempfile.TemporaryDirectory() as temp_dir:
                generate_models(self.spec, temp_dir)

                # Import the generated models
                import sys

                sys.path.insert(0, temp_dir)
                import models

                sys.path.pop(0)

                # Store models in a dict for easy access
                self.models = {}
                for name, obj in vars(models).items():
                    if isinstance(obj, type) and issubclass(obj, BaseModel):
                        self.models[name] = obj
                        logger.debug(f"Loaded model: {name}")
        except Exception as e:
            logger.error(f"Failed to generate models: {e}")
            # Continue without models, we'll handle errors gracefully
            self.models = {}

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
            error_msg = str(e)
            if isinstance(e, httpx.HTTPStatusError):
                status = e.response.status_code
                try:
                    error_data = e.response.json()
                    error_msg = error_data.get("message", str(e))
                except:
                    pass
            logger.error(f"HTTP error occurred: {error_msg}")
            return {"error": error_msg, "status_code": status}
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

            # Make the request
            response_data = await self._make_request(path, params=params)

            # If we got an error response, return it directly
            if isinstance(response_data, dict) and (
                "error" in response_data or "status_code" in response_data
            ):
                return response_data

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
                    try:
                        model = self.models[model_name]
                        validated_data = model.model_validate(response_data)
                        return validated_data.model_dump()
                    except Exception as e:
                        logger.error(f"Validation error for {model_name}: {e}")
                        # If validation fails, return the raw response
                        return response_data

            return response_data

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
