/* global require, module, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Android release builds refuse plain-HTTP requests (API 28+). A build pointed at an
 * `http://` API (the emulator's `http://10.0.2.2:3200`, a LAN test server) would then fail
 * every request with "no internet". Only such builds allow cleartext traffic; builds for an
 * `https://` API (preview, production) keep the platform default.
 */
module.exports = function withCleartextHttpApi(config) {
  const url = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3200').trim();
  if (!url.startsWith('http://')) return config;
  return withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });
};
