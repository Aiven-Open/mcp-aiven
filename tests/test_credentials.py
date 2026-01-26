"""Unit tests for the credential filtering module."""

import pytest

from mcp_aiven.credentials import (
    REDACTED_VALUE,
    SENSITIVE_KEYS,
    filter_credentials,
    filter_service_response,
    filter_user_response,
    filter_integration_response,
)


class TestFilterCredentials:
    """Tests for the filter_credentials function."""

    def test_filter_simple_dict_with_password(self):
        """Test filtering a simple dictionary with a password field."""
        data = {"name": "mydb", "password": "secret123"}
        result = filter_credentials(data)

        assert result["name"] == "mydb"
        assert result["password"] == REDACTED_VALUE

    def test_filter_preserves_non_sensitive_fields(self):
        """Test that non-sensitive fields are preserved."""
        data = {
            "service_name": "my-postgres",
            "plan": "business-4",
            "cloud_name": "aws-us-east-1",
            "state": "RUNNING",
        }
        result = filter_credentials(data)

        assert result == data

    def test_filter_nested_dict(self):
        """Test filtering a nested dictionary structure."""
        data = {
            "service_name": "mydb",
            "users": [
                {"username": "admin", "password": "adminpass"},
                {"username": "readonly", "password": "readpass"},
            ],
        }
        result = filter_credentials(data)

        assert result["service_name"] == "mydb"
        assert result["users"][0]["username"] == "admin"
        assert result["users"][0]["password"] == REDACTED_VALUE
        assert result["users"][1]["username"] == "readonly"
        assert result["users"][1]["password"] == REDACTED_VALUE

    def test_filter_service_uri(self):
        """Test that service_uri is redacted."""
        data = {
            "service_name": "my-kafka",
            "service_uri": "kafka://user:password@host:9092",
        }
        result = filter_credentials(data)

        assert result["service_uri"] == REDACTED_VALUE

    def test_filter_connection_info(self):
        """Test that connection_info is redacted."""
        data = {
            "service_name": "my-pg",
            "connection_info": {
                "pg_uri": "postgres://user:pass@host:5432/db",
                "host": "myhost.aivencloud.com",
            },
        }
        result = filter_credentials(data)

        assert result["connection_info"] == REDACTED_VALUE

    def test_filter_access_cert_and_key(self):
        """Test that certificates and keys are redacted."""
        data = {
            "username": "avnadmin",
            "access_cert": "-----BEGIN CERTIFICATE-----...",
            "access_key": "-----BEGIN PRIVATE KEY-----...",
        }
        result = filter_credentials(data)

        assert result["username"] == "avnadmin"
        assert result["access_cert"] == REDACTED_VALUE
        assert result["access_key"] == REDACTED_VALUE

    def test_filter_deeply_nested_structure(self):
        """Test filtering a deeply nested structure."""
        data = {
            "level1": {
                "level2": {
                    "level3": {
                        "password": "deep_secret",
                        "safe_field": "visible",
                    }
                }
            }
        }
        result = filter_credentials(data)

        assert result["level1"]["level2"]["level3"]["password"] == REDACTED_VALUE
        assert result["level1"]["level2"]["level3"]["safe_field"] == "visible"

    def test_filter_list_of_dicts(self):
        """Test filtering a list of dictionaries."""
        data = [
            {"name": "user1", "token": "token1"},
            {"name": "user2", "token": "token2"},
        ]
        result = filter_credentials(data)

        assert result[0]["name"] == "user1"
        assert result[0]["token"] == REDACTED_VALUE
        assert result[1]["name"] == "user2"
        assert result[1]["token"] == REDACTED_VALUE

    def test_filter_empty_dict(self):
        """Test filtering an empty dictionary."""
        result = filter_credentials({})
        assert result == {}

    def test_filter_empty_list(self):
        """Test filtering an empty list."""
        result = filter_credentials([])
        assert result == []

    def test_filter_primitive_values(self):
        """Test that primitive values pass through unchanged."""
        assert filter_credentials("string") == "string"
        assert filter_credentials(123) == 123
        assert filter_credentials(True) is True
        assert filter_credentials(None) is None

    def test_filter_mixed_list(self):
        """Test filtering a list with mixed types."""
        data = [
            "string",
            123,
            {"password": "secret"},
            ["nested", {"token": "tok"}],
        ]
        result = filter_credentials(data)

        assert result[0] == "string"
        assert result[1] == 123
        assert result[2]["password"] == REDACTED_VALUE
        assert result[3][0] == "nested"
        assert result[3][1]["token"] == REDACTED_VALUE

    def test_filter_case_insensitive(self):
        """Test that key matching is case-insensitive."""
        data = {
            "Password": "secret1",
            "PASSWORD": "secret2",
            "passWORD": "secret3",
        }
        result = filter_credentials(data)

        assert result["Password"] == REDACTED_VALUE
        assert result["PASSWORD"] == REDACTED_VALUE
        assert result["passWORD"] == REDACTED_VALUE

    def test_filter_compound_keys(self):
        """Test that compound keys containing sensitive terms are filtered."""
        data = {
            "db_password": "secret",
            "admin_password_hash": "hash",
            "user_token": "tok123",
        }
        result = filter_credentials(data)

        assert result["db_password"] == REDACTED_VALUE
        assert result["admin_password_hash"] == REDACTED_VALUE
        assert result["user_token"] == REDACTED_VALUE

    def test_filter_custom_keys(self):
        """Test filtering with custom keys to filter."""
        data = {
            "custom_secret": "secret",
            "password": "pass",
            "normal": "value",
        }
        result = filter_credentials(data, keys_to_filter={"custom_secret"})

        assert result["custom_secret"] == REDACTED_VALUE
        assert result["password"] == "pass"  # Not filtered with custom keys
        assert result["normal"] == "value"

    def test_filter_custom_redacted_value(self):
        """Test filtering with a custom redacted value."""
        data = {"password": "secret"}
        result = filter_credentials(data, redacted_value="***HIDDEN***")

        assert result["password"] == "***HIDDEN***"

    def test_filter_service_uri_params(self):
        """Test that service_uri_params is redacted."""
        data = {
            "service_name": "my-service",
            "service_uri_params": {
                "host": "host.com",
                "port": 5432,
                "password": "secret",
            },
        }
        result = filter_credentials(data)

        assert result["service_uri_params"] == REDACTED_VALUE

    def test_filter_ssl_related_keys(self):
        """Test that SSL-related keys are filtered."""
        data = {
            "ssl_key": "-----BEGIN KEY-----",
            "ssl_cert": "-----BEGIN CERT-----",
            "client_key": "client key data",
            "client_cert": "client cert data",
        }
        result = filter_credentials(data)

        for key in data:
            assert result[key] == REDACTED_VALUE


