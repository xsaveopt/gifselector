FROM node:26 AS build
WORKDIR /app

COPY . .

RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1].split('+')[0]")"

RUN set -xe \
    && pnpm install --frozen-lockfile \
    && pnpm --filter=./frontend build \
    && pnpm --filter=./backend --prod --legacy deploy /deploy

FROM node:26-slim AS runner
WORKDIR /app

COPY --from=build /deploy ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY entrypoint.sh ./

ENV NODE_ENV=production

RUN set -xe \
    && apt update \
    && apt install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        imagemagick \
    && curl -fsSL -o /usr/local/bin/gallery-dl 'https://github.com/mikf/gallery-dl/releases/download/v1.31.10/gallery-dl.bin' \
    && chmod +x /usr/local/bin/gallery-dl \
    && chmod +x ./entrypoint.sh \
    && chown -R node:node /app \
    && rm -rf /root /opt/* /tmp/* /var/cache/* /var/log/* /var/spool/* /var/lib/systemd

FROM scratch AS final
WORKDIR /app

COPY --from=runner / /
ENV NODE_ENV=production

USER node
ENTRYPOINT ["/app/entrypoint.sh"]
