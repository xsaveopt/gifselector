import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const baseEnv = process.env.VITE_BASE_PATH || '/gifselector';
const normalizedBase = baseEnv.endsWith('/') ? baseEnv : `${baseEnv}/`;
const baseWithoutTrailingSlash = normalizedBase.endsWith('/')
  ? normalizedBase.slice(0, -1)
  : normalizedBase;

export default defineConfig({
  base: normalizedBase,
  plugins: [react()],
  server: {
    proxy: {
      [`${baseWithoutTrailingSlash}/api`]: {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(`${baseWithoutTrailingSlash}/api`, `${baseWithoutTrailingSlash}/api`)
      },
      [`${baseWithoutTrailingSlash}/share`]: {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(`${baseWithoutTrailingSlash}/share`, `${baseWithoutTrailingSlash}/share`)
      }
    }
  }
});
