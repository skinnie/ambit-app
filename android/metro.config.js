const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');
const fs = require('fs');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */

// Sur Windows, normalise la casse du chemin via le filesystem réel
// pour éviter le bug Metro "startsWith" case-sensitive (ex: e:\ vs E:\)
const projectRoot = fs.realpathSync.native(__dirname);

const config = {
  projectRoot,
  watchFolders: [projectRoot],
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
