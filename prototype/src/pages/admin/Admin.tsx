import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { BadgeCheck, Briefcase, Building2, ClipboardList, FileText, Handshake, LayoutDashboard, Settings2, Users } from 'lucide-react'
import { COMPANIES, DEGREE_LABEL, JOB_TYPE_LABEL, WORK_AUTH_LABEL, companyById, schoolById, SCHOOLS } from '../../data/mock'
import { COMPANY_TAG_LABEL, industryName } from '../../data/taxonomy'
import { parseBands } from '../../lib/settings'
import { ME_ID, REPORT_REASON_LABEL, allStudents, myQuota, studentCount, talentPool, useStore, type CompanyReview, type Settings } from '../../store'
import { completeness } from '../../lib/privacy'
import { cn, formatDate, formatDateTime, timeAgo } from '../../lib/utils'
import { Button, Card, Chip, Empty, Field, Input, LogoMark, Modal, Progress, Select, Stat, Tag, Textarea, Toggle } from '../../components/ui'
import { NotificationBell } from '../../components/shell'
import { JobDetailPanel } from '../../components/jobs'
import { useToast } from '../../components/toast'

const NAV = [
  { to: '/admin', label: '数据看板', icon: LayoutDashboard, end: true },
  { to: '/admin/companies', label: '企业认证', icon: BadgeCheck },
  { to: '/admin/jobs', label: '职位审核', icon: Briefcase },
  { to: '/admin/students', label: '学生管理', icon: Users },
  { to: '/admin/partners', label: '合作伙伴', icon: Handshake },
  { to: '/admin/settings', label: '系统设置', icon: Settings2 },
  { to: '/admin/audit', label: '审计日志', icon: ClipboardList },
]

export function AdminLayout() {
  const { state } = useStore()
  const pending = state.companyReviews.filter((r) => r.status === 'PENDING').length + state.jobs.filter((j) => j.status === 'PENDING_REVIEW').length
  return (
    <div className="min-h-screen bg-[#f5f6fa] lg:flex">
      <aside className="shrink-0 bg-[#1f2433] text-white/75 lg:sticky lg:top-0 lg:h-screen lg:w-56">
        <div className="flex h-14 items-center gap-2 px-5 font-semibold text-white"><LogoMark size={26} invert />FindMYJob · 运营后台</div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cn('flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm', isActive ? 'bg-brand-500 text-white' : 'hover:bg-white/10 hover:text-white')}>
              <Icon className="size-4" />{label}
              {to === '/admin' && pending > 0 && <span className="ml-auto rounded-full bg-red-500 px-1.5 text-xs text-white">{pending}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 md:px-6">
          <span className="text-sm text-gray-500">管理员 admin（示例）</span>
          <div className="flex items-center gap-3">
            <NotificationBell to="admin" />
            <Link to="/" className="text-sm text-gray-500 hover:text-brand-500">返回前台</Link>
          </div>
        </header>
        <main className="p-4 md:p-6"><Outlet /></main>
      </div>
    </div>
  )
}

