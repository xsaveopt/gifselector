FROM node:26 AS build
WORKDIR /app

COPY . .

RUN set -xe \
    && npm install --prefix backend --omit=dev \
    && npm install --prefix frontend \
    && npm run build --prefix frontend

FROM node:26-slim AS runner
WORKDIR /app

COPY --from=build /app/backend/ ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/frontend/package.json ./frontend/package.json
COPY entrypoint.sh ./

ENV NODE_ENV=production

RUN set -xe \
    && apt update \
    && apt install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        imagemagick \
    && curl -fsSL -o /usr/local/bin/gallery-dl 'https://github.com/mikf/gallery-dl/releases/download/v1.31.5/gallery-dl.bin' \
    && chmod +x /usr/local/bin/gallery-dl \
    && npm i -g npm \
    && chmod +x ./entrypoint.sh \
    && chown -R node:node /app \
    && npm cache clean --force \
    && rm -rf /root /opt/* /tmp/* /var/cache/* /var/log/* /var/spool/* /var/lib/systemd

FROM scratch AS final
WORKDIR /app

COPY --from=runner / /
ENV NODE_ENV=production

USER node
ENTRYPOINT ["/app/entrypoint.sh"]