// App 不能 import Web 的 src/lib（那里不在 @shared 边界内），所以把两张小字典抄过来；
// __tests__/reference-data.test.ts 直接读 Web 源文件对照，防止两边漂移。
import type { AppLocale } from '@/i18n/messages'

/** 职位筛选和发布用的州属代码（对应 Web src/lib/my-states.ts） */
export const MY_STATES = [
  { code: 'JHR', zh: '柔佛', en: 'Johor' },
  { code: 'KDH', zh: '吉打', en: 'Kedah' },
  { code: 'KTN', zh: '吉兰丹', en: 'Kelantan' },
  { code: 'KUL', zh: '吉隆坡', en: 'Kuala Lumpur' },
  { code: 'LBN', zh: '纳闽', en: 'Labuan' },
  { code: 'MLK', zh: '马六甲', en: 'Melaka' },
  { code: 'NSN', zh: '森美兰', en: 'Negeri Sembilan' },
  { code: 'PHG', zh: '彭亨', en: 'Pahang' },
  { code: 'PJY', zh: '布城', en: 'Putrajaya' },
  { code: 'PLS', zh: '玻璃市', en: 'Perlis' },
  { code: 'PNG', zh: '槟城', en: 'Penang' },
  { code: 'PRK', zh: '霹雳', en: 'Perak' },
  { code: 'SBH', zh: '沙巴', en: 'Sabah' },
  { code: 'SGR', zh: '雪兰莪', en: 'Selangor' },
  { code: 'SWK', zh: '砂拉越', en: 'Sarawak' },
  { code: 'TRG', zh: '登嘉楼', en: 'Terengganu' },
] as const

/** 建档"意向行业"的选项（对应 Web src/lib/malaysia.ts 的 COMMON_INDUSTRIES） */
export const COMMON_INDUSTRIES = [
  { code: 'tech.software', zh: '软件/互联网', en: 'Software / Internet' },
  { code: 'tech.hardware', zh: '硬件/电子', en: 'Hardware / Electronics' },
  { code: 'finance.bank', zh: '银行/金融', en: 'Banking / Finance' },
  { code: 'finance.insurance', zh: '保险', en: 'Insurance' },
  { code: 'consulting', zh: '咨询', en: 'Consulting' },
  { code: 'manufacturing', zh: '制造业', en: 'Manufacturing' },
  { code: 'retail', zh: '零售/电商', en: 'Retail / E-commerce' },
  { code: 'media', zh: '媒体/广告', en: 'Media / Advertising' },
  { code: 'education', zh: '教育', en: 'Education' },
  { code: 'healthcare', zh: '医疗健康', en: 'Healthcare' },
  { code: 'hospitality', zh: '酒店/餐饮', en: 'Hospitality / F&B' },
  { code: 'logistics', zh: '物流/供应链', en: 'Logistics / Supply Chain' },
  { code: 'property', zh: '房地产', en: 'Real Estate' },
  { code: 'government', zh: '政府/公共机构', en: 'Government / Public Sector' },
  { code: 'ngo', zh: '非营利组织', en: 'NGO / Non-profit' },
  { code: 'other', zh: '其他', en: 'Other' },
] as const

export function stateLabel(code: string | null | undefined, locale: string): string | null {
  if (!code) return null
  const s = MY_STATES.find((item) => item.code === code)
  if (!s) return code
  return locale === 'zh' ? s.zh : s.en
}

export function localized(item: { zh: string; en: string }, locale: AppLocale | string): string {
  return locale === 'en' ? item.en : item.zh
}
