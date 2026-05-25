# Changelog

## [1.6.0](https://github.com/Aiven-Open/mcp-aiven/compare/v1.5.0...v1.6.0) (2026-05-25)


### Features

* **redeploy:** add optional branch param to aiven_application_redeploy ([#89](https://github.com/Aiven-Open/mcp-aiven/issues/89)) ([ed00551](https://github.com/Aiven-Open/mcp-aiven/commit/ed005519c2542d1c92015b655d35a75a84765a9e))

## [1.5.0](https://github.com/Aiven-Open/mcp-aiven/compare/v1.4.0...v1.5.0) (2026-05-25)


### Features

* rate limit behind load balancer ([#91](https://github.com/Aiven-Open/mcp-aiven/issues/91)) ([da32fc3](https://github.com/Aiven-Open/mcp-aiven/commit/da32fc398e88244fba13ebfe4c6108a2b58129b1))

## [1.4.0](https://github.com/Aiven-Open/mcp-aiven/compare/v1.3.3...v1.4.0) (2026-05-18)


### Features

* mcp maintenance mode ([#85](https://github.com/Aiven-Open/mcp-aiven/issues/85)) ([45e52cf](https://github.com/Aiven-Open/mcp-aiven/commit/45e52cf78bcdf0cd5d648a1ba5efd4861ba13cf8))


### Bug Fixes

* add IP-keyed rate limit ([#83](https://github.com/Aiven-Open/mcp-aiven/issues/83)) ([fe2ef14](https://github.com/Aiven-Open/mcp-aiven/commit/fe2ef14bbbca189f8c57103493faeda15138b302))

## [1.3.3](https://github.com/Aiven-Open/mcp-aiven/compare/v1.3.2...v1.3.3) (2026-05-17)


### Bug Fixes

* remove invalid cache: false from setup-node ([#81](https://github.com/Aiven-Open/mcp-aiven/issues/81)) ([7029863](https://github.com/Aiven-Open/mcp-aiven/commit/70298632fe1b51def9ac4258fad1e76ef88ea9f4))

## [1.3.2](https://github.com/Aiven-Open/mcp-aiven/compare/v1.3.1...v1.3.2) (2026-05-17)


### Bug Fixes

* move npm publish into release workflow ([#79](https://github.com/Aiven-Open/mcp-aiven/issues/79)) ([ac220f7](https://github.com/Aiven-Open/mcp-aiven/commit/ac220f761246d4e8b96d16e293cf8eee9c4022ed))

## [1.3.1](https://github.com/Aiven-Open/mcp-aiven/compare/v1.3.0...v1.3.1) (2026-05-17)


### Bug Fixes

* invalid secrets references in release and publish workflows ([#77](https://github.com/Aiven-Open/mcp-aiven/issues/77)) ([372c474](https://github.com/Aiven-Open/mcp-aiven/commit/372c47494f6c3a19366fa1e4fe32e6e786c23e40))
* limit large fields max size ([#71](https://github.com/Aiven-Open/mcp-aiven/issues/71)) ([450e3c1](https://github.com/Aiven-Open/mcp-aiven/commit/450e3c1539ad2fdbdea75e105ed7de2e0554c2ec))

## [1.3.0](https://github.com/Aiven-Open/mcp-aiven/compare/v1.2.0...v1.3.0) (2026-05-17)


### Features

* adopt semantic-release for automated versioning and npm publishing ([#67](https://github.com/Aiven-Open/mcp-aiven/issues/67)) ([f4d0dad](https://github.com/Aiven-Open/mcp-aiven/commit/f4d0dad2cf9d1b995a9bef9ac2ae966cdcfdb970))
* migrate from semantic-release to release-please ([#70](https://github.com/Aiven-Open/mcp-aiven/issues/70)) ([e6b744a](https://github.com/Aiven-Open/mcp-aiven/commit/e6b744ae7eb2909e39a0ecf3c98ed1b70f925d12))
* modify destructive tools [EVERSQL-1812] ([#73](https://github.com/Aiven-Open/mcp-aiven/issues/73)) ([a18593f](https://github.com/Aiven-Open/mcp-aiven/commit/a18593f912c42b7ff1979f41f1bae02668f6f822))


### Bug Fixes

* parse release-please PR output as JSON for Slack notification ([#76](https://github.com/Aiven-Open/mcp-aiven/issues/76)) ([24c99d4](https://github.com/Aiven-Open/mcp-aiven/commit/24c99d405d53da38f4f94e81566cfad45586da40))
* postpone json parsing to after auth ([#72](https://github.com/Aiven-Open/mcp-aiven/issues/72)) ([71a7040](https://github.com/Aiven-Open/mcp-aiven/commit/71a7040497a71a7f35fd7d3998d0a109f678e23f))
* release-please workflow failing ([#74](https://github.com/Aiven-Open/mcp-aiven/issues/74)) ([2eff5c8](https://github.com/Aiven-Open/mcp-aiven/commit/2eff5c80c3fef389e075c2a37bc6401ece6584db))
