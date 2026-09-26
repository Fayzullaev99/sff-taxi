/* global require, module, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;

// Expo's default config already watches the monorepo root and resolves hoisted packages.
const config = getDefaultConfig(projectRoot);

/**
 * Other workspaces use a newer React than this Expo SDK supports, so npm keeps this
 * app's React nested in apps/rider/node_modules while the root holds the other one.
 * Hoisted packages (react-native, expo-router, ...) must still see this app's copy:
 * exactly one React may end up in the bundle.
 */
const PINNED = new Set(['react', 'react-dom', 'scheduler']);
const appOrigin = path.join(projectRoot, 'package.json');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const name = moduleName.startsWith('@')
    ? moduleName.split('/').slice(0, 2).join('/')
    : moduleName.split('/')[0];
  if (PINNED.has(name)) {
    return context.resolveRequest(
      { ...context, originModulePath: appOrigin },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
