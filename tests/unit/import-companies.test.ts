/**
 * Unit tests for import-companies.ts validation and deduplication logic (M6-T07).
 * Tests dry-run-equivalent behaviour: validateCompanies and deduplicateRows.
 */
import { describe, it, expect } from 'vitest'
import { validateCompanies, deduplicateRows } from '../../scripts/import-companies'

describe('validateCompanies', () => {
  it('valid row passes', () => {
    const { valid, errorLines } = validateCompanies([
      { legalName: 'Acme Sdn. Bhd.', ssmRegNo: '1234567-A' },
    ])
    expect(valid).toHaveLength(1)
    expect(errorLines).toHaveLength(0)
    expect(valid[0].originalLine).toBe(1)
  })

  it('row missing legalName fails', () => {
    const { valid, errorLines } = validateCompanies([{ ssmRegNo: '999' }])
    expect(valid).toHaveLength(0)
    expect(errorLines).toEqual([1])
  })

  it('valid row without SSM passes', () => {
    const { valid, errorLines } = validateCompanies([{ legalName: 'No SSM Corp' }])
    expect(valid).toHaveLength(1)
    expect(errorLines).toHaveLength(0)
  })

  it('mixed valid and invalid rows', () => {
    const { valid, errorLines } = validateCompanies([
      { legalName: 'Good Corp', ssmRegNo: '100' },
      { notACompany: true },
      { legalName: 'Also Good' },
    ])
    expect(valid).toHaveLength(2)
    expect(errorLines).toEqual([2])
    expect(valid[0].originalLine).toBe(1)
    expect(valid[1].originalLine).toBe(3)
  })

  it('legalName too short fails', () => {
    const { errorLines } = validateCompanies([{ legalName: 'A' }])
    expect(errorLines).toEqual([1])
  })

  it('invalid size enum fails', () => {
    const { errorLines } = validateCompanies([{ legalName: 'Corp', size: 'HUGE' }])
    expect(errorLines).toEqual([1])
  })

  it('empty array returns empty valid', () => {
    const { valid, errorLines } = validateCompanies([])
    expect(valid).toHaveLength(0)
    expect(errorLines).toHaveLength(0)
  })
})

describe('deduplicateRows', () => {
  it('no duplicates — all rows pass through', () => {
    const rows = [
      { input: { legalName: 'Alpha', ssmRegNo: 'A1' }, originalLine: 1 },
      { input: { legalName: 'Beta', ssmRegNo: 'B2' }, originalLine: 2 },
    ] as Parameters<typeof deduplicateRows>[0]
    const { deduped, skippedLines } = deduplicateRows(rows)
    expect(deduped).toHaveLength(2)
    expect(skippedLines).toHaveLength(0)
  })

  it('duplicate SSM numbers: second is skipped', () => {
    const rows = [
      { input: { legalName: 'Alpha', ssmRegNo: 'DUP-123' }, originalLine: 1 },
      { input: { legalName: 'Beta', ssmRegNo: 'DUP-123' }, originalLine: 2 },
    ] as Parameters<typeof deduplicateRows>[0]
    const { deduped, skippedLines } = deduplicateRows(rows)
    expect(deduped).toHaveLength(1)
    expect(deduped[0].originalLine).toBe(1)
    expect(skippedLines).toEqual([2])
  })

  it('SSM comparison is case-insensitive', () => {
    const rows = [
      { input: { legalName: 'Alpha', ssmRegNo: 'abc-123' }, originalLine: 1 },
      { input: { legalName: 'Beta', ssmRegNo: 'ABC-123' }, originalLine: 2 },
    ] as Parameters<typeof deduplicateRows>[0]
    const { deduped, skippedLines } = deduplicateRows(rows)
    expect(deduped).toHaveLength(1)
    expect(skippedLines).toEqual([2])
  })

  it('rows without SSM deduplicated by legalName (case-insensitive)', () => {
    const rows = [
      { input: { legalName: 'No SSM Corp' }, originalLine: 1 },
      { input: { legalName: 'no ssm corp' }, originalLine: 2 },
      { input: { legalName: 'Different Corp' }, originalLine: 3 },
    ] as Parameters<typeof deduplicateRows>[0]
    const { deduped, skippedLines } = deduplicateRows(rows)
    expect(deduped).toHaveLength(2)
    expect(skippedLines).toEqual([2])
  })

  it('row with SSM and row without SSM sharing same legalName are both kept', () => {
    const rows = [
      { input: { legalName: 'Same Name', ssmRegNo: 'X99' }, originalLine: 1 },
      { input: { legalName: 'Same Name' }, originalLine: 2 },
    ] as Parameters<typeof deduplicateRows>[0]
    // SSM rows and no-SSM rows use separate key spaces
    const { deduped, skippedLines } = deduplicateRows(rows)
    expect(deduped).toHaveLength(2)
    expect(skippedLines).toHaveLength(0)
  })
})
