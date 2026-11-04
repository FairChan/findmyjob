// eslint-config-next exports a native flat config array in Next.js 16
import nextConfig from 'eslint-config-next'

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  ...nextConfig,
  {
    ignores: [
      'prototype/**',
      '.next/**',
      'out/**',
      'node_modules/**',
      'coverage/**',
    ],
  },
]

export default eslintConfig
