"""MCP Aiven Server - Model Context Protocol server for Aiven services.

This module provides tools for managing Aiven cloud services including:
- Project and service management
- User and authentication management
- Database operations
- Service integrations

Security Note: All responses are filtered to prevent credential leakage.
"""

import logging
import webbrowser
from typing import Optional

from aiven.client import client
from mcp.server.fastmcp import FastMCP

from mcp_aiven.credentials import (
    filter_service_response,
    filter_user_response,
    filter_integration_response,
    filter_credentials,
)
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


# =============================================================================
# Project Tools
# =============================================================================


@mcp.tool()
def list_projects() -> list[str]:
    """List all projects on your Aiven account.

    Returns:
        List of project names.
    """
    logger.info("Listing all projects")
    results = aiven_client.get_projects()
    logger.info(f"Found {len(results)} projects")
    return [result["project_name"] for result in results]


# =============================================================================
# Service Tools
# =============================================================================


@mcp.tool()
def list_services(project_name: str) -> list[str]:
    """List all services in a specific Aiven project.

    Args:
        project_name: The name of the Aiven project.

    Returns:
        List of service names.
    """
    logger.info("Listing all services in project: %s", project_name)
    results = aiven_client.get_services(project=project_name)
    logger.info(f"Found {len(results)} services")
    return [s["service_name"] for s in results]


@mcp.tool()
def get_service_details(project_name: str, service_name: str) -> dict:
    """Get the details of a service in a specific Aiven project.

    Note: Sensitive credentials (passwords, connection URIs, certificates)
    are redacted for security. Use the Aiven console to retrieve credentials.

    Args:
        project_name: The name of the Aiven project.
        service_name: The name of the service.

    Returns:
        Filtered service details with sensitive data redacted.
    """
    logger.info(
        "Fetching details for service: %s in project: %s", service_name, project_name
    )
    result = aiven_client.get_service(project=project_name, service=service_name)
    return filter_service_response(result)


@mcp.tool()
def list_service_types(project_name: str) -> list[dict]:
    """List available service types and their plans.

    Args:
        project_name: The name of the Aiven project.

    Returns:
        List of service types with their available plans and descriptions.
    """
    logger.info("Listing service types for project: %s", project_name)
    result = aiven_client.get_service_types(project=project_name)
    # Return a simplified view of service types
    service_types = []
    for service_type, details in result.items():
        service_types.append(
            {
                "service_type": service_type,
                "description": details.get("description", ""),
                "latest_available_version": details.get("latest_available_version", ""),
                "user_config_schema": "Available (use for user_config parameter)",
            }
        )
    return service_types


@mcp.tool()
def create_service(
    project_name: str,
    service_name: str,
    service_type: str,
    plan: str,
    cloud: Optional[str] = None,
    user_config: Optional[dict] = None,
) -> dict:
    """Create a new Aiven service.

    Args:
        project_name: The name of the Aiven project.
        service_name: The name for the new service.
        service_type: The type of service (e.g., 'pg', 'kafka', 'clickhouse',
                      'valkey', 'opensearch', 'mysql', 'redis', 'cassandra').
        plan: The service plan (e.g., 'startup-4', 'business-4', 'premium-6').
        cloud: The cloud region (e.g., 'aws-us-east-1', 'google-us-central1').
               If not specified, uses the project default.
        user_config: Optional service-specific configuration.

    Returns:
        Filtered service details with sensitive data redacted.
    """
    logger.info(
        "Creating service: %s (type: %s, plan: %s) in project: %s",
        service_name,
        service_type,
        plan,
        project_name,
    )
    result = aiven_client.create_service(
        project=project_name,
        service=service_name,
        service_type=service_type,
        plan=plan,
        cloud=cloud,
        user_config=user_config or {},
    )
    logger.info("Service %s created successfully", service_name)
    return filter_service_response(result)


@mcp.tool()
def update_service(
    project_name: str,
    service_name: str,
    plan: Optional[str] = None,
    cloud: Optional[str] = None,
    user_config: Optional[dict] = None,
    powered: Optional[bool] = None,
) -> dict:
    """Update an existing Aiven service configuration.

    Args:
        project_name: The name of the Aiven project.
        service_name: The name of the service to update.
        plan: New service plan (optional).
        cloud: New cloud region (optional).
        user_config: New service configuration (optional).
        powered: Set to False to power off, True to power on (optional).

    Returns:
        Filtered updated service details with sensitive data redacted.
    """
    logger.info("Updating service: %s in project: %s", service_name, project_name)

    # Build update parameters, only including non-None values
    update_params = {}
    if plan is not None:
        update_params["plan"] = plan
    if cloud is not None:
        update_params["cloud"] = cloud
    if user_config is not None:
        update_params["user_config"] = user_config
    if powered is not None:
        update_params["powered"] = powered

    result = aiven_client.update_service(
        project=project_name,
        service=service_name,
        **update_params,
    )
    logger.info("Service %s updated successfully", service_name)
    return filter_service_response(result)


