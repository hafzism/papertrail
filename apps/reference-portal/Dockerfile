FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/reference-portal/package.json apps/reference-portal/package.json
RUN pnpm install --frozen-lockfile --filter @papertrail/reference-portal...
COPY apps/reference-portal apps/reference-portal
RUN pnpm --filter @papertrail/reference-portal build
ENV REFERENCE_PORTAL_HOST=0.0.0.0 REFERENCE_PORTAL_PORT=3001 REFERENCE_PORTAL_DATA_DIR=/data
EXPOSE 3001
CMD ["node", "apps/reference-portal/dist/server.js"]
