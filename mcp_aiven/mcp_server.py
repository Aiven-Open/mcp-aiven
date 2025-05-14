import logging

from aiven.client import client
from mcp.server.fastmcp import FastMCP

from mcp_aiven.mcp_env import config

MCP_SERVER_NAME = "mcp-aiven"

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(MCP_SERVER_NAME)

aiven_client = client.AivenClient(base_url=config.url)
aiven_client.set_auth_token(config.token)

deps = [
    "aiven-client",
    "python-dotenv",
    "uvicorn",
    "pip-system-certs",
]

mcp = FastMCP(MCP_SERVER_NAME, dependencies=deps)


@mcp.tool()
def list_projects():
    logger.info("Listing all projects")
    results = aiven_client.get_projects()
    logger.info(f"Found {len(results)} projects")
    return [result["project_name"] for result in results]


@mcp.tool()
def list_services(project_name):
    logger.info("Listing all services in a project: %s", project_name)
    results = aiven_client.get_services(project=project_name)
    logger.info(f"Found {len(results)} services")
    return [s["service_name"] for s in results]


@mcp.tool()
def get_service_details(project_name, service_name):
    logger.info("Fetching details for service: %s in project: %s", service_name, project_name)
    result = aiven_client.get_service(project=project_name, service=service_name)
    return result


@mcp.tool()
def get_pg_query_stats(project_name, service_name):
    logger.info("Fetching query stats for service: %s in project: %s", service_name, project_name)
    result = aiven_client.get_pg_service_query_stats(project=project_name, service=service_name)
    return result


@mcp.tool()
def get_pg_current_queries(project_name, service_name):
    logger.info(
        "Fetching current queries for service: %s in project: %s", service_name, project_name
    )
    result = aiven_client.get_pg_service_current_queries(project=project_name, service=service_name)
    if not result:
        return "No current queries found"
    return result
