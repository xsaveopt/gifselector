/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_CATEGORY_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
