const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = Array.from(new Set([...(config.watchFolders ?? []), monorepoRoot]));

config.resolver = config.resolver ?? {};
config.resolver.unstable_enablePackageExports = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

const blockedDirs = [
  /[\\/]apps[\\/]web[\\/]node_modules[\\/].*/,
  /[\\/]apps[\\/]server[\\/].*/,
  /[\\/]apps[\\/]desktop[\\/].*/,
  /[\\/]apps[\\/]clipper[\\/].*/,
  /[\\/]packages[\\/]db[\\/].*/,
  /[\\/]packages[\\/]ui[\\/].*/,
  /[\\/]\.expo-export[\\/].*/,
];

const existingBlockList = config.resolver.blockList;
if (Array.isArray(existingBlockList)) {
  config.resolver.blockList = [...existingBlockList, ...blockedDirs];
} else if (existingBlockList instanceof RegExp) {
  config.resolver.blockList = [existingBlockList, ...blockedDirs];
} else {
  config.resolver.blockList = blockedDirs;
}

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolveWith = (target) =>
    defaultResolveRequest
      ? defaultResolveRequest(context, target, platform)
      : context.resolveRequest(context, target, platform);

  try {
    return resolveWith(moduleName);
  } catch (error) {
    if (
      (moduleName.startsWith("./") || moduleName.startsWith("../")) &&
      (moduleName.endsWith(".ts") || moduleName.endsWith(".tsx"))
    ) {
      const stripped = moduleName.replace(/\.tsx?$/, "");
      return resolveWith(stripped);
    }
    throw error;
  }
};

module.exports = config;
