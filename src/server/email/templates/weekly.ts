import 'server-only'
import { env } from '@/env'

export type WeeklyJobRow = { id: string; title: string; companyName: string; type: string; workMode: string; state: string | null; city: string | null }
export type WeeklyTalentRow = { id: string; headline: string | null; major: string | null; degreeLevel: string | null; skills: string[] }
export type WeeklyTemplateVars =
  | { template: 'weekly-jobs'; locale: string; rows: WeeklyJobRow[]; unsubscribeToken: string }
  | { template: 'weekly-talents'; locale: string; rows: WeeklyTalentRow[]; unsubscribeToken: string }
const esc = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export function renderWeeklyTemplate(vars: WeeklyTemplateVars): { subject: string; html: string; text: string } {
  const locale = vars.locale === 'en' ? 'en' : 'zh', english = locale === 'en'
  const origin = new URL(env.APP_URL).origin
  const unsubscribe = new URL('/api/marketing/unsubscribe', origin)
  unsubscribe.searchParams.set('token', vars.unsubscribeToken)
  const label = english ? 'Unsubscribe from weekly recommendations' : '退订每周推荐邮件'
  const title = vars.template === 'weekly-jobs'
    ? english ? 'Your weekly job recommendations' : '本周职位推荐'
    : english ? 'Your weekly talent recommendations' : '本周人才推荐'
  const lines = vars.template === 'weekly-jobs'
    ? vars.rows.map(row => ({ text: [row.title, row.companyName, row.type, row.workMode, row.state, row.city].filter(Boolean).join(' · '),
      url: new URL(`/${locale}/jobs/${encodeURIComponent(row.id)}`, origin).href }))
    : vars.rows.map(row => ({ text: [row.headline ?? (english ? 'Anonymous candidate' : '匿名候选人'), row.major, row.degreeLevel, row.skills.join(', ')].filter(Boolean).join(' · '),
      url: new URL(`/${locale}/e/talent/${encodeURIComponent(row.id)}`, origin).href }))
  const notice = english ? 'Sign in to review current details. Availability and permissions may have changed.' : '请登录查看当前详情；职位状态及访问权限可能已变化。'
  return {
    subject: 'FindMYJob — ' + title,
    html: `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${esc(title)}</h1><ul>${lines.map(line => `<li><a href="${esc(line.url)}">${esc(line.text)}</a></li>`).join('')}</ul><p>${esc(notice)}</p><p><a href="${esc(unsubscribe.href)}">${esc(label)}</a></p></body></html>`,
    text: `${title}\n\n${lines.map(line => `${line.text}\n${line.url}`).join('\n\n')}\n\n${notice}\n${label}: ${unsubscribe.href}`,
  }
}
