FROM node:24-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS dependencies
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
COPY app/ ./app/
RUN npm run db:generate && npm run app:build

FROM dependencies AS migration
COPY app/prisma.config.ts ./app/prisma.config.ts
COPY app/prisma/ ./app/prisma/
COPY app/src/lib/config/ ./app/src/lib/config/
COPY app/scripts/migrate.ts app/scripts/recover-sharing.ts app/scripts/recover-publication.ts app/scripts/deletion-ledger.ts ./app/scripts/
COPY app/src/lib/deletion/recovery.ts ./app/src/lib/deletion/recovery.ts
COPY deploy/runtime/recovery-query.sql deploy/runtime/recovery-hashes.sql deploy/runtime/recovery-publication-hashes.sql ./deploy/runtime/
USER node
CMD ["node", "--import", "tsx", "app/scripts/migrate.ts"]

FROM node:24-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS runtime
WORKDIR /workspace
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3200
ARG REVISION=local
LABEL org.opencontainers.image.source="https://github.com/aperAI-eu/brag.codes" org.opencontainers.image.revision="${REVISION}"
COPY --from=builder --chown=node:node /workspace/app/.next/standalone/ ./
COPY --from=builder --chown=node:node /workspace/app/.next/static/ ./app/.next/static/
COPY --from=builder --chown=node:node /workspace/app/public/ ./app/public/
COPY --chown=node:node app/src/lib/config/ ./bootstrap/config/
COPY --chown=node:node deploy/runtime/start.mjs ./bootstrap/start.mjs
RUN mkdir -p /var/lib/brag/pitches && chown node:node /var/lib/brag/pitches && chmod 700 /var/lib/brag/pitches
USER node
EXPOSE 3200
HEALTHCHECK --interval=10s --timeout=4s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3200/health/ready',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "bootstrap/start.mjs"]