@mcp.tool()
def delete_service(project_name: str, service_name: str) -> dict:
    """Permanently delete an Aiven service.

    WARNING: This action is irreversible. All data will be lost.

    Args:
        project_name: The name of the Aiven project.
        service_name: The name of the service to delete.

    Returns:
        Confirmation of deletion.
    """
    logger.info("Deleting service: %s in project: %s", service_name, project_name)
    aiven_client.delete_service(project=project_name, service=service_name)
    logger.info("Service %s deleted successfully", service_name)
    return {"status": "deleted", "service_name": service_name}


# =============================================================================
# Service User Tools
# =============================================================================


@mcp.tool()
def create_service_user(
    project_name: str,
    service_name: str,
    username: str,
) -> dict:
    """Create a new user for a service (database user).

    The password is auto-generated by Aiven. For security, the password
    is NOT returned. Retrieve credentials through the Aiven console.

    Args:
        project_name: The name of the Aiven project.
        service_name: The name of the service.
        username: The username for the new user.

    Returns:
        User information (without password).
    """
    logger.info(
        "Creating user %s for service: %s in project: %s",
        username,
        service_name,
        project_name,
    )
    result = aiven_client.create_service_user(
        project=project_name,
        service=service_name,
        username=username,
    )
    logger.info("User %s created successfully", username)
    return filter_user_response(result)


@mcp.tool()
def list_service_users(project_name: str, service_name: str) -> list[dict]:
    """List all users for a service.

    Args:
        project_name: The name of the Aiven project.
        service_name: The name of the service.

    Returns:
        List of users with sensitive credentials redacted.
    """
    logger.info(
        "Listing users for service: %s in project: %s", service_name, project_name
    )
    # Get service details which includes users
    service = aiven_client.get_service(project=project_name, service=service_name)
    users = service.get("users", [])
    logger.info(f"Found {len(users)} users")
    return [filter_user_response(user) for user in users]


@mcp.tool()
def delete_service_user(
    project_name: str,
    service_name: str,
    username: str,
) -> dict:
    """Delete a service user.

    Args:
        project_name: The name of the Aiven project.
        service_name: The name of the service.
        username: The username to delete.

    Returns:
        Confirmation of deletion.
    """
    logger.info(
        "Deleting user %s from service: %s in project: %s",
        username,
        service_name,
        project_name,
    )
    aiven_client.delete_service_user(
        project=project_name,
        service=service_name,
        username=username,
    )
    logger.info("User %s deleted successfully", username)
    return {"status": "deleted", "username": username}


@mcp.tool()
def reset_service_user_password(
    project_name: str,
    service_name: str,
    username: str,
) -> dict:
    """Reset a service user's password.

    For security, the new password is NOT returned in the response.
    Retrieve the new credentials through the Aiven console.

    Args:
        project_name: The name of the Aiven project.
        service_name: The name of the service.
        username: The username whose password to reset.

    Returns:
        Confirmation that the password was reset.
    """
    logger.info(
        "Resetting password for user %s in service: %s, project: %s",
        username,
        service_name,
        project_name,
    )
    aiven_client.reset_service_user_password(
        project=project_name,
        service=service_name,
        username=username,
    )
    logger.info("Password reset for user %s", username)
    return {
        "status": "password_reset",
        "username": username,
        "message": "Password has been reset. Retrieve new credentials from Aiven console.",
    }


# =============================================================================
# Database Tools (PostgreSQL/MySQL)
# =============================================================================


@mcp.tool()
def create_database(
    project_name: str,
    service_name: str,
    database_name: str,
) -> dict:
    """Create a new database in a PostgreSQL or MySQL service.

    Args:
        project_name: The name of the Aiven project.
        service_name: The name of the database service.
        database_name: The name for the new database.

    Returns:
        Confirmation of database creation.
    """
    logger.info(
        "Creating database %s in service: %s, project: %s",
        database_name,
        service_name,
        project_name,
    )
    aiven_client.create_database(
        project=project_name,
        service=service_name,
        dbname=database_name,
    )
    logger.info("Database %s created successfully", database_name)
    return {"status": "created", "database_name": database_name}


