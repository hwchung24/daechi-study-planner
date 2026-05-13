/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALLOW_STUDENT_WEB?: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
