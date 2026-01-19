FROM node:24 AS build
WORKDIR /app

ENV VITE_BASE_PATH=/gifs

COPY . .

RUN set -xe \
    && npm install --prefix backend --omit=dev \
    && npm install --prefix frontend \
    && npm run build --prefix frontend

FROM node:24-slim AS runner
WORKDIR /app

ENV FRONTEND_DIST=/app/frontend/dist
ENV NODE_ENV=production

COPY --from=build /app/backend/ ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/frontend/package.json ./frontend/package.json
COPY entrypoint.sh ./

RUN set -xe \
    # update npm
    && npm i -g npm \
    # make entrypoint executable
    && chmod +x ./entrypoint.sh \
    # fix permissions
    && chown -R node:node /app \
    # clean up
    && npm cache clean --force \
    && rm -rf /root /opt/* /tmp/* /var/cache/* /var/log/* /var/spool/* /var/lib/systemd

FROM scratch AS final
COPY --from=runner / /
WORKDIR /app

ENV BACKEND_BASE_PATH=/gifs
ENV FRONTEND_DIST=/app/frontend/dist
ENV NODE_ENV=production
ENV VITE_BASE_PATH=/gifs

USER node

ENTRYPOINT ["/app/entrypoint.sh"]