@mcp.tool()
def list_databases(project_name: str, service_name: str) -> list[dict]:
    """List all databases in a PostgreSQL or MySQL service.

    Args:
        project_name: The name of the Aiven project.
        service_name: The name of the database service.

    Returns:
        List of databases.
    """
    logger.info(
        "Listing databases in service: %s, project: %s", service_name, project_name
    )
    result = aiven_client.get_service_databases(
        project=project_name,
        service=service_name,
    )
    logger.info(f"Found {len(result)} databases")
    return result


@mcp.tool()
def delete_database(
    project_name: str,
    service_name: str,
    database_name: str,
) -> dict:
    """Delete a database from a PostgreSQL or MySQL service.

    WARNING: This action is irreversible. All data in the database will be lost.

    Args:
        project_name: The name of the Aiven project.
        service_name: The name of the database service.
        database_name: The name of the database to delete.

    Returns:
        Confirmation of deletion.
    """
    logger.info(
        "Deleting database %s from service: %s, project: %s",
        database_name,
        service_name,
        project_name,
    )
    aiven_client.delete_database(
        project=project_name,
        service=service_name,
        dbname=database_name,
    )
    logger.info("Database %s deleted successfully", database_name)
    return {"status": "deleted", "database_name": database_name}


# =============================================================================
# Integration Tools
# =============================================================================


@mcp.tool()
def list_integration_types(project_name: str) -> list[dict]:
    """List available integration types for a project.

    Args:
        project_name: The name of the Aiven project.

    Returns:
        List of available integration types.
    """
    logger.info("Listing integration types for project: %s", project_name)
    result = aiven_client.get_service_integration_types(project=project_name)
    return result


@mcp.tool()
def create_integration(
    project_name: str,
    integration_type: str,
    source_service: str,
    dest_service: str,
    user_config: Optional[dict] = None,
) -> dict:
    """Create an integration between two services.

    Args:
        project_name: The name of the Aiven project.
        integration_type: The type of integration (e.g., 'metrics', 'logs',
                          'read_replica', 'datasource').
        source_service: The source service name.
        dest_service: The destination service name.
        user_config: Optional integration-specific configuration.

    Returns:
        Filtered integration details with sensitive data redacted.
    """
    logger.info(
        "Creating %s integration from %s to %s in project: %s",
        integration_type,
        source_service,
        dest_service,
        project_name,
    )
    result = aiven_client.create_service_integration(
        project=project_name,
        integration_type=integration_type,
        source_service=source_service,
        dest_service=dest_service,
        user_config=user_config or {},
    )
    logger.info("Integration created successfully")
    return filter_integration_response(result)


@mcp.tool()
def list_integrations(project_name: str, service_name: str) -> list[dict]:
    """List integrations for a service.

    Args:
        project_name: The name of the Aiven project.
        service_name: The name of the service.

    Returns:
        List of integrations with sensitive data redacted.
    """
    logger.info(
        "Listing integrations for service: %s in project: %s",
        service_name,
        project_name,
    )
    result = aiven_client.get_service_integrations(
        project=project_name,
        service=service_name,
    )
    logger.info(f"Found {len(result)} integrations")
    return [filter_integration_response(i) for i in result]


@mcp.tool()
def delete_integration(project_name: str, integration_id: str) -> dict:
    """Delete an integration.

    Args:
        project_name: The name of the Aiven project.
        integration_id: The ID of the integration to delete.

    Returns:
        Confirmation of deletion.
    """
    logger.info(
        "Deleting integration %s in project: %s", integration_id, project_name
    )
    aiven_client.delete_service_integration(
        project=project_name,
        integration_id=integration_id,
    )
    logger.info("Integration %s deleted successfully", integration_id)
    return {"status": "deleted", "integration_id": integration_id}


# =============================================================================
# Authentication Tools
# =============================================================================


@mcp.tool()
def get_user_info() -> dict:
    """Get information about the currently authenticated user.

    Returns:
        User profile information with sensitive data redacted.
    """
    logger.info("Fetching current user info")
    result = aiven_client.get_user_info()
    return filter_credentials(result)


@mcp.tool()
def list_access_tokens() -> list[dict]:
    """List all access tokens for the current user.

    Note: Full token values are never exposed. Only token metadata
    (prefix, description, expiry) is returned.

    Returns:
        List of access tokens with metadata only.
    """
    logger.info("Listing access tokens")
    result = aiven_client.access_token_list()
    # Filter to only return safe metadata
    tokens = []
    for token in result:
        tokens.append(
            {
                "token_prefix": token.get("token_prefix", ""),
                "description": token.get("description", ""),
                "create_time": token.get("create_time", ""),
                "expiry_time": token.get("expiry_time", ""),
                "last_used_time": token.get("last_used_time", ""),
                "max_age_seconds": token.get("max_age_seconds", ""),
            }
        )
    logger.info(f"Found {len(tokens)} access tokens")
    return tokens


