import 'server-only'

export interface IndustryParent {
  code: string
  labelZh: string
  labelEn: string
  children: IndustryChild[]
}

export interface IndustryChild {
  code: string
  labelZh: string
  labelEn: string
}

export const INDUSTRIES: IndustryParent[] = [
  {
    code: 'finance',
    labelZh: '金融',
    labelEn: 'Finance',
    children: [
      { code: 'finance.bank', labelZh: '银行', labelEn: 'Banking' },
      { code: 'finance.insurance', labelZh: '保险', labelEn: 'Insurance' },
      { code: 'finance.fintech', labelZh: '金融科技', labelEn: 'Fintech' },
      { code: 'finance.investment', labelZh: '投资', labelEn: 'Investment' },
    ],
  },
  {
    code: 'tech',
    labelZh: '科技',
    labelEn: 'Technology',
    children: [
      { code: 'tech.software', labelZh: '软件开发', labelEn: 'Software Development' },
      { code: 'tech.it_services', labelZh: 'IT 服务', labelEn: 'IT Services' },
      { code: 'tech.hardware', labelZh: '硬件', labelEn: 'Hardware' },
      { code: 'tech.startup', labelZh: '初创', labelEn: 'Startup' },
    ],
  },
  {
    code: 'mfg',
    labelZh: '制造',
    labelEn: 'Manufacturing',
    children: [
      { code: 'mfg.automotive', labelZh: '汽车', labelEn: 'Automotive' },
      { code: 'mfg.electronics', labelZh: '电子', labelEn: 'Electronics' },
      { code: 'mfg.food', labelZh: '食品饮料', labelEn: 'Food & Beverage' },
    ],
  },
  {
    code: 'retail',
    labelZh: '零售',
    labelEn: 'Retail',
    children: [
      { code: 'retail.ecommerce', labelZh: '电商', labelEn: 'E-Commerce' },
      { code: 'retail.fmcg', labelZh: '快消品', labelEn: 'FMCG' },
      { code: 'retail.luxury', labelZh: '奢侈品', labelEn: 'Luxury' },
    ],
  },
  {
    code: 'services',
    labelZh: '专业服务',
    labelEn: 'Professional Services',
    children: [
      { code: 'services.consulting', labelZh: '咨询', labelEn: 'Consulting' },
      { code: 'services.accounting', labelZh: '会计', labelEn: 'Accounting' },
      { code: 'services.legal', labelZh: '法律', labelEn: 'Legal' },
      { code: 'services.hr', labelZh: '人力资源', labelEn: 'HR Services' },
      { code: 'services.logistics', labelZh: '物流', labelEn: 'Logistics' },
    ],
  },
  {
    code: 'education',
    labelZh: '教育',
    labelEn: 'Education',
    children: [
      { code: 'education.university', labelZh: '高校', labelEn: 'University' },
      { code: 'education.k12', labelZh: '中小学', labelEn: 'K-12 Education' },
      { code: 'education.tutoring', labelZh: '培训', labelEn: 'Training & Tutoring' },
    ],
  },
  {
    code: 'healthcare',
    labelZh: '医疗健康',
    labelEn: 'Healthcare',
    children: [
      { code: 'healthcare.hospital', labelZh: '医院', labelEn: 'Hospital' },
      { code: 'healthcare.pharma', labelZh: '制药', labelEn: 'Pharmaceutical' },
      { code: 'healthcare.biotech', labelZh: '生物技术', labelEn: 'Biotechnology' },
    ],
  },
  {
    code: 'construction',
    labelZh: '建筑地产',
    labelEn: 'Construction & Real Estate',
    children: [
      { code: 'construction.real_estate', labelZh: '房地产', labelEn: 'Real Estate' },
      { code: 'construction.infra', labelZh: '基础设施', labelEn: 'Infrastructure' },
    ],
  },
  {
    code: 'media',
    labelZh: '传媒广告',
    labelEn: 'Media & Advertising',
    children: [
      { code: 'media.advertising', labelZh: '广告', labelEn: 'Advertising' },
      { code: 'media.publishing', labelZh: '出版', labelEn: 'Publishing' },
      { code: 'media.entertainment', labelZh: '娱乐', labelEn: 'Entertainment' },
    ],
  },
  {
    code: 'hospitality',
    labelZh: '酒店餐饮旅游',
    labelEn: 'Hospitality & Tourism',
    children: [
      { code: 'hospitality.hotel', labelZh: '酒店', labelEn: 'Hotel' },
      { code: 'hospitality.restaurant', labelZh: '餐饮', labelEn: 'Restaurant' },
      { code: 'hospitality.tourism', labelZh: '旅游', labelEn: 'Tourism' },
    ],
  },
  {
    code: 'other',
    labelZh: '其他',
    labelEn: 'Other',
    children: [
      { code: 'other.other', labelZh: '其他行业', labelEn: 'Other Industry' },
    ],
  },
]

export function getAllIndustryCodes(): string[] {
  return INDUSTRIES.flatMap(p => p.children.map(c => c.code))
}

export function getIndustryLabel(code: string, locale: 'zh' | 'en'): string | null {
  for (const parent of INDUSTRIES) {
    for (const child of parent.children) {
      if (child.code === code) {
        return locale === 'zh' ? child.labelZh : child.labelEn
      }
    }
  }
  return null
}

/** True when companyCode equals filterCode or is a child (e.g. 'finance.bank' matches 'finance'). */
export function industryMatches(companyCode: string | null, filterCode: string): boolean {
  if (!companyCode) return false
  return companyCode === filterCode || companyCode.startsWith(filterCode + '.')
}
