.PHONY: fmt
fmt:
	uvx ruff format ./mcp_aiven

.PHONY: lint
lint:
	uvx ruff check ./mcp_aiven
