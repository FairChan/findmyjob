import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BadgeCheck, Briefcase, Building2, FileText, Flag, GraduationCap, Languages, Lock, MapPin, Share2, ShieldCheck, Star, UserPlus, Users } from 'lucide-react'
import { DEGREE_LABEL, JOB_TYPE_LABEL, companyById, type Company, type Job, type Partner } from '../data/mock'
import { COMPANY_TAG_LABEL, industryName, type CompanyTag } from '../data/taxonomy'
import { REPORT_REASON_LABEL, myApplication, myQuota, useStore, type JobReportReason } from '../store'
import { completeness, firstIncompleteStep } from '../lib/privacy'
import { cn, salaryText, timeAgo } from '../lib/utils'
import { Button, Card, CompanyLogo, Modal, Select, Tag, Textarea } from './ui'
import { useToast } from './toast'

const isNew = (job: Job) => Date.now() - new Date(job.publishedAt).getTime() < 2 * 86_400_000

export function PassTags({ job, size = 'sm' }: { job: Job; size?: 'sm' | 'xs' }) {
  return (
    <>
      {job.acceptsStudentPass && <Tag tone="green" className={size === 'xs' ? 'text-[11px]' : ''}>接受学生准证</Tag>}
      {job.sponsorsWorkPass && <Tag tone="purple" className={size === 'xs' ? 'text-[11px]' : ''}>可协助办工作准证</Tag>}
    </>
  )
}

/** 首页 / 企业页用的网格卡片（参考智联「最新招聘」） */
export function JobCard({ job }: { job: Job }) {
  const c = companyById(job.companyId)
  return (
    <Link to={`/jobs/${job.id}`} className="group block rounded-xl border border-transparent bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:border-brand-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <h3 className="truncate font-medium text-gray-900 group-hover:text-brand-500">{job.title}</h3>
        {isNew(job) && <Tag tone="orange" className="shrink-0 text-[11px]">新</Tag>}
      </div>
      <div className="mt-1.5 font-semibold text-brand-500">{salaryText(job)}</div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Tag>{JOB_TYPE_LABEL[job.type]}</Tag>
        <Tag>{job.state}</Tag>
        <Tag>{DEGREE_LABEL[job.degree]}</Tag>
        <PassTags job={job} size="xs" />
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3 text-sm text-gray-500">
        <CompanyLogo company={c} size={24} className="rounded-md" />
        <span className="truncate">{c.short}</span>
        <span className="shrink-0 text-gray-300">|</span>
        <span className="truncate text-xs">{industryName(c.industryCode)}</span>
      </div>
    </Link>
  )
}

