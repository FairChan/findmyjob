// 显式的项目级 babel 配置：Jest 转译 ../src/shared 里的 TypeScript 时也要用到它。
module.exports = function (api) {
  api.cache(true)
  return { presets: ['babel-preset-expo'] }
}
