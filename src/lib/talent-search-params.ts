export interface FilterState {
  keyword: string
  sort: string
  schoolId: string
  degreeLevel: string
  gradFrom: string
  gradTo: string
  intent: string[]
  workAuth: string[]
}

export function buildSearchString(filters: FilterState, page = 1): string {
  const p = new URLSearchParams()
  if (filters.keyword) p.set('keyword', filters.keyword)
  if (filters.sort && filters.sort !== 'lastActive') p.set('sort', filters.sort)
  if (filters.schoolId) p.set('schoolId', filters.schoolId)
  if (filters.degreeLevel) p.set('degreeLevel', filters.degreeLevel)
  if (filters.gradFrom) p.set('gradFrom', filters.gradFrom)
  if (filters.gradTo) p.set('gradTo', filters.gradTo)
  filters.intent.forEach((v) => p.append('intent', v))
  filters.workAuth.forEach((v) => p.append('workAuth', v))
  if (page > 1) p.set('page', String(page))
  const str = p.toString()
  return str ? `?${str}` : ''
}