/** 职位页左侧列表项（参考智联职位页左栏） */
export function JobListItem({ job, active, onClick, related, locked }: { job: Job; active: boolean; onClick: () => void; related?: boolean; locked?: boolean }) {
  const c = companyById(job.companyId)
  return (
    <button
      onClick={onClick}
      className={cn('block w-full cursor-pointer rounded-xl border-2 bg-white p-4 text-left transition', active ? 'border-brand-500 shadow-sm' : 'border-transparent hover:border-brand-200')}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={cn('flex min-w-0 items-center gap-1.5 font-medium', active ? 'text-brand-600' : 'text-gray-900')}>
          {locked && <Lock className="size-3.5 shrink-0 text-gray-400" aria-label="需要额度" />}
          <span className="line-clamp-1">{job.title}</span>
          {related && <Tag tone="amber" className="shrink-0">相关</Tag>}
        </span>
        <span className="shrink-0 font-semibold text-brand-500">{salaryText(job)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Tag>{DEGREE_LABEL[job.degree]}</Tag>
        <Tag>{JOB_TYPE_LABEL[job.type]}</Tag>
        {job.skills.slice(0, 2).map((s) => <Tag key={s}>{s}</Tag>)}
        <PassTags job={job} size="xs" />
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
        <CompanyLogo company={c} size={22} className="rounded-md" />
        <span className="truncate">{c.short}</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5 text-xs text-gray-400"><MapPin className="size-3" />{job.state}</span>
      </div>
    </button>
  )
}

/** 投递流程：未登录学生先引导切换身份，学生则弹出投递框 */
export function useApplyFlow() {
  const { state, actions } = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const [job, setJob] = useState<Job | null>(null)
  const [note, setNote] = useState('')
  const close = () => {
    setJob(null)
    setNote('')
  }
  const modal = job && (state.role !== 'student' ? (
    <Modal open onClose={close} title="投递需要学生账号" footer={<><Button variant="ghost" onClick={close}>取消</Button><Button onClick={() => actions.setRole('student')}>以学生身份登录（演示）</Button></>}>
      <p className="text-sm text-gray-600">学生注册完全免费。用学校邮箱认证后，就可以一键投递，并被认证企业在人才库里找到。</p>
    </Modal>
  ) : (
    <Modal
      open
      onClose={close}
      title={`投递：${job.title}`}
      footer={
        <>
          <Button variant="ghost" onClick={close}>取消</Button>
          <Button
            onClick={() => {
              actions.apply(job.id, note)
              toast(`已投递「${job.title}」`)
              close()
            }}
          >
            确认投递
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">选择简历</p>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-brand-500 bg-brand-50/50 p-3">
            <input type="radio" defaultChecked className="accent-brand-500" />
            <FileText className="size-5 text-brand-500" />
            <span className="flex-1 text-sm">{state.me.resumeName ?? '在线简历'}</span>
            <Tag tone="blue">主简历</Tag>
          </label>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">给 HR 的话（选填）</p>
          <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} placeholder="简单介绍你为什么适合这个岗位，最多 500 字" />
          <p className="mt-1 text-right text-xs text-gray-400">{note.length} / 500</p>
        </div>
        <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
          <ShieldCheck className="size-4 shrink-0" />
          投递后，{companyById(job.companyId).short}可以免费查看你的姓名和联系方式，用于安排面试。
        </p>
      </div>
    </Modal>
  ))
  // 资料完成度不够时先去补资料，带到第一个没填完的步骤（DECISIONS Q4）
  const start = (j: Job) => {
    if (state.role === 'student' && completeness(state.me).score < state.settings.applyMinCompleteness) {
      toast(`先把资料填到 ${state.settings.applyMinCompleteness}% 再投递`, 'info')
      return nav(`/s/onboarding?step=${firstIncompleteStep(state.me) ?? 1}`)
    }
    setJob(j)
  }
  return { start, modal }
}

export function ApplyButton({ job, start, size = 'md' }: { job: Job; start: (j: Job) => void; size?: 'md' | 'lg' }) {
  const { state } = useStore()
  const applied = state.role === 'student' && myApplication(state, job.id)
  if (job.status !== 'PUBLISHED') return <Button size={size} disabled>{job.status === 'CLOSED' ? '已停止招聘' : '审核中'}</Button>
  if (applied) return <Button size={size} variant="soft" disabled>已投递</Button>
  return <Button size={size} onClick={() => start(job)}>立即投递</Button>
}

/** 职位详情（职位页右栏和详情页共用） */
export type DetailAccess = 'open' | 'login' | 'locked' | 'preview'

/** 职位详情（职位页右栏和详情页共用）。access 不是 open 时只显示标题、公司和地点 */
export function JobDetailPanel({ job, start, compact, access = 'open', onOpen }: { job: Job; start: (j: Job) => void; compact?: boolean; access?: DetailAccess; onOpen?: () => void }) {
  const { state, actions } = useStore()
  const toast = useToast()
  const c = companyById(job.companyId)
  const saved = state.savedJobs.includes(job.id)
  if (access !== 'open') return <LockedDetail job={job} access={access} onOpen={onOpen} />
  return (
    <Card className="overflow-hidden">
      <div className={cn('border-b border-gray-100 bg-gradient-to-b from-brand-50/70 to-white p-5', !compact && 'md:p-6')}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900">{job.title}</h1>
              <Tag tone="blue">{JOB_TYPE_LABEL[job.type]}</Tag>
            </div>
            <div className="mt-2 text-xl font-semibold text-brand-500">{salaryText(job)}</div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
              <span className="flex items-center gap-1"><MapPin className="size-4" />{job.city}</span>
              <span className="flex items-center gap-1"><GraduationCap className="size-4" />{DEGREE_LABEL[job.degree]}</span>
              <span className="flex items-center gap-1"><Users className="size-4" />招 {job.headcount} 人</span>
              <span>{timeAgo(job.publishedAt)}发布</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="white"
              size="md"
              onClick={() => {
                if (state.role !== 'student') return toast('请先以学生身份登录', 'info')
                actions.toggleSaveJob(job.id)
                toast(saved ? '已取消收藏' : '已收藏')
              }}
            >
              <Star className={cn('size-4', saved && 'fill-amber-400 text-amber-400')} />{saved ? '已收藏' : '收藏'}
            </Button>
            <Button variant="white" onClick={() => toast('链接已复制（原型）', 'info')} aria-label="分享"><Share2 className="size-4" /></Button>
            <ApplyButton job={job} start={start} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {job.languages.map((l) => <Tag key={l}><Languages className="size-3" />{l}</Tag>)}
          <PassTags job={job} />
        </div>
      </div>
      <div className={cn('space-y-6 p-5', !compact && 'md:p-6')}>
        <section>
          <h3 className="mb-2 font-semibold">职位描述</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-gray-700">{job.description.map((d) => <li key={d}>{d}</li>)}</ul>
        </section>
        <section>
          <h3 className="mb-2 font-semibold">任职要求</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-gray-700">{job.requirements.map((d) => <li key={d}>{d}</li>)}</ul>
        </section>
        <section>
          <h3 className="mb-2 font-semibold">技能要求</h3>
          <div className="flex flex-wrap gap-1.5">{job.skills.map((s) => <Tag key={s} tone="blue">{s}</Tag>)}</div>
        </section>
        <section>
          <h3 className="mb-2 font-semibold">福利待遇</h3>
          <div className="flex flex-wrap gap-1.5">{c.benefits.map((b) => <Tag key={b} tone="amber">{b}</Tag>)}</div>
        </section>
        <section>
          <h3 className="mb-2 font-semibold">工作地点</h3>
          <div className="flex h-28 items-center justify-center rounded-lg bg-[repeating-linear-gradient(45deg,#f1f4fa,#f1f4fa_10px,#f7f9fc_10px,#f7f9fc_20px)] text-sm text-gray-500">
            <MapPin className="mr-1 size-4 text-brand-500" />{job.city}，{job.state}
          </div>
        </section>
        <CompanyBlock company={c} />
        <ReportJob job={job} />
      </div>
    </Card>
  )
}

function LockedDetail({ job, access, onOpen }: { job: Job; access: Exclude<DetailAccess, 'open'>; onOpen?: () => void }) {
  const { state } = useStore()
  const c = companyById(job.companyId)
  const q = myQuota(state)
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-gray-100 bg-gradient-to-b from-brand-50/70 to-white p-5">
        <h1 className="text-xl font-semibold text-gray-900">{job.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
          <span className="flex items-center gap-1"><Building2 className="size-4" />{c.short}</span>
          <span className="flex items-center gap-1"><MapPin className="size-4" />{job.state}</span>
        </div>
      </div>
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-brand-50 text-brand-500"><Lock className="size-6" /></span>
        {access === 'preview' && (
          <>
            <p className="font-medium text-gray-900">点开职位才会显示详情</p>
            <p className="text-sm text-gray-500">每次点开一个新职位，用掉 1 次查看额度{q.limit !== null && `（已用 ${q.used} / ${q.limit}）`}。</p>
            <Button onClick={onOpen}>查看详情</Button>
          </>
        )}
        {access === 'login' && (
          <>
            <p className="font-medium text-gray-900">登录后查看职位详情</p>
            <p className="text-sm text-gray-500">注册免费，每人先送 {state.settings.baseJobViews} 次查看额度，邀请同学还能再加。</p>
            <Link to="/login" className="inline-flex h-10 items-center rounded-lg bg-brand-500 px-5 text-sm font-medium text-white hover:bg-brand-600">登录 / 注册</Link>
          </>
        )}
        {access === 'locked' && (
          <>
            <p className="font-medium text-gray-900">查看额度用完了（{q.used} / {q.limit}）</p>
            <p className="text-sm text-gray-500">已经投递的职位和企业邀请你投递的职位不受影响，随时可以打开。</p>
            <Link to="/s/invite" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-500 px-5 text-sm font-medium text-white hover:bg-brand-600">
              <UserPlus className="size-4" />{q.next ? (q.next.bonus === 'UNLIMITED' ? `再邀请 ${q.next.need} 位同学，不限次数查看` : `再邀请 ${q.next.need} 位同学，多看 ${q.next.bonus} 个`) : '邀请同学'}
            </Link>
            {state.settings.studentBillingEnabled && <Button variant="ghost" disabled>购买额度（即将开放）</Button>}
          </>
        )}
      </div>
    </Card>
  )
}

const REASONS = Object.keys(REPORT_REASON_LABEL) as JobReportReason[]

/** 职位举报：进运营队列（PRD v0.2 §2.6） */
function ReportJob({ job }: { job: Job }) {
  const { state, actions } = useStore()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<JobReportReason>('ASKS_PAYMENT')
  const [note, setNote] = useState('')
  if (state.role !== 'student' && state.role !== 'guest') return null
  return (
    <div className="flex justify-end">
      <button type="button" onClick={() => setOpen(true)} className="flex cursor-pointer items-center gap-1 text-xs text-gray-400 hover:text-red-500"><Flag className="size-3.5" />举报这个职位</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="举报职位"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>取消</Button><Button onClick={() => { actions.reportJob(job.id, reason, note.trim()); setOpen(false); setNote(''); toast('已收到，运营会尽快处理') }}>提交</Button></>}
      >
        <div className="space-y-3">
          <Select value={reason} onChange={(e) => setReason(e.target.value as JobReportReason)} aria-label="举报原因">
            {REASONS.map((r) => <option key={r} value={r}>{REPORT_REASON_LABEL[r]}</option>)}
          </Select>
          <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} placeholder="补充说明（选填）" />
          <p className="text-xs text-gray-500">遇到要求先交钱、扣证件等情况，先别转账，看看<Link to="/safety" className="text-brand-500">反诈专区</Link>。</p>
        </div>
      </Modal>
    </div>
  )
}

