import logging
from typing import Sequence
import concurrent.futures
import atexit
import psycopg2

from aiven.client import client
from dotenv import load_dotenv
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
# aiven_client.set_project(config.project)

load_dotenv()

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
    logger.info(f"Found {len(results) if isinstance(results, list) else 1} projects")
    res = []
    for result in results:
        res.append(result['project_name'])
    return res


@mcp.tool()
def list_services(project_name):
    logger.info("Listing all services for a project")
    results = aiven_client.get_services(project=project_name)
    logger.info(f"Found {len(results) if isinstance(results, list) else 1} services")
    res = []
    for result in results:
        res.append(result['service_name'])
    return results


@mcp.tool()
def get_service_details(project_name, service_name):
    logger.info("Listing service details")
    result = aiven_client.get_service(project=project_name, service=service_name)
    logger.info(f"Found {len(result) if isinstance(result, list) else 1} services")
    return result

@mcp.tool()
def get_metadata(project_name, service_name):
    logger.info("Listing service details")
    service = aiven_client.get_service(project=project_name, service=service_name)
    try:
        conn = psycopg2.connect(build_conn_string(service), connect_timeout=2)
    except psycopg2.Error as err:
        conn = None
        print("Error connecting to: " + service_name + str(err))
    if conn is not None:
        cur = conn.cursor()
        cur.execute("""
                        select
                            t.table_name,
                            array_agg(c.column_name::text) as columns
                        from
                            information_schema.tables t
                            inner join information_schema.columns c on
                                t.table_name = c.table_name
                        where
                            t.table_schema = 'public'
                            and t.table_type= 'BASE TABLE'
                            and c.table_schema = 'public'
                        group by t.table_name;
                    """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        logger.info(f"Found {len(rows) if isinstance(rows, list) else 1} rows")
        return rows
    return "none"

@mcp.tool()
def run_query(project_name, service_name, query):
    logger.info("Listing service details")
    service = aiven_client.get_service(project=project_name, service=service_name)
    try:
        conn = psycopg2.connect(build_conn_string(service), connect_timeout=2)
    except psycopg2.Error as err:
        conn = None
        print("Error connecting to: " + service_name + str(err))
    if conn is not None:
        cur = conn.cursor()
        cur.execute(query)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        logger.info(f"Found {len(rows) if isinstance(rows, list) else 1} rows")
        return rows
    return "none"


def build_conn_string(service):
    avnadmin_pwd = list(
        filter(lambda x: x["username"] == "avnadmin", service["users"])
    )[0]["password"]

    service_conn_info = service["connection_info"]["pg_params"][0]

    """Builds conntection string"""
    connstr = (
        "postgres://avnadmin:"
        + avnadmin_pwd
        + "@"
        + service_conn_info["host"]
        + ":"
        + service_conn_info["port"]
        + "/"
        + service_conn_info["dbname"]
        + "?sslmode="
        + service_conn_info["sslmode"]
    )
    return connstr