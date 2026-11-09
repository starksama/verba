import appConfig from '../app.config.json';

const identity = import.meta.env.VITE_VERBA_DEV === '1' ? appConfig.development : appConfig;

export const APP_BRAND = {
  displayName: identity.displayName,
  legalName: appConfig.legalName,
  storagePrefix: identity.storagePrefix,
  iconUrl: new URL('../src-tauri/icons/32x32.png', import.meta.url).href,
  markUrl: new URL('../src-tauri/icons/128x128@2x.png', import.meta.url).href
} as const;