const TAG_TONE: Partial<Record<CompanyTag, 'red' | 'blue' | 'amber'>> = { SOE: 'red', ALUMNI: 'blue', FORTUNE_500: 'amber' }

export function CompanyBadges({ company }: { company: Company }) {
  return (
    <>
      {company.tags.slice(0, 2).map((t) => <Tag key={t} tone={TAG_TONE[t] ?? 'gray'}>{COMPANY_TAG_LABEL[t]}</Tag>)}
      {company.founding && <Tag tone="amber"><Star className="size-3 fill-current" />创始合作伙伴</Tag>}
      <Tag tone="green"><BadgeCheck className="size-3" />已认证</Tag>
    </>
  )
}

function CompanyBlock({ company }: { company: Company }) {
  return (
    <section className="rounded-xl border border-gray-100 p-4">
      <div className="flex items-center gap-3">
        <CompanyLogo company={company} size={48} />
        <div className="min-w-0">
          <Link to={`/companies/${company.id}`} className="font-semibold hover:text-brand-500">{company.name}</Link>
          <div className="mt-1 flex flex-wrap gap-1.5"><CompanyBadges company={company} /></div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
        <span className="flex items-center gap-1"><Briefcase className="size-4" />{industryName(company.industryCode)}</span>
        <span className="flex items-center gap-1"><Users className="size-4" />{company.size}</span>
        <span className="flex items-center gap-1"><Building2 className="size-4" />{company.city}</span>
      </div>
      <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-gray-600">{company.intro}</p>
    </section>
  )
}

