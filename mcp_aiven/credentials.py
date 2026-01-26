"""Credential filtering utilities for the MCP Aiven server.

This module provides functions to sanitize sensitive data before returning
it to users, preventing credential leakage through API responses.
"""

from typing import Any, Set

# Default set of sensitive keys that should be redacted
SENSITIVE_KEYS: Set[str] = {
    "password",
    "access_key",
    "access_cert",
    "ca_cert",
    "service_uri",
    "service_uri_params",
    "connection_info",
    "secret",
    "token",
    "private_key",
    "client_cert",
    "client_key",
    "ssl_key",
    "ssl_cert",
    "keystore",
    "truststore",
}

REDACTED_VALUE = "[REDACTED]"


def filter_credentials(
    data: Any,
    keys_to_filter: Set[str] = None,
    redacted_value: str = REDACTED_VALUE,
) -> Any:
    """Recursively filter sensitive keys from data structures.

    This function traverses dictionaries and lists, replacing values
    associated with sensitive keys with a redacted placeholder.

    Args:
        data: The data structure to filter (dict, list, or primitive).
        keys_to_filter: Set of key names to redact. Defaults to SENSITIVE_KEYS.
        redacted_value: The value to use for redacted fields.

    Returns:
        A sanitized copy of the data with sensitive values replaced.

    Examples:
        >>> filter_credentials({"password": "secret123", "name": "mydb"})
        {'password': '[REDACTED]', 'name': 'mydb'}

        >>> filter_credentials({"users": [{"name": "admin", "password": "pass"}]})
        {'users': [{'name': 'admin', 'password': '[REDACTED]'}]}
    """
    if keys_to_filter is None:
        keys_to_filter = SENSITIVE_KEYS

    if isinstance(data, dict):
        return _filter_dict(data, keys_to_filter, redacted_value)
    elif isinstance(data, list):
        return _filter_list(data, keys_to_filter, redacted_value)
    else:
        return data


def _filter_dict(
    data: dict,
    keys_to_filter: Set[str],
    redacted_value: str,
) -> dict:
    """Filter sensitive keys from a dictionary."""
    result = {}
    for key, value in data.items():
        key_lower = key.lower()
        # Check if this key should be filtered
        if key_lower in keys_to_filter or _is_sensitive_key(key_lower, keys_to_filter):
            result[key] = redacted_value
        else:
            # Recursively filter nested structures
            result[key] = filter_credentials(value, keys_to_filter, redacted_value)
    return result


def _filter_list(
    data: list,
    keys_to_filter: Set[str],
    redacted_value: str,
) -> list:
    """Filter sensitive keys from items in a list."""
    return [filter_credentials(item, keys_to_filter, redacted_value) for item in data]


def _is_sensitive_key(key: str, keys_to_filter: Set[str]) -> bool:
    """Check if a key matches any sensitive pattern.

    Handles compound keys and partial matches for common patterns.
    """
    # Check for compound keys containing sensitive terms
    for sensitive_key in keys_to_filter:
        if sensitive_key in key:
            return True
    return False


def filter_service_response(service_data: dict) -> dict:
    """Filter a service response to remove sensitive credentials.

    This is a convenience function specifically for Aiven service responses.

    Args:
        service_data: The raw service data from Aiven API.

    Returns:
        Filtered service data safe for user consumption.
    """
    return filter_credentials(service_data)


def filter_user_response(user_data: dict) -> dict:
    """Filter a user response to remove sensitive credentials.

    Args:
        user_data: The raw user data from Aiven API.

    Returns:
        Filtered user data safe for user consumption.
    """
    return filter_credentials(user_data)


def filter_integration_response(integration_data: dict) -> dict:
    """Filter an integration response to remove sensitive credentials.

    Args:
        integration_data: The raw integration data from Aiven API.

    Returns:
        Filtered integration data safe for user consumption.
    """
    return filter_credentials(integration_data)
