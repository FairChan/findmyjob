const path = require('path')

module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  // 与 tsconfig paths、metro.config.js 保持一致
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@shared/(.*)$': '<rootDir>/../src/shared/$1',
    '^@messages/(.*)$': '<rootDir>/../messages/$1',
    '^zod$': '<rootDir>/node_modules/zod',
  },
  // jest-expo 默认只转译 RN/Expo 包；use-intl 及其依赖只发 ESM，也要转译
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|expo-router|react-navigation|@react-navigation/.*|use-intl|intl-messageformat|@formatjs/.*|icu-minify|@schummar/.*)',
  ],
  rootDir: __dirname,
  roots: ['<rootDir>', path.join(__dirname, '..', 'src', 'shared')],
}
