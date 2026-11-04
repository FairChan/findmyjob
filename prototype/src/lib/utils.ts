export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export const uid = () => Math.random().toString(36).slice(2, 10)

export const now = () => new Date().toISOString()

const k = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${n}`)
export const formatSalary = (min: number, max: number) => `RM ${k(min)}-${k(max)}`
/** 学生和访客看到的薪资：企业选择隐藏时显示"薪资面议" */
export const salaryText = (j: { salaryMin: number; salaryMax: number; salaryHidden?: boolean }) =>
  j.salaryHidden ? '薪资面议' : `${formatSalary(j.salaryMin, j.salaryMax)} / 月`

const pad = (n: number) => String(n).padStart(2, '0')
export const formatDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const formatDateTime = (iso: string) => {
  const d = new Date(iso)
  return `${formatDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  const d = Math.floor(s / 86400)
  return d < 30 ? `${d} 天前` : formatDate(iso)
}

export const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

const PALETTE = ['#426EFF', '#7048E8', '#0CA678', '#E8590C', '#1098AD', '#C2255C', '#F59F00', '#37B24D']
export const colorFor = (seed: string) => {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
