import { Container, getRandom } from "@cloudflare/containers";

const CONTAINER_PORT = 3000;
const INSTANCE_COUNT = 5;

interface Env {
  MCP_CONTAINER: DurableObjectNamespace<McpAivenContainer>;
}

export class McpAivenContainer extends Container {
  defaultPort = CONTAINER_PORT;
  sleepAfter = "5m";

  override envVars = {
    MCP_TRUST_PROXY: "true",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = await getRandom(env.MCP_CONTAINER, INSTANCE_COUNT);
    return container.fetch(request);
  },
};
