#!/bin/bash
npm audit --prefix backend --audit-level info --no-package-lock
npm audit --prefix frontend --audit-level info --no-package-lock
node backend/src/server.js