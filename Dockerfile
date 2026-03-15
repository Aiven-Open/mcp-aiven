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
CMD ["node", "dist/index.js"]
