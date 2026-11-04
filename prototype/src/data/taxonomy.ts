// 筛选用的字典：两级行业、公司定位标签、薪资档、预设地标（对应 PRD v0.2 §2.4）

export interface IndustryNode { code: string; name: string; children?: IndustryNode[] }

export const INDUSTRIES: IndustryNode[] = [
  { code: 'finance', name: '金融', children: [
    { code: 'finance.bank', name: '银行' }, { code: 'finance.insurance', name: '保险' },
    { code: 'finance.securities', name: '证券 / 投资' }, { code: 'finance.accounting', name: '会计 / 审计' },
  ] },
  { code: 'healthcare', name: '医疗健康', children: [
    { code: 'healthcare.hospital', name: '医院' }, { code: 'healthcare.research', name: '研究院' },
    { code: 'healthcare.pharma', name: '医药' }, { code: 'healthcare.vet', name: '宠物医疗' },
  ] },
  { code: 'tech', name: '互联网 / 科技', children: [
    { code: 'tech.software', name: '软件 / 人工智能' }, { code: 'tech.ecommerce', name: '电子商务' },
    { code: 'tech.hardware', name: '半导体 / 硬件' },
  ] },
  { code: 'manufacturing', name: '制造' },
  { code: 'construction', name: '建筑工程' },
  { code: 'trade', name: '贸易物流' },
  { code: 'education', name: '教育' },
  { code: 'consumer', name: '消费零售' },
  { code: 'energy', name: '能源' },
]

const NAMES = new Map<string, string>()
for (const n of INDUSTRIES) {
  NAMES.set(n.code, n.name)
  for (const c of n.children ?? []) NAMES.set(c.code, c.name)
}

/** 'finance.bank' → '银行'；未知 code 原样返回 */
export function industryName(code: string): string {
  return NAMES.get(code) ?? code
}

/** 筛选大类时命中它的所有子类 */
export function industryMatches(companyCode: string, filterCode: string): boolean {
  return companyCode === filterCode || companyCode.startsWith(filterCode + '.')
}

// 公司定位标签只由运营核实后设置（DECISIONS Q8），企业不能自己标"世界 500 强"
export type CompanyTag = 'FORTUNE_500' | 'MULTINATIONAL' | 'MY_LEADING' | 'CN_OVERSEAS' | 'SOE' | 'ALUMNI' | 'CHINESE_MY'
export const COMPANY_TAG_LABEL: Record<CompanyTag, string> = {
  FORTUNE_500: '世界500强', MULTINATIONAL: '跨国公司', MY_LEADING: '马来西亚龙头', CN_OVERSEAS: '中资海外分支',
  SOE: '国企', ALUMNI: '校友企业', CHINESE_MY: '华资',
}

export const DEFAULT_SALARY_BANDS = [2000, 3000, 5000, 8000]

export interface Landmark { id: string; name: string; kind: 'MRT' | 'MALL' | 'CAMPUS' | 'CBD'; lat: number; lng: number }

// 近似坐标，只用于原型演示半径筛选
export const LANDMARKS: Landmark[] = [
  { id: 'klcc', name: 'KLCC 双子塔', kind: 'CBD', lat: 3.158, lng: 101.712 },
  { id: 'bukit-bintang', name: '武吉免登', kind: 'MALL', lat: 3.147, lng: 101.711 },
  { id: 'trx', name: '敦拉萨国际贸易中心（TRX）', kind: 'MRT', lat: 3.142, lng: 101.719 },
  { id: 'mid-valley', name: 'Mid Valley', kind: 'MALL', lat: 3.118, lng: 101.677 },
  { id: 'bangsar-south', name: 'Bangsar South', kind: 'CBD', lat: 3.111, lng: 101.666 },
  { id: 'shah-alam', name: '莎阿南', kind: 'CBD', lat: 3.073, lng: 101.518 },
  { id: 'cyberjaya', name: '赛城', kind: 'CBD', lat: 2.921, lng: 101.656 },
  { id: 'xmum', name: '厦大马来西亚分校', kind: 'CAMPUS', lat: 2.833, lng: 101.707 },
  { id: 'george-town', name: '槟城乔治市', kind: 'CBD', lat: 5.414, lng: 100.329 },
  { id: 'jb-sentral', name: '新山 JB Sentral', kind: 'MRT', lat: 1.463, lng: 103.765 },
  { id: 'ipoh', name: '怡保', kind: 'CBD', lat: 4.597, lng: 101.090 },
]