class TestFilterServiceResponse:
    """Tests for the filter_service_response convenience function."""

    def test_filter_realistic_service_response(self):
        """Test filtering a realistic Aiven service response."""
        service_data = {
            "service_name": "my-postgres",
            "service_type": "pg",
            "plan": "business-4",
            "cloud_name": "aws-us-east-1",
            "state": "RUNNING",
            "service_uri": "postgres://avnadmin:secret@host.aivencloud.com:12345/defaultdb",
            "service_uri_params": {
                "host": "host.aivencloud.com",
                "port": 12345,
                "user": "avnadmin",
                "password": "secret",
                "dbname": "defaultdb",
            },
            "connection_info": {
                "pg": [
                    {
                        "host": "host.aivencloud.com",
                        "port": 12345,
                        "password": "secret",
                    }
                ]
            },
            "users": [
                {
                    "username": "avnadmin",
                    "type": "primary",
                    "password": "secret",
                    "access_cert": "-----BEGIN CERTIFICATE-----",
                    "access_key": "-----BEGIN PRIVATE KEY-----",
                }
            ],
            "node_count": 2,
            "disk_space_mb": 90000,
        }

        result = filter_service_response(service_data)

        # Non-sensitive fields preserved
        assert result["service_name"] == "my-postgres"
        assert result["service_type"] == "pg"
        assert result["plan"] == "business-4"
        assert result["state"] == "RUNNING"
        assert result["node_count"] == 2

        # Sensitive fields redacted
        assert result["service_uri"] == REDACTED_VALUE
        assert result["service_uri_params"] == REDACTED_VALUE
        assert result["connection_info"] == REDACTED_VALUE
        assert result["users"][0]["password"] == REDACTED_VALUE
        assert result["users"][0]["access_cert"] == REDACTED_VALUE
        assert result["users"][0]["access_key"] == REDACTED_VALUE

        # User metadata preserved
        assert result["users"][0]["username"] == "avnadmin"
        assert result["users"][0]["type"] == "primary"


class TestFilterUserResponse:
    """Tests for the filter_user_response convenience function."""

    def test_filter_user_with_credentials(self):
        """Test filtering a user response with credentials."""
        user_data = {
            "username": "avnadmin",
            "type": "primary",
            "password": "secret123",
            "access_cert": "cert_data",
            "access_key": "key_data",
        }

        result = filter_user_response(user_data)

        assert result["username"] == "avnadmin"
        assert result["type"] == "primary"
        assert result["password"] == REDACTED_VALUE
        assert result["access_cert"] == REDACTED_VALUE
        assert result["access_key"] == REDACTED_VALUE


class TestFilterIntegrationResponse:
    """Tests for the filter_integration_response convenience function."""

    def test_filter_integration_with_user_config(self):
        """Test filtering an integration response with user config credentials."""
        integration_data = {
            "integration_id": "int-123",
            "integration_type": "datadog",
            "source_service": "my-kafka",
            "dest_endpoint_id": "endpoint-456",
            "user_config": {
                "datadog_api_key": "api_key_value",
                "datadog_tags": ["env:prod"],
            },
        }

        result = filter_integration_response(integration_data)

        assert result["integration_id"] == "int-123"
        assert result["integration_type"] == "datadog"


class TestSensitiveKeys:
    """Tests to verify the SENSITIVE_KEYS set contains expected values."""

    def test_sensitive_keys_contains_password(self):
        assert "password" in SENSITIVE_KEYS

    def test_sensitive_keys_contains_token(self):
        assert "token" in SENSITIVE_KEYS

    def test_sensitive_keys_contains_service_uri(self):
        assert "service_uri" in SENSITIVE_KEYS

    def test_sensitive_keys_contains_connection_info(self):
        assert "connection_info" in SENSITIVE_KEYS

    def test_sensitive_keys_contains_certificates(self):
        assert "access_cert" in SENSITIVE_KEYS
        assert "client_cert" in SENSITIVE_KEYS
        assert "ca_cert" in SENSITIVE_KEYS

    def test_sensitive_keys_contains_keys(self):
        assert "access_key" in SENSITIVE_KEYS
        assert "private_key" in SENSITIVE_KEYS
        assert "client_key" in SENSITIVE_KEYS
        assert "ssl_key" in SENSITIVE_KEYS
