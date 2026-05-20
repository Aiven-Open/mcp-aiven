/**
 * OpenTelemetry instrumentation for the MCP server (HTTP mode).
 *
 * Exposes a Prometheus /metrics endpoint on a dedicated port so the
 * otel-agent on the same node can scrape http.server.request.duration
 * and other HTTP metrics.
 *
 * Gracefully no-ops when OTEL_METRICS_PORT is not set, so local
 * development and stdio mode work exactly as before. When the port
 * is set but something goes wrong, initialization failures are logged
 * but never crash the MCP server.
 */

const metricsPort = process.env['OTEL_METRICS_PORT'];

if (metricsPort) {
  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
    const { PrometheusExporter } = await import('@opentelemetry/exporter-prometheus');
    const port = parseInt(metricsPort, 10);

    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`Invalid OTEL_METRICS_PORT: ${metricsPort}`);
    }

    const exporter = new PrometheusExporter({ port, preventServerStart: false });

    const sdk = new NodeSDK({
      serviceName: 'mcp-aiven',
      metricReader: exporter,
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

    console.error(`mcp-aiven: OTEL metrics enabled, Prometheus endpoint on :${port}/metrics`);
  } catch (err: unknown) {
    console.error('mcp-aiven: OTEL initialization failed, continuing without metrics:', err);
  }
}
