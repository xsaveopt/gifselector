# build frontend and install backend dependencies
FROM node:24 AS build
WORKDIR /app

COPY . .

RUN set -xe \
    && npm install --prefix backend --omit=dev \
    && npm install --prefix frontend \
    && npm run build --prefix frontend

# copy built assets and backend to a minimal image
FROM node:24-slim AS runner
WORKDIR /app

COPY --from=build /app/backend/ ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/frontend/package.json ./frontend/package.json
COPY entrypoint.sh ./

ENV NODE_ENV=production

RUN set -xe \
    # install conversion dependencies
    && apt update \
    && apt install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        imagemagick \
    && curl -fsSL -o /usr/local/bin/gallery-dl 'https://github.com/mikf/gallery-dl/releases/download/v1.31.5/gallery-dl.bin' \
    && chmod +x /usr/local/bin/gallery-dl \
    # update npm
    && npm i -g npm \
    # make entrypoint executable
    && chmod +x ./entrypoint.sh \
    # fix permissions
    && chown -R node:node /app \
    # clean up
    && npm cache clean --force \
    && rm -rf /root /opt/* /tmp/* /var/cache/* /var/log/* /var/spool/* /var/lib/systemd

# create final minimal image
FROM scratch AS final
WORKDIR /app

COPY --from=runner / /
ENV NODE_ENV=production

USER node
ENTRYPOINT ["/app/entrypoint.sh"]