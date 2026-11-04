import { useState, type DragEvent, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom'
import {
  BadgeCheck, Briefcase, Coins, CreditCard, FileText, Gift, Inbox, Landmark, LayoutDashboard,
  Mail, Phone, Plus, Receipt, Search, Star, Users, Wallet,
} from 'lucide-react'
import {
  APP_STATUS_LABEL, CATEGORIES, DEGREE_LABEL, JOB_STATUS_LABEL, JOB_TYPE_LABEL, LANGS, STATES, companyById, schoolById,
  type AppStatus, type Degree, type JobStatus, type JobType,
} from '../../data/mock'
import {
  HR_NAME, MY_COMPANY_ID, companyApplications, companyJobs, getStudent, hasAccess, invitesThisMonth, talentPool, useStore,
  type Application,
} from '../../store'
import { cn, formatDate, formatDateTime, formatSalary, timeAgo } from '../../lib/utils'
import { toStandardRow } from '../../lib/standard-resume'
import {
  Avatar, Button, Card, Chip, CompanyLogo, Empty, Field, Input, LogoMark, Modal, Select, Stat, Tag, TagInput, Textarea, buttonClass,
} from '../../components/ui'
import { NotificationBell } from '../../components/shell'
import { TalentCard, useInviteFlow } from '../../components/talent'
import { useToast } from '../../components/toast'

const NAV = [
  { to: '/e', label: '工作台', icon: LayoutDashboard, end: true },
  { to: '/e/talent', label: '人才库', icon: Search },
  { to: '/e/jobs', label: '职位管理', icon: Briefcase },
  { to: '/e/applicants', label: '收到的简历', icon: Inbox },
  { to: '/e/favorites', label: '收藏夹', icon: Star },
  { to: '/e/billing', label: '点数与账单', icon: Wallet },
]

export function EmployerLayout() {
  const { state } = useStore()
  const c = companyById(MY_COMPANY_ID)
  const newApps = companyApplications(state).filter((a) => a.status === 'APPLIED').length
  const link = ({ isActive }: { isActive: boolean }) =>
    cn('flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm', isActive ? 'bg-brand-50 font-medium text-brand-600' : 'text-gray-600 hover:bg-gray-50')
  const items = NAV.map(({ to, label, icon: Icon, end }) => (
    <NavLink key={to} to={to} end={end} className={link}>
      <Icon className="size-4" />{label}
      {to === '/e/applicants' && newApps > 0 && <span className="rounded-full bg-red-500 px-1.5 text-xs text-white">{newApps}</span>}
    </NavLink>
  ))
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="wrap flex h-14 items-center gap-6">
          <Link to="/e" className="flex shrink-0 items-center gap-2">
            <LogoMark size={28} />
            <span className="font-semibold">FindMYJob</span>
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-600">企业版</span>
          </Link>
          <nav className="hidden items-center gap-1 lg:flex">{items}</nav>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Link to="/e/billing" className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700 hover:bg-amber-100"><Coins className="size-4" />{state.credits} 点</Link>
            <NotificationBell to="employer" />
            <div className="hidden items-center gap-2 sm:flex">
              <CompanyLogo company={c} size={32} />
              <div className="text-sm leading-tight">
                <p className="font-medium">{c.short}</p>
                <p className="flex items-center gap-0.5 text-xs text-emerald-600"><BadgeCheck className="size-3" />已认证 · {HR_NAME}</p>
              </div>
            </div>
            <Link to="/" className="hidden text-sm text-gray-400 hover:text-brand-500 xl:inline">求职首页</Link>
          </div>
        </div>
        <nav className="wrap flex gap-1 overflow-x-auto pb-2 lg:hidden">{items}</nav>
      </header>
      {!state.settings.billingEnabled && (
        <div className="bg-gradient-to-r from-brand-500 to-indigo-500 text-sm text-white">
          <div className="wrap flex items-center gap-2 py-2">
            <Gift className="size-4 shrink-0" />
            <span>公益试点期：认证企业每月 1 日自动补足到 {state.settings.pilotMonthlyCredits} 点；学生主动投递的简历免费查看联系方式。</span>
          </div>
        </div>
      )}
      <main className="wrap py-6"><Outlet /></main>
    </div>
  )
}

