/**
 * OpenTelemetry instrumentation for the MCP server (HTTP mode).
 *
 * Loaded via `node --import ./dist/instrumentation.js` so that the OTEL SDK
 * initializes before Express and other modules are loaded. This is required
 * for auto-instrumentation to monkey-patch HTTP/Express correctly.
 *
 * Gracefully no-ops when OTEL_EXPORTER_OTLP_ENDPOINT is not set, so local
 * development and stdio mode work exactly as before. When the endpoint is
 * unreachable or credentials are wrong, export failures are logged but
 * never crash the MCP server.
 */

const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

if (endpoint) {
  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
    const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-grpc');
    const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics');
    const sdk = new NodeSDK({
      serviceName: 'mcp-aiven',
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 15_000,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
          '@opentelemetry/instrumentation-net': { enabled: false },
        }),
      ],
    });

    sdk.start();

    const shutdown = (): void => {
      sdk.shutdown().catch((err: unknown) => {
        console.error('mcp-aiven: OTEL shutdown error:', err);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    console.error(`mcp-aiven: OTEL metrics enabled, exporting to ${endpoint}`);
  } catch (err: unknown) {
    console.error('mcp-aiven: OTEL initialization failed, continuing without metrics:', err);
  }
}
