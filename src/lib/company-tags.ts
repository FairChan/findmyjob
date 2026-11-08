export const COMPANY_TAGS = [
  'FORTUNE_500',
  'MULTINATIONAL',
  'MY_LEADING',
  'CN_OVERSEAS',
  'SOE',
  'ALUMNI',
  'CHINESE_MY',
] as const

export type CompanyTagValue = (typeof COMPANY_TAGS)[number]
