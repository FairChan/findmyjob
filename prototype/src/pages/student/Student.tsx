import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Bell, Check, Download, Eye, FileText, Gift, Inbox, Mail, Send, Shield, ShieldOff, Star, Trash2, Unlock, UserX } from 'lucide-react'
import { APP_STATUS_LABEL, COMPANIES, JOB_TYPE_LABEL, companyById, schoolById, type AppStatus } from '../../data/mock'
import { ME_ID, myQuota, useStore } from '../../store'
import { cn, formatDate, formatDateTime, salaryText, timeAgo } from '../../lib/utils'
import { Avatar, Button, Card, CompanyLogo, Empty, Modal, Select, Tag, Toggle, buttonClass } from '../../components/ui'
import { JobCard } from '../../components/jobs'
import { useToast } from '../../components/toast'

export function StudentLayout() {
  const { state } = useStore()
  const myApps = state.applications.filter((a) => a.studentId === ME_ID && !['WITHDRAWN', 'REJECTED', 'HIRED'].includes(a.status))
  const newInv = state.invitations.filter((i) => i.studentId === ME_ID && i.status === 'SENT').length
  const unread = state.notices.filter((n) => n.to === 'student' && !n.read).length
  const q = myQuota(state)
  const items = [
    { to: '/s/resume', label: '我的简历', icon: FileText },
    { to: '/s/applications', label: '投递记录', icon: Send, count: myApps.length },
    { to: '/s/invitations', label: '收到的邀请', icon: Mail, count: newInv, hot: true },
    { to: '/s/saved', label: '收藏的职位', icon: Star, count: state.savedJobs.length },
    { to: '/s/invite', label: q.limit === null ? '邀请好友' : `邀请好友 · 剩 ${Math.max(0, q.limit - q.used)}`, icon: Gift },
    { to: '/s/privacy', label: '隐私中心', icon: Shield },
    { to: '/s/notifications', label: '消息通知', icon: Bell, count: unread, hot: true },
  ]
  return (
    <div className="wrap flex flex-col gap-5 py-6 md:flex-row">
      <aside className="shrink-0 md:w-56">
        <Card className="p-2 md:sticky md:top-20">
          <div className="hidden items-center gap-3 border-b border-gray-100 p-3 md:flex">
            <Avatar name={state.me.fullName} size={40} />
            <div className="min-w-0"><p className="truncate font-medium">{state.me.fullName}</p><p className="truncate text-xs text-gray-400">{schoolById(state.me.schoolId)?.short}</p></div>
          </div>
          <nav className="flex gap-1 overflow-x-auto md:mt-2 md:flex-col">
            {items.map(({ to, label, icon: Icon, count, hot }) => (
              <NavLink key={to} to={to} className={({ isActive }) => cn('flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm', isActive ? 'bg-brand-50 font-medium text-brand-600' : 'text-gray-600 hover:bg-gray-50')}>
                <Icon className="size-4" />{label}
                {!!count && <span className={cn('ml-auto rounded-full px-1.5 text-xs', hot ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-500')}>{count}</span>}
              </NavLink>
            ))}
          </nav>
        </Card>
      </aside>
      <main className="min-w-0 flex-1"><Outlet /></main>
    </div>
  )
}

const STEPS: AppStatus[] = ['APPLIED', 'VIEWED', 'SHORTLISTED', 'INTERVIEW', 'OFFER']
const STUDENT_LABEL: Partial<Record<AppStatus, string>> = { APPLIED: '已投递' }

function Stepper({ status }: { status: AppStatus }) {
  const idx = STEPS.indexOf(status === 'HIRED' ? 'OFFER' : status)
  return (
    <div className="flex items-center">
      {STEPS.map((s, i) => (
        <div key={s} className="flex flex-1 items-center last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <span className={cn('grid size-5 place-items-center rounded-full text-[10px]', i <= idx ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-400')}>{i < idx ? <Check className="size-3" /> : i + 1}</span>
            <span className={cn('whitespace-nowrap text-[11px]', i <= idx ? 'text-brand-600' : 'text-gray-400')}>{STUDENT_LABEL[s] ?? APP_STATUS_LABEL[s]}</span>
          </div>
          {i < STEPS.length - 1 && <span className={cn('mx-1 mb-4 h-0.5 flex-1', i < idx ? 'bg-brand-500' : 'bg-gray-100')} />}
        </div>
      ))}
    </div>
  )
}

export function Applications() {
  const { state, actions } = useStore()
  const toast = useToast()
  const [tab, setTab] = useState<'all' | 'active' | 'done'>('all')
  const mine = state.applications.filter((a) => a.studentId === ME_ID)
  const done = (s: AppStatus) => ['WITHDRAWN', 'REJECTED', 'HIRED'].includes(s)
  const list = mine.filter((a) => tab === 'all' || (tab === 'done' ? done(a.status) : !done(a.status)))
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">投递记录</h1>
        <div className="flex rounded-lg bg-white p-1 text-sm shadow-sm">
          {([['all', '全部'], ['active', '进行中'], ['done', '已结束']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={cn('cursor-pointer rounded-md px-3 py-1', tab === k ? 'bg-brand-500 text-white' : 'text-gray-500')}>{l}</button>
          ))}
        </div>
      </div>
      {list.length === 0 && <Card><Empty icon={<Inbox className="size-12" />} title="还没有投递记录" action={<Link to="/jobs" className={buttonClass('primary')}>去看看职位</Link>} /></Card>}
      <div className="space-y-3">
        {list.map((a) => {
          const job = state.jobs.find((j) => j.id === a.jobId)!
          const c = companyById(job.companyId)
          return (
            <Card key={a.id} className="p-5">
              <div className="flex flex-wrap items-start gap-4">
                <CompanyLogo company={c} size={44} />
                <div className="min-w-0 flex-1">
                  <Link to={`/jobs/${job.id}`} className="font-semibold hover:text-brand-500">{job.title}</Link>
                  <p className="mt-0.5 text-sm text-gray-500">{c.short} · {salaryText(job)} · {JOB_TYPE_LABEL[job.type]}</p>
                  <p className="mt-0.5 text-xs text-gray-400">投递于 {formatDate(a.createdAt)}</p>
                </div>
                {a.status === 'REJECTED' && <Tag tone="red">不合适</Tag>}
                {a.status === 'WITHDRAWN' && <Tag>已撤回</Tag>}
                {a.status === 'HIRED' && <Tag tone="green">已录用</Tag>}
                {['APPLIED', 'VIEWED'].includes(a.status) && (
                  <Button variant="ghost" size="sm" onClick={() => { actions.withdraw(a.id); toast('已撤回投递') }}>撤回</Button>
                )}
              </div>
              {!['REJECTED', 'WITHDRAWN'].includes(a.status) && <div className="mt-4 max-w-xl"><Stepper status={a.status} /></div>}
              {a.status === 'REJECTED' && <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-500">企业认为暂时不太合适。别灰心，可以看看相似职位。</p>}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export function Invitations() {
  const { state, actions } = useStore()
  const toast = useToast()
  const list = state.invitations.filter((i) => i.studentId === ME_ID)
  const statusTag = { SENT: <Tag tone="orange">待回复</Tag>, ACCEPTED: <Tag tone="green">已接受</Tag>, DECLINED: <Tag>已婉拒</Tag>, EXPIRED: <Tag>已过期</Tag> }
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">收到的邀请</h1>
      <p className="mb-4 text-sm text-gray-500">企业在人才库看到你后发来的投递邀请。接受即视为投递该职位。</p>
      {list.length === 0 && <Card><Empty icon={<Mail className="size-12" />} title="还没有收到邀请" desc="完善简历、开启人才库，企业更容易找到你" /></Card>}
      <div className="space-y-3">
        {list.map((inv) => {
          const job = state.jobs.find((j) => j.id === inv.jobId)!
          const c = companyById(inv.companyId)
          return (
            <Card key={inv.id} className={cn('p-5', inv.status === 'SENT' && 'border-brand-200')}>
              <div className="flex flex-wrap items-start gap-4">
                <CompanyLogo company={c} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{c.short} 邀请你投递「<Link to={`/jobs/${job.id}`} className="text-brand-500 hover:underline">{job.title}</Link>」</p>
                  <p className="mt-0.5 text-sm text-gray-500">{salaryText(job)} · {job.city} · {timeAgo(inv.createdAt)}</p>
                </div>
                {statusTag[inv.status]}
              </div>
              <blockquote className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">“{inv.message}”</blockquote>
              {inv.status === 'SENT' && (
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => { actions.respondInvitation(inv.id, false); toast('已婉拒') }}>婉拒</Button>
                  <Button onClick={() => { actions.respondInvitation(inv.id, true); toast(`已投递「${job.title}」，${c.short}现在可以联系你`) }}>接受并投递</Button>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export function Saved() {
  const { state } = useStore()
  const jobs = state.savedJobs.map((id) => state.jobs.find((j) => j.id === id)).filter((j) => j !== undefined)
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">收藏的职位</h1>
      {jobs.length === 0 ? <Card><Empty icon={<Star className="size-12" />} title="还没有收藏职位" /></Card> : <div className="grid gap-4 sm:grid-cols-2">{jobs.map((j) => <JobCard key={j.id} job={j} />)}</div>}
    </div>
  )
}

export function Privacy() {
  const { state, actions } = useStore()
  const toast = useToast()
  const [pick, setPick] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const me = state.me
  const blockable = COMPANIES.filter((c) => !state.blockedCompanies.includes(c.id))
  const recent = (d: string) => Date.now() - new Date(d).getTime() < 90 * 86_400_000
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">隐私中心</h1>
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">加入人才库</h2>
            <p className="mt-1 text-sm text-gray-500">开启后，认证企业可以搜到你的匿名档案，并在付费解锁后联系你。关闭后企业搜不到你，但你仍然可以投递。</p>
          </div>
          <Toggle label="加入人才库" checked={me.visibility === 'PUBLIC'} onChange={(v) => { actions.setVisibility(v ? 'PUBLIC' : 'HIDDEN'); toast(v ? '已加入人才库' : '已退出人才库') }} />
        </div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="font-medium text-gray-700">解锁前，企业能看到</p>
            <p className="mt-1 text-gray-500">姓氏 + “同学”、学校、专业、毕业年份、工作资格、语言、技能、经历（其中的联系方式自动隐藏）</p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-3">
            <p className="font-medium text-emerald-800">解锁后 / 你投递后，企业还能看到</p>
            <p className="mt-1 text-emerald-700">全名、手机、邮箱、WhatsApp、微信、原始简历（带水印）</p>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-1.5 font-semibold"><ShieldOff className="size-4" />屏蔽企业</h2>
        <p className="mt-1 text-sm text-gray-500">被屏蔽的企业搜不到你；即使之前解锁过，也不再显示你的联系方式。</p>
        <div className="mt-3 flex gap-2">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} className="max-w-xs">
            <option value="">选择要屏蔽的企业</option>
            {blockable.map((c) => <option key={c.id} value={c.id}>{c.short}</option>)}
          </Select>
          <Button variant="outline" disabled={!pick} onClick={() => { actions.toggleBlock(pick); toast(`已屏蔽${companyById(pick).short}`); setPick('') }}>屏蔽</Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {state.blockedCompanies.map((id) => (
            <span key={id} className="flex items-center gap-2 rounded-full bg-gray-100 py-1 pl-3 pr-1 text-sm">
              <UserX className="size-3.5 text-gray-400" />{companyById(id).short}
              <button className="cursor-pointer rounded-full px-2 text-xs text-brand-500 hover:bg-white" onClick={() => actions.toggleBlock(id)}>解除</button>
            </span>
          ))}
          {state.blockedCompanies.length === 0 && <span className="text-sm text-gray-400">暂未屏蔽任何企业</span>}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="flex items-center gap-1.5 font-semibold"><Eye className="size-4" />谁看过我（近 90 天）</h2>
          <ul className="mt-3 divide-y divide-gray-50">
            {state.viewsOfMe.filter((v) => recent(v.at)).map((v) => (
              <li key={v.companyId + v.at} className="flex items-center gap-3 py-2.5 text-sm">
                <CompanyLogo company={companyById(v.companyId)} size={28} className="rounded-md" />
                <span className="flex-1">{companyById(v.companyId).short}</span>
                <span className="text-xs text-gray-400">{timeAgo(v.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h2 className="flex items-center gap-1.5 font-semibold"><Unlock className="size-4" />谁能联系我</h2>
          <ul className="mt-3 divide-y divide-gray-50">
            {state.unlocksOfMe.map((u) => (
              <li key={u.companyId + u.at} className="flex items-center gap-3 py-2.5 text-sm">
                <CompanyLogo company={companyById(u.companyId)} size={28} className="rounded-md" />
                <span className="flex-1">{companyById(u.companyId).short}</span>
                <Tag tone={u.source === 'CREDIT' ? 'orange' : 'blue'}>{u.source === 'CREDIT' ? '企业付费解锁' : '你投递了该企业'}</Tag>
                <span className="text-xs text-gray-400">{formatDate(u.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold">我的数据</h2>
        <p className="mt-1 text-sm text-gray-500">按马来西亚《个人资料保护法》（PDPA），你可以随时导出或删除自己的数据，我们会在 21 天内处理。</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="white" onClick={() => { actions.exportData(); toast('导出任务已创建，完成后会发送下载链接到你的邮箱（原型）') }}><Download className="size-4" />导出我的数据</Button>
          <Button variant="white" className="text-red-500" onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" />注销账号</Button>
        </div>
      </Card>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="确认注销账号？" footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button><Button variant="danger" onClick={() => { setConfirmDelete(false); toast('已提交注销申请。你的档案已从人才库移除，30 天后彻底删除（原型）', 'info') }}>确认注销</Button></>}>
        <p className="text-sm text-gray-600">注销后，你会立即从人才库消失；联系方式和简历文件会在 30 天后彻底删除。这个操作无法撤销。</p>
      </Modal>
    </div>
  )
}

export function Notifications() {
  const { state, actions } = useStore()
  const list = state.notices.filter((n) => n.to === 'student')
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">消息通知</h1>
        <Button variant="ghost" size="sm" onClick={() => actions.markRead('student')}>全部已读</Button>
      </div>
      <Card className="divide-y divide-gray-50">
        {list.length === 0 && <Empty title="暂无消息" />}
        {list.map((n) => (
          <Link key={n.id} to={n.link ?? '#'} className="flex items-start gap-3 p-4 hover:bg-gray-50">
            <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-gray-200' : 'bg-red-500')} />
            <span className="flex-1 text-sm">{n.text}</span>
            <span className="shrink-0 text-xs text-gray-400">{formatDateTime(n.at)}</span>
          </Link>
        ))}
      </Card>
    </div>
  )
}
