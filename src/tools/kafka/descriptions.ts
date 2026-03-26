const CONNECTOR_SUFFIX = `**Kafka Connect plan gate — call \`aiven_service_get\` first.** Read \`service.plan\`. On **free** Kafka plans (e.g. \`free-0\`), Kafka Connect is usually **not** available and the API returns **403** (e.g. "Kafka Connect API disabled"). Do **not** call Kafka Connect tools when \`service.plan\` is \`free-*\` or you know the tier lacks Connect; explain upgrade instead of invoking the API.

**Plans that typically include Kafka Connect:** \`startup-*\` (e.g. \`startup-2\`, \`startup-4\`), \`business-*\`, \`premium-*\`. A 403 mentioning Connect being **disabled** is typically a **plan** limitation, not token RBAC.

When \`source_service\` is provided, connection credentials (hostname, port, user, password) are automatically resolved from that Aiven service — no need to look up or provide passwords manually.

Supports Debezium CDC connectors (PostgreSQL, MySQL), JDBC source/sink, and any connector class. Extra configuration fields are passed through as-is.

**Prerequisites:** On a **supported** plan, the Kafka service must have Kafka Connect enabled (\`user_config.kafka_connect: true\`). If using Schema Registry for value/key converters, enable it too (\`user_config.schema_registry: true\`).

**IMPORTANT — Kafka Connect takes time to initialize.** After enabling via \`aiven_service_update\`, call \`aiven_service_get\` once to check if \`state\` is \`RUNNING\` and \`components\` includes \`kafka_connect\` in state \`running\`. If not ready, tell the user and let them decide when to re-check. Do NOT poll in a loop or retry on 503.

**IMPORTANT — topics must exist before the connector starts.** Aiven Kafka does not auto-create topics. Create all required topics using \`aiven_kafka_topic_create\` before or immediately after creating the connector. Topic naming depends on the connector type (e.g. Debezium uses \`{topic.prefix}.{schema}.{table}\`).`;

export const CREATE_CONNECTOR_DESCRIPTION = `Create a Kafka Connect connector.

${CONNECTOR_SUFFIX}

**Example — Debezium PostgreSQL CDC:**
\`\`\`
aiven_kafka_connect_create_connector(
  project="my-project",
  service_name="my-kafka",
  source_service="my-pg",
  name="pg-cdc",
  connector_class="io.debezium.connector.postgresql.PostgresConnector",
  topic.prefix="cdc",
  table.include.list="public.orders,public.users",
  plugin.name="pgoutput",
  slot.name="debezium_slot",
  database.sslmode="require",
  publication.autocreate.mode="filtered"
)
\`\`\``;

export const EDIT_CONNECTOR_DESCRIPTION = `Edit an existing Kafka Connect connector configuration.

${CONNECTOR_SUFFIX}`;
