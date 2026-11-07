/**
 * Architecture test: server action / route boundary enforcement (M1-T07).
 *
 * Every export in a 'use server' file must be the return value of action(...).
 * Every HTTP method export in a route.ts (excluding the Better Auth catch-all) must be
 * the return value of route(...).
 *
 * This test fails when a non-wrapped export is added to either file type,
 * complementing the ESLint rule with a compile-time AST check using the
 * TypeScript compiler API.
 */
import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import path from 'path'
import fs from 'fs'

const ROOT = path.resolve(__dirname, '../..')
const SRC = path.join(ROOT, 'src')

// Files exempted from the route() wrapping requirement (each has a source comment explaining why).
// Stored with forward slashes so the comparison works on both Windows and POSIX.
const ROUTE_EXEMPTIONS = new Set([
  path.join(SRC, 'app', 'api', 'auth', '[...all]', 'route.ts').replace(/\\/g, '/'),
])

// HTTP method names exported by Next.js route handlers
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])

function walkDir(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue
      results.push(...walkDir(fullPath))
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      results.push(fullPath)
    }
  }
  return results
}

function parseFile(filePath: string): ts.SourceFile {
  const content = fs.readFileSync(filePath, 'utf-8')
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)
}

function hasUseServerDirective(sf: ts.SourceFile): boolean {
  // 'use server' must be the very first statement
  const first = sf.statements[0]
  if (!first) return false
  if (ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)) {
    return first.expression.text === 'use server'
  }
  return false
}

function isWrappedWith(init: ts.Expression | undefined, fnName: string): boolean {
  if (!init) return false
  // Direct call: action(...) or route(...)
  if (ts.isCallExpression(init)) {
    const callee = init.expression
    if (ts.isIdentifier(callee) && callee.text === fnName) return true
  }
  // Awaited call: await action(...) — unusual but guard it
  if (ts.isAwaitExpression(init)) {
    return isWrappedWith(init.expression, fnName)
  }
  return false
}

interface Violation {
  file: string
  export: string
  reason: string
}

function checkUseServerFile(sf: ts.SourceFile): Violation[] {
  const violations: Violation[] = []
  const relPath = path.relative(ROOT, sf.fileName).replace(/\\/g, '/')

  for (const stmt of sf.statements) {
    // Only check variable statements (export const X = ...)
    if (!ts.isVariableStatement(stmt)) {
      // FunctionDeclarations etc. with export are also violations
      if (ts.isFunctionDeclaration(stmt)) {
        const isExported = stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
        if (!isExported) continue
        const name = stmt.name?.text ?? '(anonymous)'
        violations.push({
          file: relPath,
          export: name,
          reason: `exported function "${name}" in 'use server' file must be wrapped with action()`,
        })
      }
      continue
    }

    const isExported = stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!isExported) continue

    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue
      const name = decl.name.text
      if (!isWrappedWith(decl.initializer, 'action')) {
        violations.push({
          file: relPath,
          export: name,
          reason: `exported const "${name}" is not wrapped with action()`,
        })
      }
    }
  }
  return violations
}

function checkRouteFile(sf: ts.SourceFile): Violation[] {
  const normalizedName = sf.fileName.replace(/\\/g, '/')
  if (ROUTE_EXEMPTIONS.has(normalizedName)) return []

  const violations: Violation[] = []
  const relPath = path.relative(ROOT, sf.fileName).replace(/\\/g, '/')

  for (const stmt of sf.statements) {
    // export async function GET(...) { ... }
    if (ts.isFunctionDeclaration(stmt)) {
      const isExported = stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
      if (!isExported) continue
      const name = stmt.name?.text
      if (name && HTTP_METHODS.has(name)) {
        violations.push({
          file: relPath,
          export: name,
          reason: `exported function "${name}" in route.ts is not wrapped with route()`,
        })
      }
      continue
    }

    // export const GET = route(...)
    if (!ts.isVariableStatement(stmt)) continue
    const isExported = stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!isExported) continue

    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue
      const name = decl.name.text
      if (!HTTP_METHODS.has(name)) continue
      if (!isWrappedWith(decl.initializer, 'route')) {
        violations.push({
          file: relPath,
          export: name,
          reason: `exported const "${name}" in route.ts is not wrapped with route()`,
        })
      }
    }
  }
  return violations
}

describe('server boundary enforcement', () => {
  it('all exports in "use server" files must be wrapped with action()', () => {
    const files = walkDir(SRC)
    const violations: Violation[] = []

    for (const file of files) {
      const sf = parseFile(file)
      if (!hasUseServerDirective(sf)) continue
      violations.push(...checkUseServerFile(sf))
    }

    if (violations.length > 0) {
      const msg = violations
        .map(v => `  ${v.file}: ${v.reason}`)
        .join('\n')
      expect.fail(`Unwrapped exports found in 'use server' files:\n${msg}`)
    }

    expect(violations).toHaveLength(0)
  })

  it('all HTTP method exports in route.ts files must be wrapped with route()', () => {
    const files = walkDir(path.join(SRC, 'app'))
    const violations: Violation[] = []

    for (const file of files) {
      if (!file.endsWith('route.ts')) continue
      const sf = parseFile(file)
      violations.push(...checkRouteFile(sf))
    }

    if (violations.length > 0) {
      const msg = violations
        .map(v => `  ${v.file}: ${v.reason}`)
        .join('\n')
      expect.fail(`Unwrapped HTTP method exports found in route.ts files:\n${msg}`)
    }

    expect(violations).toHaveLength(0)
  })
})
