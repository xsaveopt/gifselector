FROM node:26 AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1].split('+')[0]")"
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:26 AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1].split('+')[0]")"
RUN pnpm install --prod --frozen-lockfile

FROM node:26-slim AS runner
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY src/server ./src/server
COPY src/discord ./src/discord
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
    && mkdir -p /data/uploads \
    && chown -R node:node /app /data \
    && rm -rf /root /opt/* /tmp/* /var/cache/* /var/log/* /var/spool/* /var/lib/systemd

FROM scratch AS final
WORKDIR /app

COPY --from=runner / /

ENV NODE_ENV=production
EXPOSE 3000

USER node
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "src/server/server.ts"]
