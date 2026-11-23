/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_ICS_PROXY?: string;
  readonly VITE_PERSISTENT_LOGIN?: string;
}
