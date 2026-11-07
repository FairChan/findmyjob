export const MY_STATES = [
  { code: 'JHR', labelZh: '柔佛', labelEn: 'Johor' },
  { code: 'KDH', labelZh: '吉打', labelEn: 'Kedah' },
  { code: 'KTN', labelZh: '吉兰丹', labelEn: 'Kelantan' },
  { code: 'KUL', labelZh: '吉隆坡', labelEn: 'Kuala Lumpur' },
  { code: 'LBN', labelZh: '纳闽', labelEn: 'Labuan' },
  { code: 'MLK', labelZh: '马六甲', labelEn: 'Melaka' },
  { code: 'NSN', labelZh: '森美兰', labelEn: 'Negeri Sembilan' },
  { code: 'PHG', labelZh: '彭亨', labelEn: 'Pahang' },
  { code: 'PJY', labelZh: '布城', labelEn: 'Putrajaya' },
  { code: 'PLS', labelZh: '玻璃市', labelEn: 'Perlis' },
  { code: 'PNG', labelZh: '槟城', labelEn: 'Penang' },
  { code: 'PRK', labelZh: '霹雳', labelEn: 'Perak' },
  { code: 'SBH', labelZh: '沙巴', labelEn: 'Sabah' },
  { code: 'SGR', labelZh: '雪兰莪', labelEn: 'Selangor' },
  { code: 'SWK', labelZh: '砂拉越', labelEn: 'Sarawak' },
  { code: 'TRG', labelZh: '登嘉楼', labelEn: 'Terengganu' },
]

export function stateLabel(code: string | null | undefined, locale: string): string | null {
  if (!code) return null
  const s = MY_STATES.find(item => item.code === code)
  if (!s) return code
  return locale === 'zh' ? s.labelZh : s.labelEn
}
