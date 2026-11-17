// Metro 配置：除了 mobile/ 本身，还要能打包仓库根目录下和 Web 共用的两处代码：
// src/shared（API 约定、错误码）和 messages（中英文案）。
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const repoRoot = path.resolve(projectRoot, '..')
const SHARED_DIRS = [path.join(repoRoot, 'src', 'shared'), path.join(repoRoot, 'messages')]

const config = getDefaultConfig(projectRoot)

config.watchFolders = [...(config.watchFolders ?? []), ...SHARED_DIRS]
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
}

// 共用代码里的第三方依赖（如 zod）一律从 mobile/node_modules 解析：
// EAS 云构建只装 mobile 的依赖，根目录的 node_modules 不存在。
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const fromShared = SHARED_DIRS.some((dir) => context.originModulePath.startsWith(dir))
  const isPackage = !moduleName.startsWith('.') && !path.isAbsolute(moduleName)
  if (fromShared && isPackage) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, 'package.json') },
      moduleName,
      platform,
    )
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