export function CompanyCard({ company, jobCount }: { company: Company; jobCount: number }) {
  return (
    <Link to={`/companies/${company.id}`} className="group block overflow-hidden rounded-xl border border-transparent bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:border-brand-200 hover:shadow-md">
      <div className="h-14" style={{ background: `linear-gradient(120deg, ${company.color}26, ${company.color}0d)` }} />
      <div className="-mt-7 px-4 pb-4">
        <CompanyLogo company={company} size={52} className="ring-4 ring-white" />
        <p className="mt-2 truncate font-medium text-gray-900 group-hover:text-brand-500">{company.short}</p>
        <p className="mt-0.5 truncate text-xs text-gray-400">{industryName(company.industryCode)} · {company.size} · {company.state}</p>
        <div className="mt-2 flex flex-wrap gap-1"><CompanyBadges company={company} /></div>
        <p className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-500">在招 <span className="font-semibold text-brand-500">{jobCount}</span> 个职位</p>
      </div>
    </Link>
  )
}

export function PartnerWall({ partners }: { partners: Partner[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {partners.map((p) => (
        <div key={p.id} className="flex flex-col items-center rounded-xl bg-white p-4 text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <span className="grid size-12 place-items-center rounded-full text-lg font-bold text-white" style={{ background: p.color }}>{p.name[0]}</span>
          <p className="mt-2 text-sm font-medium leading-snug text-gray-800">{p.name}</p>
          <p className="mt-1 text-xs text-gray-400">{p.type}</p>
        </div>
      ))}
    </div>
  )
}

