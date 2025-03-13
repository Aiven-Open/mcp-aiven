"""Environment configuration for the MCP Aiven server.

This module handles all environment variable configuration with sensible defaults
and type conversion.
"""

from dotenv import load_dotenv
from dataclasses import dataclass
import os


@dataclass
class AivenConfig:
    """Configuration for Aiven connection settings.

    This class handles all environment variable configuration with sensible defaults
    and type conversion. It provides typed methods for accessing each configuration value.

    Required environment variables:
        AIVEN_BASE_URL: Aiven API base URL (default https://api.aiven.io)
        AIVEN_TOKEN: The token for authentication
    """

    def __init__(self):
        """Initialize the configuration from environment variables."""
        self._validate_required_vars()

    @property
    def url(self) -> str:
        """Get the Aiven Base URL."""
        return os.getenv("AIVEN_BASE_URL")

    @property
    def token(self) -> str:
        """Get the Aiven Token."""
        return os.getenv("AIVEN_TOKEN")

    def get_client_config(self) -> dict:
        """Get the configuration dictionary for aiven_connect client.

        Returns:
            dict: Configuration ready to be passed to aiven_connect.get_client()
        """
        config = {
            "url": self.url,
            "token": self.token,
        }

        return config

    def _validate_required_vars(self) -> None:
        """Validate that all required environment variables are set.

        Raises:
            ValueError: If any required environment variable is missing.
        """
        load_dotenv()
        missing_vars = []
        for var in ["AIVEN_BASE_URL", "AIVEN_TOKEN"]:
            if var not in os.environ:
                missing_vars.append(var)

        if missing_vars:
            raise ValueError(
                f"Missing required environment variables: {', '.join(missing_vars)}"
            )


# Global instance for easy access
config = AivenConfig()