@mcp.tool()
def create_access_token(
    description: str,
    max_age_seconds: Optional[int] = None,
) -> dict:
    """Create a new access token for API access.

    IMPORTANT: The full token is only shown ONCE when created.
    Store it securely as it cannot be retrieved later.

    Args:
        description: A description for the token (e.g., 'CI/CD pipeline').
        max_age_seconds: Optional token lifetime in seconds. If not specified,
                         the token does not expire.

    Returns:
        Token information. Note: The full token is returned ONLY on creation.
    """
    logger.info("Creating access token: %s", description)
    result = aiven_client.access_token_create(
        description=description,
        max_age_seconds=max_age_seconds,
    )
    logger.info("Access token created with prefix: %s", result.get("token_prefix", ""))
    # For token creation, we return the full token as this is the only time it's available
    # But we warn the user to store it securely
    return {
        "token_prefix": result.get("token_prefix", ""),
        "full_token": result.get("full_token", "[Token returned by API]"),
        "description": result.get("description", description),
        "expiry_time": result.get("expiry_time", ""),
        "warning": "Store this token securely. It cannot be retrieved again.",
    }


@mcp.tool()
def revoke_access_token(token_prefix: str) -> dict:
    """Revoke an access token.

    Args:
        token_prefix: The prefix of the token to revoke (from list_access_tokens).

    Returns:
        Confirmation of revocation.
    """
    logger.info("Revoking access token: %s", token_prefix)
    aiven_client.access_token_revoke(token_prefix=token_prefix)
    logger.info("Access token %s revoked", token_prefix)
    return {"status": "revoked", "token_prefix": token_prefix}


# =============================================================================
# Account Management Tools
# =============================================================================


@mcp.tool()
def create_user(email: str, real_name: str) -> dict:
    """Create a new Aiven user account.

    This creates a new user account. The user will receive an email
    to verify their address and set their password.

    Note: Password is NOT set via this tool for security reasons.
    The user will set their password through the email verification flow.

    Args:
        email: The email address for the new user.
        real_name: The user's full name.

    Returns:
        User creation confirmation with user info (no sensitive data).
    """
    logger.info("Creating new user account for: %s", email)
    result = aiven_client.create_user(
        email=email,
        password=None,  # User will set password via email verification
        real_name=real_name,
    )
    logger.info("User account created for: %s", email)
    return filter_credentials(result)


@mcp.tool()
def open_signup_page() -> dict:
    """Open the Aiven signup page in the default browser.

    This opens https://console.aiven.io/signup in your browser to create
    a new Aiven account. After completing signup and email verification,
    use the `login` tool to authenticate.

    Returns:
        Status message with next steps.
    """
    signup_url = "https://console.aiven.io/signup"
    logger.info("Opening Aiven signup page: %s", signup_url)

    try:
        webbrowser.open(signup_url)
        return {
            "status": "opened",
            "url": signup_url,
            "next_steps": [
                "1. Complete the signup form in your browser",
                "2. Verify your email address",
                "3. Set your password",
                "4. Use the login() tool with your email and password to authenticate",
            ],
        }
    except Exception as e:
        logger.error("Failed to open browser: %s", str(e))
        return {
            "status": "error",
            "message": f"Could not open browser automatically. Please visit: {signup_url}",
            "url": signup_url,
        }


@mcp.tool()
def login(email: str, password: str, otp: Optional[str] = None) -> dict:
    """Authenticate with Aiven and configure the session.

    Use this after signing up to authenticate and enable API access.
    The authentication token is stored for the current session only
    and is NOT returned in the response for security.

    Args:
        email: Your Aiven account email.
        password: Your Aiven account password.
        otp: One-time password if 2FA is enabled (optional).

    Returns:
        Authentication status and user info (no token exposed).
    """
    logger.info("Authenticating user: %s", email)

    try:
        result = aiven_client.authenticate_user(
            email=email,
            password=password,
            otp=otp,
        )

        # Extract and set the token for this session
        token = result.get("token")
        if token:
            aiven_client.set_auth_token(token)
            logger.info("Authentication successful for: %s", email)

            # Return user info without the token
            return {
                "status": "authenticated",
                "message": "Login successful. You can now use all Aiven tools.",
                "user": filter_credentials(result.get("user", {})),
            }
        else:
            return {
                "status": "error",
                "message": "Authentication succeeded but no token received.",
            }

    except Exception as e:
        logger.error("Authentication failed for %s: %s", email, str(e))
        return {
            "status": "error",
            "message": f"Authentication failed: {str(e)}",
        }