// 单序列柱状图：标题即图例，悬停显示数值
function WeeklyBars({ title, data }: { title: string; data: { label: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...data.map((d) => d.value))
  return (
    <Card className="p-5">
      <p className="font-semibold">{title}</p>
      <div className="relative mt-4 flex h-44 items-end gap-[2px] border-b border-gray-200">
        {data.map((d, i) => (
          <div key={d.label} className="relative flex h-full flex-1 items-end justify-center" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className={cn('w-full max-w-9 rounded-t-[4px] transition-colors', hover === i ? 'bg-brand-600' : 'bg-brand-500')} style={{ height: `${(d.value / max) * 100}%` }} />
            {hover === i && <span className="absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white">{d.label}：{d.value} 人</span>}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px] text-center text-[11px] text-gray-400">{data.map((d) => <span key={d.label} className="flex-1">{d.label}</span>)}</div>
    </Card>
  )
}

export function AdminDashboard() {
  const { state } = useStore()
  const published = state.jobs.filter((j) => j.status === 'PUBLISHED').length
  const unlocks = state.ledger.filter((l) => l.reason === 'UNLOCK').length
  const apps = state.applications.length
  // 试点目标来自 business/01 §7；累计值 = 示例基数 + 原型里的实时操作
  const goals = [
    { label: '完成度 ≥ 60% 的学生档案', now: 386 + talentPool(state).length, target: 500 },
    { label: '认证企业', now: 12 + state.companyReviews.filter((r) => r.status === 'VERIFIED').length - 1, target: 20 },
    { label: '在招职位', now: published + 41, target: 80 },
    { label: '建立联系（解锁 + 投递）', now: 168 + unlocks + apps, target: 400 },
    { label: '签付费意向的企业', now: 3, target: 5 },
  ]
  const weekly = [32, 45, 61, 58, 84, 97, 76, 112].map((v, i) => ({ label: `第${i + 1}周`, value: v }))
  const bySchool = SCHOOLS.map((s) => ({ name: s.short, n: allStudents(state).filter((x) => x.schoolId === s.id).length })).sort((a, b) => b.n - a.n)
  const maxSchool = Math.max(...bySchool.map((b) => b.n))
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">数据看板</h1>
          <p className="mt-1 text-sm text-gray-500">公益试点第 8 周 / 共 12 周 · 累计数据为示例</p>
        </div>
        <Tag tone={state.settings.billingEnabled ? 'green' : 'blue'}>{state.settings.billingEnabled ? '收费期' : '公益试点期'}</Tag>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="待审核企业" value={state.companyReviews.filter((r) => r.status === 'PENDING').length} icon={<Building2 className="size-5" />} sub={<Link to="/admin/companies" className="text-brand-500">去处理 →</Link>} />
        <Stat label="待审核职位" value={state.jobs.filter((j) => j.status === 'PENDING_REVIEW').length} icon={<Briefcase className="size-5" />} sub={<Link to="/admin/jobs" className="text-brand-500">去处理 →</Link>} />
        <Stat label="在招职位" value={published} icon={<FileText className="size-5" />} />
        <Stat label="人才库学生" value={talentPool(state).length} icon={<Users className="size-5" />} sub="原型样本数" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <p className="font-semibold">试点目标进度</p>
          <div className="mt-4 space-y-4">
            {goals.map((g) => (
              <div key={g.label}>
                <div className="flex justify-between text-sm"><span className="text-gray-600">{g.label}</span><span className="tabular-nums text-gray-900">{g.now} <span className="text-gray-400">/ {g.target}</span></span></div>
                <Progress value={(g.now / g.target) * 100} className="mt-1.5" />
              </div>
            ))}
          </div>
        </Card>
        <WeeklyBars title="每周新增学生档案" data={weekly} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <p className="font-semibold">人才来源学校（原型样本）</p>
          <div className="mt-4 space-y-2.5">
            {bySchool.map((b) => (
              <div key={b.name} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0 text-gray-600">{b.name}</span>
                <div className="h-3 flex-1 rounded bg-gray-100"><div className="h-full rounded bg-brand-500" style={{ width: `${(b.n / maxSchool) * 100}%` }} /></div>
                <span className="w-6 text-right tabular-nums text-gray-500">{b.n}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between"><p className="font-semibold">最近操作</p><Link to="/admin/audit" className="text-sm text-brand-500">全部 →</Link></div>
          <ul className="mt-3 divide-y divide-gray-50 text-sm">
            {state.audit.slice(0, 6).map((a) => (
              <li key={a.id} className="flex gap-3 py-2.5">
                <code className="shrink-0 rounded bg-gray-100 px-1.5 text-xs leading-5 text-gray-600">{a.action}</code>
                <span className="min-w-0 flex-1 truncate text-gray-600">{a.target}</span>
                <span className="shrink-0 text-xs text-gray-400">{timeAgo(a.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

export function AdminCompanies() {
  const { state, actions } = useStore()
  const toast = useToast()
  const [tab, setTab] = useState<CompanyReview['status']>('PENDING')
  const [doc, setDoc] = useState<CompanyReview | null>(null)
  const [rejecting, setRejecting] = useState<CompanyReview | null>(null)
  const [reason, setReason] = useState('')
  const list = state.companyReviews.filter((r) => r.status === tab)
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">企业认证</h1>
      <div className="mb-4 flex gap-2">
        {([['PENDING', '待审核'], ['VERIFIED', '已通过'], ['REJECTED', '已驳回']] as const).map(([k, l]) => (
          <Chip key={k} active={tab === k} onClick={() => setTab(k)}>{l} {state.companyReviews.filter((r) => r.status === k).length}</Chip>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/60 text-left text-gray-500"><tr><th className="px-5 py-3 font-medium">企业</th><th className="px-3 font-medium">SSM 注册号</th><th className="px-3 font-medium">联系人</th><th className="px-3 font-medium">提交时间</th><th className="px-5 text-right font-medium">操作</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {list.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-3.5"><p className="font-medium">{r.name}</p><p className="text-xs text-gray-400">{r.industry}</p>{r.reason && <p className="mt-1 text-xs text-red-500">驳回原因：{r.reason}</p>}</td>
                <td className="px-3 font-mono text-xs text-gray-600">{r.ssm}</td>
                <td className="px-3 text-gray-600">{r.contact}</td>
                <td className="px-3 text-gray-500">{formatDate(r.submittedAt)}</td>
                <td className="px-5 text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="xs" onClick={() => setDoc(r)}>查看材料（{r.files.length}）</Button>
                    {r.status === 'PENDING' && (
                      <>
                        <Button variant="success" size="xs" onClick={() => { actions.reviewCompany(r.id, true); toast(`已通过：${r.name}`) }}>通过</Button>
                        <Button variant="white" size="xs" onClick={() => { setRejecting(r); setReason('') }}>驳回</Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <Empty title="没有记录" />}
      </Card>
      <Modal open={!!doc} onClose={() => setDoc(null)} title="认证材料" width={560}>
        {doc && (
          <div className="space-y-3">
            {doc.files.map((f) => (
              <div key={f} className="rounded-lg border border-gray-100 p-4">
                <p className="flex items-center gap-2 text-sm font-medium"><FileText className="size-4 text-red-500" />{f}</p>
                <div className="mt-3 rounded bg-gray-50 p-4 text-xs leading-6 text-gray-500">
                  <p className="font-semibold text-gray-700">SURUHANJAYA SYARIKAT MALAYSIA（示例）</p>
                  <p>公司名称：{doc.name}</p>
                  <p>注册号：{doc.ssm}</p>
                  <p>原型中为示意，正式系统通过预签名链接查看原件</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={`驳回：${rejecting?.name}`}
        footer={<><Button variant="ghost" onClick={() => setRejecting(null)}>取消</Button><Button variant="danger" disabled={!reason.trim()} onClick={() => { actions.reviewCompany(rejecting!.id, false, reason); toast('已驳回，企业会收到原因'); setRejecting(null) }}>确认驳回</Button></>}
      >
        <Field label="驳回原因" required hint="企业会看到这段话，请写清楚需要补充什么"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
      <Card className="mt-5">
        <p className="border-b border-gray-100 px-5 py-3 font-semibold">已认证企业的行业和定位标签<span className="ml-2 text-xs font-normal text-gray-400">由运营核实后设置，企业不能自己标"世界 500 强"（正式版可在此编辑）</span></p>
        <div className="divide-y divide-gray-50">
          {COMPANIES.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
              <span className="w-28 shrink-0 font-medium">{c.short}</span>
              <span className="text-gray-500">{industryName(c.industryCode)}</span>
              <span className="ml-auto flex flex-wrap gap-1">{c.tags.map((t) => <Tag key={t}>{COMPANY_TAG_LABEL[t]}</Tag>)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

export function AdminJobs() {
  const { state, actions } = useStore()
  const toast = useToast()
  const [preview, setPreview] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const pending = state.jobs.filter((j) => j.status === 'PENDING_REVIEW')
  const recent = state.jobs.filter((j) => j.status === 'PUBLISHED').sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)).slice(0, 6)
  const job = state.jobs.find((j) => j.id === preview)
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">职位审核</h1>
        <p className="mt-1 text-sm text-gray-500">新认证企业的前 {state.settings.autoPublishAfter} 个职位需要人工审核，之后自动发布（可在系统设置中调整）</p>
      </div>
      <Card>
        <p className="border-b border-gray-100 px-5 py-3 font-semibold">待审核（{pending.length}）</p>
        <div className="divide-y divide-gray-50">
          {pending.map((j) => (
            <div key={j.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{j.title}</p>
                <p className="text-xs text-gray-400">{companyById(j.companyId).short} · {JOB_TYPE_LABEL[j.type]} · {j.state} · 提交于 {timeAgo(j.publishedAt)}</p>
              </div>
              <Button variant="ghost" size="xs" onClick={() => setPreview(j.id)}>预览</Button>
              <Button variant="success" size="xs" onClick={() => { actions.reviewJob(j.id, true); toast('已通过并发布') }}>通过</Button>
              <Button variant="white" size="xs" onClick={() => { setRejecting(j.id); setReason('') }}>驳回</Button>
            </div>
          ))}
          {pending.length === 0 && <Empty title="没有待审核的职位" desc="企业端发布的新职位会出现在这里" />}
        </div>
      </Card>
      <Card>
        <p className="border-b border-gray-100 px-5 py-3 font-semibold">职位举报（{state.jobReports.filter((r) => r.status === 'OPEN').length} 条待处理）</p>
        <div className="divide-y divide-gray-50">
          {state.jobReports.map((r) => {
            const j = state.jobs.find((x) => x.id === r.jobId)
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{j?.title ?? r.jobId}<span className="ml-2 text-xs text-gray-400">{j && companyById(j.companyId).short}</span></p>
                  <p className="text-xs text-gray-500">{REPORT_REASON_LABEL[r.reason]}{r.note && ` · ${r.note}`} · {timeAgo(r.at)}</p>
                </div>
                {r.status === 'OPEN' ? (
                  <>
                    <Button variant="success" size="xs" onClick={() => { actions.resolveReport(r.id, 'RESOLVED'); toast('已标记为已处理') }}>已处理</Button>
                    <Button variant="white" size="xs" onClick={() => { actions.resolveReport(r.id, 'DISMISSED'); toast('已驳回举报') }}>驳回</Button>
                  </>
                ) : <Tag>{r.status === 'RESOLVED' ? '已处理' : '已驳回'}</Tag>}
              </div>
            )
          })}
          {state.jobReports.length === 0 && <Empty title="没有举报" desc="学生在职位详情页底部点举报后，会出现在这里" />}
        </div>
      </Card>
      <Card>
        <p className="border-b border-gray-100 px-5 py-3 font-semibold">最近发布</p>
        <div className="divide-y divide-gray-50">
          {recent.map((j) => (
            <div key={j.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <span className="flex-1">{j.title}<span className="ml-2 text-gray-400">{companyById(j.companyId).short}</span></span>
              <span className="text-xs text-gray-400">{formatDateTime(j.publishedAt)}</span>
            </div>
          ))}
        </div>
      </Card>
      <Modal open={!!job} onClose={() => setPreview(null)} title="职位预览" width={760}>
        {job && <JobDetailPanel job={job} start={() => {}} compact />}
      </Modal>
      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="驳回职位"
        footer={<><Button variant="ghost" onClick={() => setRejecting(null)}>取消</Button><Button variant="danger" disabled={!reason.trim()} onClick={() => { actions.reviewJob(rejecting!, false, reason); toast('已驳回'); setRejecting(null) }}>确认驳回</Button></>}
      >
        <Field label="驳回原因" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：薪资低于最低工资标准，请修改后重新提交" /></Field>
      </Modal>
    </div>
  )
}

export function AdminStudents() {
  const { state, actions } = useStore()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [grant, setGrant] = useState<{ amount: number; note: string } | null>(null)
  const quota = myQuota(state)
  const list = allStudents(state).filter((s) => !q || [s.fullName, s.major, schoolById(s.schoolId)?.name].join(' ').toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">学生管理</h1>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索姓名、学校、专业" className="w-64 bg-white" />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/60 text-left text-gray-500"><tr><th className="px-5 py-3 font-medium">姓名</th><th className="px-3 font-medium">学校 / 专业</th><th className="px-3 font-medium">工作资格</th><th className="px-3 font-medium">完成度</th><th className="px-3 font-medium">人才库</th><th className="px-3 font-medium">查看额度</th><th className="px-5 font-medium">最近活跃</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {list.map((s) => {
              const sc = completeness(s).score
              return (
                <tr key={s.id}>
                  <td className="px-5 py-3 font-medium">{s.fullName}</td>
                  <td className="px-3 text-gray-600">{schoolById(s.schoolId)?.short} · {DEGREE_LABEL[s.degree]} · {s.major}</td>
                  <td className="px-3">{WORK_AUTH_LABEL[s.workAuth]}</td>
                  <td className="px-3"><div className="flex items-center gap-2"><Progress value={sc} className="w-16" /><span className="tabular-nums text-gray-500">{sc}%</span></div></td>
                  <td className="px-3">{s.visibility === 'PUBLIC' ? <Tag tone="green">公开</Tag> : <Tag>已关闭</Tag>}</td>
                  <td className="px-3 text-xs text-gray-500">{s.id === ME_ID ? <span className="flex items-center gap-2">{quota.limit === null ? '不限' : `${quota.used} / ${quota.limit}`}<Button variant="ghost" size="xs" onClick={() => setGrant({ amount: 10, note: '' })}>加额度</Button></span> : '—'}</td>
                  <td className="px-5 text-gray-500">{timeAgo(s.lastActive)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-xs text-gray-400">运营查看学生联系方式也会写入审计日志（正式系统）。原型里只有演示学生"我"可以加额度。</p>
      <Modal
        open={!!grant}
        onClose={() => setGrant(null)}
        title="给学生加查看额度"
        footer={<><Button variant="ghost" onClick={() => setGrant(null)}>取消</Button><Button disabled={!grant?.note.trim() || !(grant.amount > 0)} onClick={() => { actions.grantViews(grant!.amount, grant!.note.trim()); toast('已加额度，写入审计日志'); setGrant(null) }}>确认</Button></>}
      >
        {grant && (
          <div className="space-y-4">
            <Field label="增加几个职位"><Input type="number" min={1} value={grant.amount} onChange={(e) => setGrant({ ...grant, amount: Math.max(0, +e.target.value) })} /></Field>
            <Field label="原因" required hint="例如：校园活动奖励、处理投诉补偿"><Input value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  )
}

export function AdminPartners() {
  const { state, actions } = useStore()
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">合作伙伴</h1>
      <p className="mb-4 text-sm text-gray-500">控制首页「背书与合作伙伴」区域显示哪些机构</p>
      <div className="grid gap-3 md:grid-cols-2">
        {state.partners.map((p) => (
          <Card key={p.id} className="flex items-center gap-4 p-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-full text-lg font-bold text-white" style={{ background: p.color }}>{p.name[0]}</span>
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{p.name}</p><p className="text-xs text-gray-400">{p.type}</p></div>
            <span className="text-xs text-gray-500">首页展示</span>
            <Toggle label={`${p.name} 首页展示`} checked={p.showOnHome} onChange={() => actions.togglePartner(p.id)} />
          </Card>
        ))}
      </div>
    </div>
  )
}

export function AdminSettings() {
  const { state, actions } = useStore()
  const toast = useToast()
  const [draft, setDraft] = useState<Settings>(state.settings)
  const [confirmBilling, setConfirmBilling] = useState(false)
  const [bands, setBands] = useState(state.settings.salaryBands.join(', '))
  const count = studentCount(state)
  const ratio = count / Math.max(1, draft.signupCap)
  const nums: { key: keyof Settings; label: string; hint: string }[] = [
    { key: 'pilotMonthlyCredits', label: '公益期每月点数', hint: 'pilot.monthlyCredits · 每月 1 日补足到该值' },
    { key: 'unlockCost', label: '每次解锁消耗点数', hint: 'unlock.costCredits' },
    { key: 'autoPublishAfter', label: '审核通过几个职位后自动发布', hint: 'jobs.autoPublishAfter' },
    { key: 'invitationQuota', label: '每月邀请投递次数', hint: 'invitations.freeMonthlyQuota' },
    { key: 'profileViewsPerDay', label: '每人每天查看档案上限', hint: 'limits.profileViewsPerDay · 防爬' },
    { key: 'unlocksPerDay', label: '每人每天解锁上限', hint: 'limits.unlocksPerDay · 防爬' },
  ]
  const quotaNums: { key: keyof Settings; label: string; hint: string }[] = [
    { key: 'baseJobViews', label: '注册后可看几个职位', hint: 'studentQuota.baseJobViews' },
    { key: 'tierSize', label: '每几个有效邀请算一档', hint: 'studentQuota.tierSize' },
    { key: 'tierBonus', label: '每档多看几个', hint: 'studentQuota.tierBonus' },
    { key: 'unlimitedAt', label: '邀请满几个人不限', hint: 'studentQuota.unlimitedAt' },
    { key: 'referralMinCompleteness', label: '有效邀请的资料完成度（%）', hint: 'referral.minCompleteness' },
    { key: 'applyMinCompleteness', label: '投递门槛：完成度（%）', hint: 'apply.minCompleteness' },
  ]
  const save = () => {
    const parsed = parseBands(bands)
    if (!parsed) return toast('薪资档要写成用逗号分隔的正整数，例如 2000, 3000, 5000', 'error')
    const { billingEnabled: _b, ...rest } = draft
    actions.updateSettings({ ...rest, salaryBands: parsed })
    setBands(parsed.join(', '))
    toast('设置已保存，改动已写入审计日志')
  }
  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-xl font-semibold">系统设置</h1>
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold">收费开关 <code className="ml-1 rounded bg-gray-100 px-1.5 text-xs font-normal text-gray-500">billing.enabled</code></p>
            <p className="mt-1 text-sm text-gray-500">关闭 = 公益试点期（每月自动送点数，套餐不可购买）；开启 = 正式收费（停止送点，开放购买）。企业现有余额始终保留。</p>
          </div>
          <Toggle label="收费开关" checked={state.settings.billingEnabled} onChange={() => setConfirmBilling(true)} />
        </div>
      </Card>
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold">学生端收费 <code className="ml-1 rounded bg-gray-100 px-1.5 text-xs font-normal text-gray-500">billing.studentEnabled</code></p>
            <p className="mt-1 text-sm text-gray-500">只预留接口：打开后学生端只显示一个禁用的"购买额度（即将开放）"按钮，不会真的收费。</p>
          </div>
          <Toggle label="学生端收费" checked={draft.studentBillingEnabled} onChange={(v) => setDraft({ ...draft, studentBillingEnabled: v })} />
        </div>
      </Card>
      <Card className="p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold">学生查看额度与邀请</p>
            <p className="mt-1 text-sm text-gray-500">关闭后访客也能看职位详情，学生不限次数。</p>
          </div>
          <Toggle label="启用查看额度" checked={draft.quotaEnabled} onChange={(v) => setDraft({ ...draft, quotaEnabled: v })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {quotaNums.map((n) => (
            <Field key={n.key} label={n.label} hint={n.hint}>
              <Input type="number" min={0} value={draft[n.key] as number} onChange={(e) => setDraft({ ...draft, [n.key]: Math.max(0, +e.target.value) })} />
            </Field>
          ))}
        </div>
      </Card>
      <Card className="p-5">
        <p className="mb-1 font-semibold">学生注册上限 <code className="ml-1 rounded bg-gray-100 px-1.5 text-xs font-normal text-gray-500">signup.studentCap</code></p>
        <p className="mb-4 text-sm text-gray-500">每个放量阶段都用它控制人数。满额后注册页显示"名额已满"，已注册的学生照常登录。</p>
        <div className="mb-4">
          <div className="flex justify-between text-sm"><span>当前学生 {count} 人</span><span>上限 {draft.signupCap} 人</span></div>
          <Progress value={Math.min(100, ratio * 100)} className={cn('mt-1.5', ratio >= draft.signupWarnRatio && '[&>div]:bg-amber-500')} />
          {ratio >= draft.signupWarnRatio && <p className="mt-1.5 text-xs text-amber-700">已达到预警线（{Math.round(draft.signupWarnRatio * 100)}%），该准备下一阶段的压测和安全加固了。</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="学生人数上限" hint="内测 200 → 本校 500 → 3000"><Input type="number" min={1} value={draft.signupCap} onChange={(e) => setDraft({ ...draft, signupCap: Math.max(1, +e.target.value) })} /></Field>
          <Field label="预警比例" hint="达到后通知运营一次"><Input type="number" step="0.05" min={0.5} max={1} value={draft.signupWarnRatio} onChange={(e) => setDraft({ ...draft, signupWarnRatio: Math.min(1, Math.max(0.5, +e.target.value)) })} /></Field>
        </div>
      </Card>
      <Card className="p-5">
        <p className="mb-4 font-semibold">搜索与薪资档</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="默认搜索方式" hint="search.defaultMode">
            <Select value={draft.searchDefaultMode} onChange={(e) => setDraft({ ...draft, searchDefaultMode: e.target.value as Settings['searchDefaultMode'] })}>
              <option value="EXACT">精确</option><option value="RELATED">关联</option>
            </Select>
          </Field>
          <Field label="精确结果少于几条时显示相关职位" hint="search.relatedFallbackBelow"><Input type="number" min={0} value={draft.relatedFallbackBelow} onChange={(e) => setDraft({ ...draft, relatedFallbackBelow: Math.max(0, +e.target.value) })} /></Field>
          <Field label="薪资档（MYR / 月）" hint="用逗号分隔，例如 2000, 3000, 5000, 8000" className="sm:col-span-2"><Input value={bands} onChange={(e) => setBands(e.target.value)} /></Field>
        </div>
        <div className="mt-5 flex justify-end"><Button onClick={save}>保存</Button></div>
      </Card>
      <Card className="p-5">
        <p className="mb-4 font-semibold">业务参数</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {nums.map((n) => (
            <Field key={n.key} label={n.label} hint={n.hint}>
              <Input type="number" min={0} value={draft[n.key] as number} onChange={(e) => setDraft({ ...draft, [n.key]: Math.max(0, +e.target.value) })} />
            </Field>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={save}>保存</Button>
        </div>
      </Card>
      <Modal
        open={confirmBilling}
        onClose={() => setConfirmBilling(false)}
        title={state.settings.billingEnabled ? '恢复公益期？' : '结束公益期，开始收费？'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmBilling(false)}>取消</Button>
            <Button
              onClick={() => {
                actions.updateSettings({ billingEnabled: !state.settings.billingEnabled })
                setDraft({ ...draft, billingEnabled: !state.settings.billingEnabled })
                setConfirmBilling(false)
                toast(state.settings.billingEnabled ? '已恢复公益期' : '已开启收费，企业端已开放购买')
              }}
            >
              确认
            </Button>
          </>
        }
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-gray-600">
          {state.settings.billingEnabled ? (
            <><li>恢复每月自动补足点数</li><li>企业端套餐暂停购买</li></>
          ) : (
            <><li>停止每月自动送点数</li><li>企业端开放购买点数包和年费会员</li><li>企业现有点数全部保留</li><li>所有企业会收到站内通知</li></>
          )}
        </ul>
        <p className="mt-3 text-xs text-gray-400">正式系统中这一步对应 TASKS.md 的 🚦 GATE-M8 闸门</p>
      </Modal>
    </div>
  )
}

export function AdminAudit() {
  const { state } = useStore()
  const [action, setAction] = useState('')
  const actionsList = [...new Set(state.audit.map((a) => a.action))]
  const list = state.audit.filter((a) => !action || a.action === action)
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">审计日志</h1>
          <p className="mt-1 text-sm text-gray-500">查看档案、解锁、下载简历、审核、改设置等敏感操作都会记录</p>
        </div>
        <select value={action} onChange={(e) => setAction(e.target.value)} className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm">
          <option value="">全部动作</option>
          {actionsList.map((a) => <option key={a}>{a}</option>)}
        </select>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/60 text-left text-gray-500"><tr><th className="px-5 py-3 font-medium">时间</th><th className="px-3 font-medium">操作人</th><th className="px-3 font-medium">动作</th><th className="px-5 font-medium">对象</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {list.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap px-5 py-3 text-gray-500">{formatDateTime(a.at)}</td>
                <td className="px-3">{a.actor}</td>
                <td className="px-3"><code className="rounded bg-gray-100 px-1.5 text-xs">{a.action}</code></td>
                <td className="px-5 text-gray-600">{a.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
