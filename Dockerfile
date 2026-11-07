FROM node:24-bookworm-slim AS build

WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

COPY . .
RUN pnpm install --frozen-lockfile \
  --filter @workspace/board... \
  --filter @workspace/api-server...

# The publishable Clerk key is public and is compiled into the browser bundle.
ARG CLERK_PUBLISHABLE_KEY
ARG VITE_CLERK_PROXY_URL=/api/__clerk
ENV CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY}
ENV VITE_CLERK_PROXY_URL=${VITE_CLERK_PROXY_URL}

RUN pnpm --filter @workspace/board run build \
  && pnpm --filter @workspace/api-server run build

FROM node:24-bookworm-slim AS migrate

WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile --filter @workspace/db...
CMD ["pnpm", "--filter", "@workspace/db", "run", "migrate"]

FROM node:24-bookworm-slim AS production-deps

WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

COPY . .
RUN pnpm install --prod --frozen-lockfile \
  --filter @workspace/board... \
  --filter @workspace/api-server...

FROM node:24-bookworm-slim AS production

WORKDIR /app
ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

COPY --from=production-deps --chown=node:node /app /app
COPY --from=build --chown=node:node /app/artifacts/board/dist /app/artifacts/board/dist
COPY --from=build --chown=node:node /app/artifacts/api-server/dist /app/artifacts/api-server/dist

USER node
EXPOSE 3000 5000
CMD ["node", "--enable-source-maps", "artifacts/board/dist/server.mjs"]
