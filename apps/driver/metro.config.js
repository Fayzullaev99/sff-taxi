/* global __dirname, module, require */
/* eslint-disable @typescript-eslint/no-require-imports */
// Metro in an npm-workspaces monorepo.
// Dependencies are hoisted to the repository root, but this app pins the React version
// its React Native release was built for, while other workspaces may hoist a newer one.
// Every `react` import (including the ones from hoisted packages such as react-native or
// @tanstack/react-query) is therefore resolved from this app, so exactly one copy ships.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

const SINGLETONS = ['react'];
const fromApp = path.join(projectRoot, 'package.json');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const singleton = SINGLETONS.some((n) => moduleName === n || moduleName.startsWith(`${n}/`));
  return context.resolveRequest(
    singleton ? { ...context, originModulePath: fromApp } : context,
    moduleName,
    platform,
  );
};

module.exports = config;