export function Dashboard() {
  const { state } = useStore()
  const nav = useNavigate()
  const { open: invite, modal } = useInviteFlow()
  const jobs = companyJobs(state)
  const apps = companyApplications(state)
  const month = new Date().getMonth()
  const unlockedThisMonth = state.ledger.filter((l) => l.reason === 'UNLOCK' && new Date(l.at).getMonth() === month).length
  const wanted = new Set(jobs.flatMap((j) => j.skills.map((s) => s.toLowerCase())))
  const recommended = talentPool(state)
    .filter((s) => !hasAccess(state, s.id) && s.skills.some((k) => wanted.has(k.toLowerCase())))
    .slice(0, 3)
  const hour = new Date().getHours()
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好'}，{HR_NAME}</h1>
          <p className="mt-1 text-sm text-gray-500">今天有 {apps.filter((a) => a.status === 'APPLIED').length} 份新简历待处理</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => nav('/e/jobs/new')}><Plus className="size-4" />发布职位</Button>
          <Button onClick={() => nav('/e/talent')}><Search className="size-4" />搜索人才</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="在招职位" value={jobs.filter((j) => j.status === 'PUBLISHED').length} icon={<Briefcase className="size-5" />} sub={`审核中 ${jobs.filter((j) => j.status === 'PENDING_REVIEW').length} 个`} />
        <Stat label="待处理简历" value={apps.filter((a) => a.status === 'APPLIED').length} icon={<Inbox className="size-5" />} sub={`累计收到 ${apps.length} 份`} />
        <Stat label="本月解锁" value={unlockedThisMonth} icon={<Users className="size-5" />} sub={`邀请 ${invitesThisMonth(state)} / ${state.settings.invitationQuota} 次`} />
        <Stat label="剩余点数" value={state.credits} icon={<Coins className="size-5" />} sub={state.settings.billingEnabled ? '可购买点数包' : '下月 1 日自动补足'} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="font-semibold">最新投递</h2>
              <Link to="/e/applicants" className="text-sm text-brand-500 hover:underline">全部 →</Link>
            </div>
            <div className="divide-y divide-gray-50">
              {apps.slice(0, 5).map((a) => {
                const s = getStudent(state, a.studentId)!
                const job = state.jobs.find((j) => j.id === a.jobId)!
                return (
                  <Link key={a.id} to={`/e/applicants?job=${job.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50">
                    <Avatar name={s.fullName} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{s.fullName}<span className="ml-2 font-normal text-gray-400">{schoolById(s.schoolId)?.short} · {s.major}</span></p>
                      <p className="truncate text-xs text-gray-500">投递「{job.title}」· {timeAgo(a.createdAt)}</p>
                    </div>
                    <Tag tone={a.status === 'APPLIED' ? 'orange' : 'blue'}>{APP_STATUS_LABEL[a.status]}</Tag>
                  </Link>
                )
              })}
              {apps.length === 0 && <Empty title="还没有收到投递" />}
            </div>
          </Card>
          <div>
            <h2 className="mb-3 font-semibold">根据你的职位推荐的人才</h2>
            <div className="space-y-3">{recommended.map((s) => <TalentCard key={s.id} student={s} onInvite={invite} />)}</div>
          </div>
        </div>
        <aside className="space-y-4">
          <Card className="p-5">
            <h3 className="flex items-center gap-1.5 font-semibold"><BadgeCheck className="size-5 text-emerald-500" />企业认证：已通过</h3>
            <p className="mt-2 text-sm text-gray-500">{companyById(MY_COMPANY_ID).name}</p>
            <p className="mt-1 font-mono text-xs text-gray-400">SSM {companyById(MY_COMPANY_ID).ssm}</p>
            <div className="mt-3 flex gap-1.5"><Tag tone="blue">校友企业</Tag><Tag tone="amber">创始合作伙伴</Tag></div>
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold">怎么用最划算</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm text-gray-600">
              <li>先发职位，等学生主动投递（免费看联系方式）</li>
              <li>在人才库筛人，先发「邀请投递」（不扣点）</li>
              <li>急招的人选，再用点数直接解锁</li>
            </ol>
          </Card>
        </aside>
      </div>
      {modal}
    </div>
  )
}

const STATUS_TONE: Record<JobStatus, 'green' | 'orange' | 'gray' | 'red'> = { PUBLISHED: 'green', PENDING_REVIEW: 'orange', DRAFT: 'gray', CLOSED: 'gray', REJECTED: 'red' }

export function EmployerJobs() {
  const { state, actions } = useStore()
  const toast = useToast()
  const [tab, setTab] = useState<JobStatus | 'ALL'>('ALL')
  const jobs = companyJobs(state).filter((j) => tab === 'ALL' || j.status === tab)
  const apps = companyApplications(state)
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">职位管理</h1>
        <Link to="/e/jobs/new" className={buttonClass('primary')}><Plus className="size-4" />发布新职位</Link>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {(['ALL', 'PUBLISHED', 'PENDING_REVIEW', 'CLOSED'] as const).map((t) => (
          <Chip key={t} active={tab === t} onClick={() => setTab(t)}>{t === 'ALL' ? '全部' : JOB_STATUS_LABEL[t]}</Chip>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/60 text-left text-gray-500">
            <tr><th className="px-5 py-3 font-medium">职位</th><th className="px-3 py-3 font-medium">状态</th><th className="px-3 py-3 font-medium">投递</th><th className="px-3 py-3 font-medium">发布时间</th><th className="px-5 py-3 text-right font-medium">操作</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {jobs.map((j) => {
              const n = apps.filter((a) => a.jobId === j.id)
              const fresh = n.filter((a) => a.status === 'APPLIED').length
              return (
                <tr key={j.id} className="hover:bg-gray-50/50">
                  <td className="px-5 py-3.5">
                    <p className="font-medium">{j.title}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{JOB_TYPE_LABEL[j.type]} · {j.state} · {formatSalary(j.salaryMin, j.salaryMax)}</p>
                  </td>
                  <td className="px-3"><Tag tone={STATUS_TONE[j.status]}>{JOB_STATUS_LABEL[j.status]}</Tag></td>
                  <td className="px-3">{n.length}{fresh > 0 && <span className="ml-1.5 rounded-full bg-red-500 px-1.5 text-xs text-white">{fresh} 新</span>}</td>
                  <td className="px-3 text-gray-500">{formatDate(j.publishedAt)}</td>
                  <td className="px-5 text-right">
                    <div className="flex justify-end gap-1">
                      <Link to={`/e/applicants?job=${j.id}`} className={buttonClass('ghost', 'xs')}>查看投递</Link>
                      {j.status === 'PUBLISHED' && <Link to={`/jobs/${j.id}`} className={buttonClass('ghost', 'xs')}>预览</Link>}
                      {j.status === 'PUBLISHED' && <Button variant="ghost" size="xs" onClick={() => { actions.setJobStatus(j.id, 'CLOSED'); toast('职位已关闭') }}>关闭</Button>}
                      {j.status === 'CLOSED' && <Button variant="ghost" size="xs" onClick={() => { actions.setJobStatus(j.id, 'PUBLISHED'); toast('职位已重新开放') }}>重新开放</Button>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {jobs.length === 0 && <Empty title="没有这个状态的职位" />}
      </Card>
    </div>
  )
}

export function JobNew() {
  const { actions } = useStore()
  const nav = useNavigate()
  const toast = useToast()
  const [f, setF] = useState({
    title: '', type: 'INTERNSHIP' as JobType, category: '技术', state: '吉隆坡', city: '吉隆坡 · 孟沙', salaryMin: 1500, salaryMax: 2000,
    degree: 'BACHELOR' as Degree, languages: ['中文', '英文'], skills: [] as string[], acceptsStudentPass: true, sponsorsWorkPass: false,
    headcount: 1, description: '', requirements: '',
  })
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f.title.trim() || !f.description.trim()) return toast('请填写职位名称和职位描述', 'error')
    if (f.salaryMin > f.salaryMax) return toast('最低薪资不能高于最高薪资', 'error')
    const lines = (t: string) => t.split('\n').map((x) => x.replace(/^[-·\d.、\s]+/, '').trim()).filter(Boolean)
    const status = actions.postJob({ ...f, description: lines(f.description), requirements: lines(f.requirements) })
    toast(status === 'PUBLISHED' ? '职位已发布' : '已提交审核，运营通常 1 个工作日内处理')
    nav('/e/jobs')
  }
  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold">发布新职位</h1>
      <Card className="space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="职位名称" required className="sm:col-span-2"><Input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="如：前端开发实习生" /></Field>
          <Field label="职位类型"><Select value={f.type} onChange={(e) => set({ type: e.target.value as JobType })}>{Object.entries(JOB_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="职位类别"><Select value={f.category} onChange={(e) => set({ category: e.target.value })}>{CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select></Field>
          <Field label="工作州属"><Select value={f.state} onChange={(e) => set({ state: e.target.value })}>{STATES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="具体地点"><Input value={f.city} onChange={(e) => set({ city: e.target.value })} /></Field>
          <Field label="月薪下限（RM）"><Input type="number" value={f.salaryMin} onChange={(e) => set({ salaryMin: +e.target.value })} /></Field>
          <Field label="月薪上限（RM）"><Input type="number" value={f.salaryMax} onChange={(e) => set({ salaryMax: +e.target.value })} /></Field>
          <Field label="学历要求"><Select value={f.degree} onChange={(e) => set({ degree: e.target.value as Degree })}>{Object.entries(DEGREE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="招聘人数"><Input type="number" min={1} value={f.headcount} onChange={(e) => set({ headcount: +e.target.value })} /></Field>
        </div>
        <Field label="语言要求">
          <div className="flex flex-wrap gap-2">{LANGS.map((l) => <Chip key={l} active={f.languages.includes(l)} onClick={() => set({ languages: f.languages.includes(l) ? f.languages.filter((x) => x !== l) : [...f.languages, l] })}>{l}</Chip>)}</div>
        </Field>
        <Field label="技能标签" hint="输入后按回车添加"><TagInput value={f.skills} onChange={(skills) => set({ skills })} placeholder="如：React、AutoCAD" /></Field>
        <div className="flex flex-wrap gap-6 rounded-lg bg-gray-50 p-4 text-sm">
          <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={f.acceptsStudentPass} onChange={(e) => set({ acceptsStudentPass: e.target.checked })} className="accent-brand-500" />接受持学生准证的国际生（如课程要求的实习）</label>
          <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={f.sponsorsWorkPass} onChange={(e) => set({ sponsorsWorkPass: e.target.checked })} className="accent-brand-500" />可协助办理工作准证</label>
        </div>
        <Field label="职位描述" required hint="每行一条"><Textarea rows={5} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <Field label="任职要求" hint="每行一条"><Textarea rows={4} value={f.requirements} onChange={(e) => set({ requirements: e.target.value })} /></Field>
      </Card>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => nav('/e/jobs')}>取消</Button>
        <Button type="submit">发布职位</Button>
      </div>
    </form>
  )
}

const COLUMNS: AppStatus[] = ['APPLIED', 'VIEWED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']

export function Applicants() {
  const { state, actions } = useStore()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const jobs = companyJobs(state)
  const jobId = params.get('job') ?? ''
  const apps = companyApplications(state).filter((a) => !jobId || a.jobId === jobId)
  const [openId, setOpenId] = useState<string | null>(null)
  const [over, setOver] = useState<AppStatus | null>(null)
  const current = state.applications.find((a) => a.id === openId)
  const view = params.get('view') === 'list' ? 'list' : 'board'
  const [sortKey, setSortKey] = useState<'cgpa' | 'grad' | 'completeness'>('cgpa')
  const setView = (v: 'board' | 'list') => {
    const p = new URLSearchParams(params)
    if (v === 'list') p.set('view', 'list')
    else p.delete('view')
    setParams(p)
  }
  const rows = apps
    .map((a) => ({ a, r: toStandardRow(getStudent(state, a.studentId)!, { masked: false }), job: state.jobs.find((j) => j.id === a.jobId)! }))
    .sort((x, y) => (sortKey === 'completeness' ? y.r.completeness - x.r.completeness : sortKey === 'grad' ? x.r.grad.localeCompare(y.r.grad) : (y.r.cgpa === '—' ? -1 : +y.r.cgpa) - (x.r.cgpa === '—' ? -1 : +x.r.cgpa)))

  const open = (a: Application) => {
    if (a.status === 'APPLIED') actions.moveApplication(a.id, 'VIEWED')
    setOpenId(a.id)
  }
  const drop = (e: DragEvent, status: AppStatus) => {
    e.preventDefault()
    setOver(null)
    const id = e.dataTransfer.getData('text/plain')
    actions.moveApplication(id, status)
    toast(`已移到「${APP_STATUS_LABEL[status]}」`)
  }
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">收到的简历</h1>
        <Select value={jobId} onChange={(e) => setParams(e.target.value ? { job: e.target.value } : {})} className="w-64 bg-white">
          <option value="">全部职位</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
        </Select>
        <div className="flex rounded-lg bg-gray-100 p-0.5 text-sm">
          {(['board', 'list'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={cn('cursor-pointer rounded-md px-3 py-1', view === v ? 'bg-white font-medium text-brand-600 shadow-sm' : 'text-gray-500')}>{v === 'board' ? '看板' : '标准化列表'}</button>
          ))}
        </div>
        <span className="text-sm text-gray-400">{view === 'board' ? '拖动卡片改变状态，学生会收到通知' : '同一格式一眼扫完，点一行看详情'}</span>
      </div>
      {view === 'list' && apps.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2 text-sm text-gray-500">
            排序
            {([['cgpa', 'CGPA'], ['grad', '毕业时间'], ['completeness', '完成度']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setSortKey(k)} className={cn('cursor-pointer rounded-full px-2.5 py-0.5', sortKey === k ? 'bg-brand-50 text-brand-600' : 'hover:text-brand-500')}>{l}</button>
            ))}
          </div>
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>{['姓名', '学校', '专业', '学历', '毕业', 'CGPA', '工作资格', '语言', '实习', '校园', '完成度', '状态'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ a, r, job }) => (
                <tr key={a.id} onClick={() => open(a)} className="cursor-pointer hover:bg-brand-50/40" title={job.title}>
                  <td className="px-3 py-2.5 font-medium">{r.name}</td><td className="px-3">{r.school}</td><td className="max-w-32 truncate px-3">{r.major}</td>
                  <td className="px-3">{r.degree}</td><td className="px-3">{r.grad}</td><td className="px-3 font-medium">{r.cgpa}</td>
                  <td className="px-3 text-xs">{r.workAuth}</td><td className="px-3 text-xs">{r.languages}</td>
                  <td className="px-3 text-center">{r.internships}</td><td className="px-3 text-center">{r.campus}</td>
                  <td className="px-3">{r.completeness}%</td><td className="px-3"><Tag>{APP_STATUS_LABEL[a.status]}</Tag></td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-gray-100 md:hidden">
            {rows.map(({ a, r }) => (
              <li key={a.id}>
                <button type="button" onClick={() => open(a)} className="block w-full cursor-pointer px-4 py-3 text-left text-sm">
                  <span className="font-medium">{r.name}</span> <span className="text-gray-500">· {r.school} · {r.major}</span>
                  <span className="mt-1 block text-xs text-gray-500">{r.degree} · {r.grad} 毕业 · CGPA {r.cgpa} · {r.workAuth} · 实习 {r.internships} · 校园 {r.campus}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {view === 'board' && <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const items = apps.filter((a) => a.status === col)
          return (
            <div
              key={col}
              onDragOver={(e) => { e.preventDefault(); setOver(col) }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => drop(e, col)}
              className={cn('flex w-60 shrink-0 flex-col rounded-xl bg-gray-100/70 p-2 transition', over === col && 'bg-brand-50 ring-2 ring-brand-300')}
            >
              <div className="flex items-center justify-between px-2 py-1.5 text-sm font-medium text-gray-600">
                {APP_STATUS_LABEL[col]}<span className="rounded-full bg-white px-2 text-xs text-gray-500">{items.length}</span>
              </div>
              <div className="mt-1 min-h-24 space-y-2">
                {items.map((a) => {
                  const s = getStudent(state, a.studentId)!
                  const job = state.jobs.find((j) => j.id === a.jobId)!
                  return (
                    <button
                      key={a.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', a.id)}
                      onClick={() => open(a)}
                      className="block w-full cursor-grab rounded-lg bg-white p-3 text-left shadow-sm hover:ring-2 hover:ring-brand-200 active:cursor-grabbing"
                    >
                      <div className="flex items-center gap-2">
                        <Avatar name={s.fullName} size={28} />
                        <span className="truncate text-sm font-medium">{s.fullName}</span>
                      </div>
                      <p className="mt-1.5 truncate text-xs text-gray-500">{schoolById(s.schoolId)?.short} · {s.major} · {s.gradYear} 届</p>
                      {!jobId && <p className="mt-1 truncate text-xs text-brand-500">{job.title}</p>}
                      <p className="mt-1 text-[11px] text-gray-400">{timeAgo(a.createdAt)}投递</p>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>}
      {current && (() => {
        const s = getStudent(state, current.studentId)!
        const job = state.jobs.find((j) => j.id === current.jobId)!
        return (
          <Modal open side width={460} onClose={() => setOpenId(null)} title="候选人详情">
            <div className="flex items-center gap-3">
              <Avatar name={s.fullName} size={52} />
              <div>
                <p className="text-lg font-semibold">{s.fullName}</p>
                <p className="text-sm text-gray-500">{schoolById(s.schoolId)?.name} · {s.major}</p>
              </div>
            </div>
            <p className="mt-3 text-sm text-gray-600">投递「{job.title}」· {formatDateTime(current.createdAt)}</p>
            {current.note && <blockquote className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">“{current.note}”</blockquote>}
            {hasAccess(state, s.id) ? (
              <div className="mt-4 space-y-2 rounded-lg bg-emerald-50 p-3 text-sm">
                <p className="text-xs text-emerald-700">学生主动投递，联系方式免费查看</p>
                <p className="flex items-center gap-2"><Phone className="size-4 text-emerald-600" />{s.contact.phone}</p>
                <p className="flex items-center gap-2"><Mail className="size-4 text-emerald-600" />{s.contact.email}</p>
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-500">该学生已屏蔽贵公司，联系方式不再显示</p>
            )}
            <Field label="状态" className="mt-4">
              <Select value={current.status} onChange={(e) => { actions.moveApplication(current.id, e.target.value as AppStatus); toast('状态已更新，学生会收到通知') }}>
                {COLUMNS.map((c) => <option key={c} value={c}>{APP_STATUS_LABEL[c]}</option>)}
              </Select>
            </Field>
            <Field label="内部备注（学生看不到）" className="mt-4">
              <Textarea defaultValue={current.internalNote} onBlur={(e) => actions.setInternalNote(current.id, e.target.value)} placeholder="例如：二面安排在周四下午" />
            </Field>
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-gray-700">状态记录</p>
              <ol className="space-y-1.5 text-xs text-gray-500">
                {[...current.events].reverse().map((ev, i) => <li key={i} className="flex justify-between"><span>{APP_STATUS_LABEL[ev.status]}</span><span>{formatDateTime(ev.at)}</span></li>)}
              </ol>
            </div>
            {hasAccess(state, s.id) && <Link to={`/e/talent/${s.id}`} className={buttonClass('outline', 'md', 'mt-5 w-full')}><FileText className="size-4" />查看完整档案</Link>}
          </Modal>
        )
      })()}
      {apps.length === 0 && <Card><Empty icon={<Inbox className="size-12" />} title="这个职位还没有投递" desc="可以去人才库主动邀请学生投递" action={<Link to="/e/talent" className={buttonClass('primary')}>去人才库</Link>} /></Card>}
    </div>
  )
}

const PACKAGES = [
  { name: '点数包 10 点', price: 299, credits: 10, desc: '约 RM 30 / 次解锁，适合偶尔招人', perks: ['10 次人才解锁', '有效期 12 个月'] },
  { name: '标准年费', price: 2999, credits: 120, desc: '适合每年稳定招实习生和应届生', perks: ['120 点解锁', '10 个在招职位', '3 个团队席位', '每月 200 次邀请'], hot: true },
  { name: '合作伙伴年费', price: 8888, credits: 400, desc: '适合大量校招的集团企业', perks: ['400 点解锁', '不限职位', '10 个团队席位', '1 场校园宣讲会', '首页品牌展示'] },
]

export function Billing() {
  const { state, actions } = useStore()
  const toast = useToast()
  const [buying, setBuying] = useState<(typeof PACKAGES)[number] | null>(null)
  const [method, setMethod] = useState('FPX 网上银行')
  const billing = state.settings.billingEnabled
  const month = new Date().getMonth()
  const used = state.ledger.filter((l) => l.reason === 'UNLOCK' && new Date(l.at).getMonth() === month).reduce((a, b) => a - b.delta, 0)
  const methods = [
    { k: 'FPX 网上银行', icon: Landmark, d: 'Maybank2u、CIMB Clicks 等' },
    { k: '信用卡 / 借记卡', icon: CreditCard, d: 'Visa、Mastercard' },
    { k: '银行转账', icon: Receipt, d: '上传回单，运营 1 个工作日内确认' },
  ]
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">点数与账单</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-gradient-to-br from-amber-400 to-orange-500 p-5 text-white md:col-span-1">
          <p className="flex items-center gap-1.5 text-sm text-white/90"><Coins className="size-4" />当前余额</p>
          <p className="mt-2 text-4xl font-bold tabular-nums">{state.credits}<span className="ml-1 text-base font-normal">点</span></p>
          <p className="mt-2 text-sm text-white/90">本月已用 {used} 点 · 解锁 1 次 = {state.settings.unlockCost} 点</p>
        </Card>
        <Card className="p-5 md:col-span-2">
          {billing ? (
            <>
              <p className="font-semibold">正式收费期</p>
              <p className="mt-1 text-sm text-gray-500">按需购买点数包，或开通年度会员获得更多权益。公益期获得的点数会全部保留。</p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-1.5 font-semibold"><Gift className="size-5 text-brand-500" />公益试点期 · 免费使用</p>
              <p className="mt-1 text-sm text-gray-500">认证企业每月 1 日自动补足到 {state.settings.pilotMonthlyCredits} 点（不累加）。正式收费后，参加过公益期的企业可享首年会员 5 折。</p>
              <p className="mt-3 text-sm">下次补足：<b>{(() => { const d = new Date(); return `${d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear()} 年 ${(d.getMonth() + 1) % 12 + 1} 月 1 日` })()}</b></p>
            </>
          )}
        </Card>
      </div>

      <div>
        <h2 className="mb-3 font-semibold">套餐</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {PACKAGES.map((p) => (
            <Card key={p.name} className={cn('relative flex flex-col p-5', p.hot && 'border-2 border-brand-500')}>
              {p.hot && <span className="absolute -top-3 left-5 rounded-full bg-brand-500 px-3 py-0.5 text-xs text-white">推荐</span>}
              <p className="font-semibold">{p.name}</p>
              <p className="mt-1 text-xs text-gray-400">{p.desc}</p>
              <p className="mt-4 text-3xl font-bold">RM {p.price.toLocaleString()}</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm text-gray-600">{p.perks.map((x) => <li key={x}>✓ {x}</li>)}</ul>
              <Button className="mt-5 w-full" variant={p.hot ? 'primary' : 'outline'} disabled={!billing} onClick={() => setBuying(p)}>{billing ? '购买' : '公益期结束后开放'}</Button>
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <h2 className="border-b border-gray-100 px-5 py-4 font-semibold">点数流水</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-gray-500"><tr><th className="px-5 py-2.5 font-medium">时间</th><th className="px-3 font-medium">说明</th><th className="px-3 text-right font-medium">变动</th><th className="px-5 text-right font-medium">余额</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {state.ledger.map((l) => (
                <tr key={l.id}>
                  <td className="px-5 py-3 text-gray-500">{formatDateTime(l.at)}</td>
                  <td className="px-3">{l.note}</td>
                  <td className={cn('px-3 text-right font-medium tabular-nums', l.delta > 0 ? 'text-emerald-600' : 'text-gray-700')}>{l.delta > 0 ? `+${l.delta}` : l.delta}</td>
                  <td className="px-5 text-right tabular-nums text-gray-500">{l.balanceAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {state.orders.length > 0 && (
        <Card>
          <h2 className="border-b border-gray-100 px-5 py-4 font-semibold">订单与发票</h2>
          <div className="divide-y divide-gray-50">
            {state.orders.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="font-mono text-gray-500">{o.orderNo}</span>
                <span className="flex-1">{o.name} · {o.method}</span>
                <span className="font-medium">RM {o.amount.toLocaleString()}</span>
                <Button variant="ghost" size="xs" onClick={() => toast('发票 PDF 已生成（原型）', 'info')}>下载发票</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal
        open={!!buying}
        onClose={() => setBuying(null)}
        title={`购买：${buying?.name}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBuying(null)}>取消</Button>
            <Button
              onClick={() => {
                if (!buying) return
                actions.buyPackage(buying.name, buying.price, buying.credits, method)
                toast(`支付成功，已到账 ${buying.credits} 点`)
                setBuying(null)
              }}
            >
              模拟支付 RM {buying?.price.toLocaleString()}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          {methods.map(({ k, icon: Icon, d }) => (
            <label key={k} className={cn('flex cursor-pointer items-center gap-3 rounded-lg border-2 p-3', method === k ? 'border-brand-500 bg-brand-50/40' : 'border-gray-100')}>
              <input type="radio" checked={method === k} onChange={() => setMethod(k)} className="accent-brand-500" />
              <Icon className="size-5 text-gray-500" />
              <span className="flex-1"><span className="block text-sm font-medium">{k}</span><span className="text-xs text-gray-400">{d}</span></span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-400">原型中不会真实扣款。正式版接入 Stripe（银行卡 + FPX），并开具电子发票。</p>
      </Modal>
    </div>
  )
}

