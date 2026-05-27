FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ src/
COPY generator/ generator/
RUN pnpm generate && pnpm generate:api-types && pnpm build && \
    pnpm prune --prod && \
    rm -rf src generator/src tsconfig.json

EXPOSE 3000

ENV MCP_TRANSPORT=http PORT=3000

# When SENTRY_DSN is set, preload Sentry's ESM hooks via NODE_OPTIONS.
# Must happen at Node startup (--import flag) because ESM loads all modules before app code runs.
ENTRYPOINT ["sh", "-c", "\
if [ -n \"$SENTRY_DSN\" ]; then \
  export NODE_OPTIONS=\"${NODE_OPTIONS:+$NODE_OPTIONS }--import @sentry/node/preload\"; \
fi; \
exec \"$@\"", "--"]

CMD ["node", "dist/index.js"]
