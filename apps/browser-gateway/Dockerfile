FROM mcr.microsoft.com/playwright:v1.63.0-noble

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends novnc x11vnc xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/browser-gateway/package.json apps/browser-gateway/package.json
RUN corepack enable && pnpm install --frozen-lockfile --filter @papertrail/browser-gateway...
COPY apps/browser-gateway apps/browser-gateway
RUN pnpm --filter @papertrail/browser-gateway build

COPY infra/browser-runner/entrypoint.sh /usr/local/bin/papertrail-browser-runner
RUN chmod +x /usr/local/bin/papertrail-browser-runner

ENV DISPLAY=:99
EXPOSE 3002
CMD ["/usr/local/bin/papertrail-browser-runner"]
