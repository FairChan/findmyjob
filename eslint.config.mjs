// eslint-config-next exports a native flat config array in Next.js 16
import nextConfig from 'eslint-config-next'

// Selectors that ban unsafe Prisma raw SQL helpers (apply everywhere)
const RAW_UNSAFE_SELECTORS = [
  {
    selector: 'CallExpression[callee.property.name="$queryRawUnsafe"]',
    message: 'Use $queryRaw with Prisma.sql template literal instead of $queryRawUnsafe.',
  },
  {
    selector: 'CallExpression[callee.property.name="$executeRawUnsafe"]',
    message: 'Use $executeRaw with Prisma.sql template literal instead of $executeRawUnsafe.',
  },
]

// Selectors that restrict direct access to PII/ledger Prisma models and crypto helpers
const PII_MODEL_SELECTORS = [
  {
    selector: 'MemberExpression[property.name="studentContact"]',
    message:
      'studentContact must only be accessed via src/server/services/contact-access.ts',
  },
  {
    selector: 'MemberExpression[property.name="creditLedger"]',
    message:
      'creditLedger must only be accessed via src/server/services/credits.ts',
  },
  {
    selector: 'MemberExpression[property.name="creditWallet"]',
    message:
      'creditWallet must only be accessed via src/server/services/credits.ts',
  },
  {
    selector: 'CallExpression[callee.name="decryptField"]',
    message:
      'decryptField must only be called from src/server/services/contact-access.ts',
  },
]

// Custom rule: 'use server' files must only export action(...) calls
const useServerExportsRule = {
  meta: { type: 'suggestion', schema: [] },
  create(context) {
    return {
      Program(node) {
        // Detect 'use server' directive (can appear as directive or plain expression)
        const hasUseServer = node.body.some(
          (stmt) =>
            stmt.type === 'ExpressionStatement' &&
            (stmt.directive === 'use server' ||
              (stmt.expression.type === 'Literal' &&
                stmt.expression.value === 'use server')),
        )
        if (!hasUseServer) return

        for (const stmt of node.body) {
          if (stmt.type !== 'ExportNamedDeclaration') continue
          if (stmt.exportKind === 'type') continue // type-only exports are fine
          if (!stmt.declaration) continue // re-exports (export { x } from '...') are fine

          const decl = stmt.declaration

          if (decl.type === 'VariableDeclaration') {
            for (const declarator of decl.declarations) {
              const init = declarator.init
              const isActionCall =
                init?.type === 'CallExpression' &&
                init.callee.type === 'Identifier' &&
                init.callee.name === 'action'

              if (!isActionCall) {
                context.report({
                  node: declarator,
                  message:
                    "'use server' files must only export action(...) calls; wrap this export with action()",
                })
              }
            }
          } else {
            // FunctionDeclaration, ClassDeclaration, etc.
            context.report({
              node: decl,
              message:
                "'use server' files must only export action(...) calls; wrap this export with action()",
            })
          }
        }
      },
    }
  },
}

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

  // Global: ban unsafe raw SQL helpers and direct PII/ledger model access
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        ...RAW_UNSAFE_SELECTORS,
        ...PII_MODEL_SELECTORS,
      ],
    },
  },

  // Override: allow PII model access in the files that own those boundaries
  {
    files: [
      'src/server/services/contact-access.ts',
      'src/server/services/credits.ts',
      'prisma/seed.ts',
      'prisma/seed-load.ts',
      'tests/**/*.ts',
      'tests/**/*.spec.ts',
      // restore-drill verification reads encrypted fields directly
      'scripts/db/verify-decrypt.ts',
    ],
    rules: {
      // Keep unsafe SQL ban, but lift PII model restrictions
      'no-restricted-syntax': ['error', ...RAW_UNSAFE_SELECTORS],
    },
  },

  // no-console is an error inside server-side code
  {
    files: ['src/server/**/*.ts', 'src/worker.ts', 'src/app/api/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },

  // 'use server' files must only export action(...) calls
  {
    plugins: {
      local: {
        rules: {
          'use-server-exports': useServerExportsRule,
        },
      },
    },
    rules: {
      'local/use-server-exports': 'error',
    },
  },
]

export default eslintConfig
