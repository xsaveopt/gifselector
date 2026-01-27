#!/bin/bash
npm audit --prefix backend --audit-level info --no-package-lock
npm audit --prefix frontend --audit-level info --no-package-lock

# process base path at runtime
export BACKEND_BASE_PATH=${BASE_PATH:-/gifselector}
export VITE_BASE_PATH=${BACKEND_BASE_PATH}
find /app/frontend/dist -type f -exec sed -i "s|/gifselector|${BACKEND_BASE_PATH}|g" {} +

node backend/src/server.js