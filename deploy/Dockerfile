# ============================================================
# bytedance-aigc API — production Docker image
# Multi-stage: install → generate → build → runtime
# ============================================================
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app

# --- deps stage (all deps including dev) ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

# --- prisma generate + build stage ---
FROM deps AS build
COPY apps/api/prisma/ apps/api/prisma/
RUN cd apps/api && npx prisma@5 generate
COPY packages/shared/ packages/shared/
COPY packages/ui/ packages/ui/
COPY apps/api/ apps/api/
RUN pnpm --filter @bytedance-aigc/shared build \
 && cd apps/api && npx nest build

# --- runtime stage ---
FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app

# Full node_modules from build stage (pnpm monorepo workspace layout is complex;
# pruning devDeps can break symlinks — use full modules for reliability)
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=build /app/packages/ui/node_modules packages/ui/node_modules

# Workspace package.json files (needed for symlink resolution)
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/ui/package.json packages/ui/package.json
COPY --from=build /app/package.json package.json
COPY --from=build /app/pnpm-workspace.yaml pnpm-workspace.yaml

# Built artifacts
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/rules packages/shared/rules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "apps/api/dist/src/main.js"]
