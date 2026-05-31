#!/bin/bash
set -euo pipefail

npm audit --prefix backend --audit-level high

export BACKEND_BASE_PATH=${BASE_PATH:-/gifselector}
export VITE_BASE_PATH=${BACKEND_BASE_PATH}
find /app/frontend/dist -type f -exec sed -i "s|/gifselector|${BACKEND_BASE_PATH}|g" {} +

node backend/src/server.js
