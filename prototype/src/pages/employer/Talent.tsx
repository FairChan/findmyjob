import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Coins, Copy, Download, EyeOff, FileText, Lock, Mail, MessageCircle, Phone, SearchX, Send, SlidersHorizontal, Star, Unlock } from 'lucide-react'
import {
  DEGREE_LABEL, JOB_TYPE_LABEL, LANG_LEVEL_LABEL, LANG_LEVEL_RANK, SCHOOLS, WORK_AUTH_LABEL, schoolById,
  type Degree, type JobType, type LangLevel, type WorkAuth,
} from '../../data/mock'
import { getStudent, hasAccess, talentPool, useStore } from '../../store'
import { completeness, maskName, redact } from '../../lib/privacy'
import { toStandardRow } from '../../lib/standard-resume'
import { cn, formatDate, timeAgo, toggleIn } from '../../lib/utils'
import { Avatar, Button, Card, Chip, Empty, Input, Modal, Select, Tag } from '../../components/ui'
import { TalentCard, WatermarkModal, authTone, useInviteFlow } from '../../components/talent'
import { useToast } from '../../components/toast'

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-gray-100 py-4 last:border-0">
      <p className="mb-2.5 text-sm font-medium text-gray-700">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

export function TalentSearch() {
  const { state } = useStore()
  const { open: invite, modal } = useInviteFlow()
  const [kw, setKw] = useState('')
  const [schools, setSchools] = useState<string[]>([])
  const [degrees, setDegrees] = useState<Degree[]>([])
  const [years, setYears] = useState<number[]>([])
  const [intents, setIntents] = useState<JobType[]>([])
  const [auths, setAuths] = useState<WorkAuth[]>([])
  const [langs, setLangs] = useState<string[]>([])
  const [minLevel, setMinLevel] = useState<LangLevel>('FLUENT')
  const [onlyLocked, setOnlyLocked] = useState(false)
  const [sort, setSort] = useState<'active' | 'complete' | 'grad'>('active')
  const [showFilters, setShowFilters] = useState(false)

  const list = useMemo(() => {
    const k = kw.trim().toLowerCase()
    return talentPool(state)
      .filter((s) => {
        if (k && ![s.major, s.headline, ...s.skills, ...s.experiences.map((e) => e.title)].join(' ').toLowerCase().includes(k)) return false
        if (schools.length && !schools.includes(s.schoolId)) return false
        if (degrees.length && !degrees.includes(s.degree)) return false
        if (years.length && !years.includes(s.gradYear)) return false
        if (intents.length && !intents.some((i) => s.intents.includes(i))) return false
        if (auths.length && !auths.includes(s.workAuth)) return false
        if (langs.length && !langs.every((l) => s.languages.some((x) => x.lang === l && LANG_LEVEL_RANK[x.level] >= LANG_LEVEL_RANK[minLevel]))) return false
        if (onlyLocked && hasAccess(state, s.id)) return false
        return true
      })
      .sort((a, b) =>
        sort === 'active' ? +new Date(b.lastActive) - +new Date(a.lastActive)
          : sort === 'complete' ? completeness(b).score - completeness(a).score
            : a.gradYear * 12 + a.gradMonth - (b.gradYear * 12 + b.gradMonth),
      )
  }, [state, kw, schools, degrees, years, intents, auths, langs, minLevel, onlyLocked, sort])

  const reset = () => {
    setKw(''); setSchools([]); setDegrees([]); setYears([]); setIntents([]); setAuths([]); setLangs([]); setOnlyLocked(false)
  }

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      <aside className={cn('shrink-0 lg:block lg:w-72', !showFilters && 'hidden')}>
        <Card className="px-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto">
          <div className="flex items-center justify-between border-b border-gray-100 py-3">
            <span className="font-semibold">筛选人才</span>
            <button className="cursor-pointer text-xs text-gray-400 hover:text-brand-500" onClick={reset}>清空</button>
          </div>
          <FilterGroup title="学校">{SCHOOLS.map((s) => <Chip key={s.id} active={schools.includes(s.id)} onClick={() => setSchools(toggleIn(schools, s.id))}>{s.short}</Chip>)}</FilterGroup>
          <FilterGroup title="学历">{(['DIPLOMA', 'BACHELOR', 'MASTER'] as Degree[]).map((d) => <Chip key={d} active={degrees.includes(d)} onClick={() => setDegrees(toggleIn(degrees, d))}>{DEGREE_LABEL[d]}</Chip>)}</FilterGroup>
          <FilterGroup title="毕业年份">{[2026, 2027, 2028].map((y) => <Chip key={y} active={years.includes(y)} onClick={() => setYears(toggleIn(years, y))}>{y} 届</Chip>)}</FilterGroup>
          <FilterGroup title="求职类型">{(Object.keys(JOB_TYPE_LABEL) as JobType[]).map((t) => <Chip key={t} active={intents.includes(t)} onClick={() => setIntents(toggleIn(intents, t))}>{JOB_TYPE_LABEL[t]}</Chip>)}</FilterGroup>
          <FilterGroup title="工作资格">{(['MY_CITIZEN', 'MY_PR', 'STUDENT_PASS', 'NEEDS_WORK_PASS'] as WorkAuth[]).map((a) => <Chip key={a} active={auths.includes(a)} onClick={() => setAuths(toggleIn(auths, a))}>{WORK_AUTH_LABEL[a]}</Chip>)}</FilterGroup>
          <FilterGroup title="语言要求（同时满足）">
            {['中文', '英文', '马来文', '粤语'].map((l) => <Chip key={l} active={langs.includes(l)} onClick={() => setLangs(toggleIn(langs, l))}>{l}</Chip>)}
            <Select value={minLevel} onChange={(e) => setMinLevel(e.target.value as LangLevel)} className="mt-1 h-9">
              {(['CONVERSATIONAL', 'FLUENT', 'NATIVE'] as LangLevel[]).map((l) => <option key={l} value={l}>至少：{LANG_LEVEL_LABEL[l]}</option>)}
            </Select>
          </FilterGroup>
          <div className="py-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={onlyLocked} onChange={(e) => setOnlyLocked(e.target.checked)} className="accent-brand-500" />只看未解锁的人才</label>
          </div>
        </Card>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索专业、技能、经历，如：React、会计、翻译" className="h-10 min-w-0 flex-1 bg-white" />
          <Button variant="white" className="lg:hidden" onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal className="size-4" />筛选</Button>
          <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-36 bg-white">
            <option value="active">最近活跃</option>
            <option value="complete">简历完整度</option>
            <option value="grad">毕业时间</option>
          </Select>
        </div>
        <p className="mb-3 text-sm text-gray-500">共 <b className="text-brand-500">{list.length}</b> 位人才 · 解锁前只显示姓氏，联系方式和原始简历隐藏</p>
        <div className="space-y-3">
          {list.map((s) => <TalentCard key={s.id} student={s} onInvite={invite} />)}
          {list.length === 0 && <Card><Empty icon={<SearchX className="size-12" />} title="没有符合条件的人才" desc="放宽语言程度或学校条件试试" /></Card>}
        </div>
      </div>
      {modal}
    </div>
  )
}

export function Favorites() {
  const { state } = useStore()
  const { open: invite, modal } = useInviteFlow()
  const list = state.talentFavorites.map((id) => getStudent(state, id)).filter((s) => s !== undefined)
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">收藏夹</h1>
      <p className="mb-4 text-sm text-gray-500">团队共享，所有成员都能看到</p>
      <div className="space-y-3">
        {list.map((s) => <TalentCard key={s.id} student={s} onInvite={invite} />)}
        {list.length === 0 && <Card><Empty icon={<Star className="size-12" />} title="还没有收藏人才" action={<Link to="/e/talent" className="text-brand-500">去人才库看看</Link>} /></Card>}
      </div>
      {modal}
    </div>
  )
}

function Row({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  const toast = useToast()
  return (
    <div className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2.5">
      <span className="text-gray-400">{icon}</span>
      <div className="min-w-0 flex-1"><p className="text-xs text-gray-400">{label}</p><p className="truncate text-sm font-medium">{value || '未填写'}</p></div>
      {value && <button className="cursor-pointer text-gray-400 hover:text-brand-500" aria-label={`复制${label}`} onClick={() => { navigator.clipboard?.writeText(value); toast(`已复制${label}`) }}><Copy className="size-4" /></button>}
    </div>
  )
}

export function TalentDetail() {
  const { id = '' } = useParams()
  const { state, actions } = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const { open: invite, modal } = useInviteFlow()
  const [confirm, setConfirm] = useState(false)
  const [lack, setLack] = useState(false)
  const [watermark, setWatermark] = useState(false)
  const s = getStudent(state, id)
  const visible = s && (talentPool(state).some((x) => x.id === id) || hasAccess(state, id))
  useEffect(() => {
    // 只在打开页面时记录一次查看；看不到的档案不记录
    if (visible) actions.viewProfile(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  if (!s || !visible)
    return <Card><Empty icon={<EyeOff className="size-12" />} title="该人才档案不可见" desc="学生可能关闭了人才库，或屏蔽了贵公司" action={<Link to="/e/talent" className="text-brand-500">返回人才库</Link>} /></Card>

  const unlocked = hasAccess(state, id)
  const unlock = state.unlocks.find((u) => u.studentId === id)
  const T = (t: string) => (unlocked ? t : redact(t))
  const name = unlocked ? s.fullName : maskName(s.fullName)
  const cost = state.settings.unlockCost
  const fav = state.talentFavorites.includes(id)

  const doUnlock = () => {
    setConfirm(false)
    const r = actions.unlock(id)
    if (r === 'ok') toast(`解锁成功，已扣除 ${cost} 点`)
    else if (r === 'insufficient') setLack(true)
  }

  return (
    <div>
      <button onClick={() => nav(-1)} className="mb-4 flex cursor-pointer items-center gap-1 text-sm text-gray-500 hover:text-brand-500"><ArrowLeft className="size-4" />返回</button>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <StandardCard row={toStandardRow(s, { masked: !unlocked })} />
          <Card className="p-5">
            <div className="flex flex-wrap items-start gap-4">
              <Avatar name={name} size={64} masked={!unlocked} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold">{name}</h1>
                  <Tag tone={authTone(s.workAuth)}>{WORK_AUTH_LABEL[s.workAuth]}</Tag>
                  {unlocked && <Tag tone="green"><Unlock className="size-3" />已解锁</Tag>}
                </div>
                <p className="mt-1 text-sm text-gray-500">{schoolById(s.schoolId)?.name} · {DEGREE_LABEL[s.degree]} · {s.major} · {s.gradYear} 年 {s.gradMonth} 月毕业</p>
                <p className="mt-1 text-xs text-gray-400">{timeAgo(s.lastActive)}活跃 · 简历完整度 {completeness(s).score}%</p>
              </div>
            </div>
            <p className="mt-4 rounded-lg bg-brand-50/60 p-3 text-sm font-medium text-gray-800">“{s.headline}”</p>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">求职意向</h2>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-gray-400">类型</dt><dd className="mt-1 flex gap-1.5">{s.intents.map((t) => <Tag key={t} tone="blue">{JOB_TYPE_LABEL[t]}</Tag>)}</dd></div>
              <div><dt className="text-gray-400">意向地区</dt><dd className="mt-1">{s.states.join('、')}</dd></div>
              <div><dt className="text-gray-400">最早到岗</dt><dd className="mt-1">{s.availableFrom}</dd></div>
              <div><dt className="text-gray-400">期望薪资</dt><dd className="mt-1">{s.expectedSalary}</dd></div>
            </dl>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">自我介绍</h2>
            <p className="text-sm leading-relaxed text-gray-700">{T(s.summary) || '未填写'}</p>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">经历</h2>
            <div className="space-y-4">
              {s.experiences.map((e) => (
                <div key={e.id} className="border-l-2 border-brand-100 pl-4">
                  <div className="flex flex-wrap items-center gap-2"><Tag>{e.kind}</Tag><span className="font-medium">{e.title}</span><span className="text-sm text-gray-500">{e.org}</span><span className="ml-auto text-xs text-gray-400">{e.period}</span></div>
                  <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{T(e.desc)}</p>
                </div>
              ))}
            </div>
            {!unlocked && <p className="mt-4 text-xs text-gray-400">自由文本里的电话、邮箱、网址、微信号已自动替换为 [已隐藏]</p>}
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">语言与技能</h2>
            <div className="flex flex-wrap gap-1.5">
              {s.languages.map((l) => <Tag key={l.lang}>{l.lang} · {LANG_LEVEL_LABEL[l.level]}</Tag>)}
              {s.skills.map((k) => <Tag key={k} tone="blue">{k}</Tag>)}
            </div>
            <h2 className="mb-2 mt-5 font-semibold">教育</h2>
            {s.education.map((e) => <p key={e.school} className="text-sm text-gray-600">{e.school} · {DEGREE_LABEL[e.degree]} · {e.major} · {e.period}{e.gpa && ` · GPA ${e.gpa}`}</p>)}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="overflow-hidden lg:sticky lg:top-20">
            {unlocked ? (
              <>
                <div className="bg-emerald-50 px-5 py-3 text-sm text-emerald-800">
                  <Unlock className="mr-1 inline size-4" />
                  {unlock?.source === 'APPLICATION' ? '该学生投递过贵公司，可免费联系' : `已于 ${formatDate(unlock!.at)} 解锁，团队共享`}
                </div>
                <div className="space-y-2 p-5">
                  <Row icon={<Phone className="size-4" />} label="手机" value={s.contact.phone} />
                  <Row icon={<Mail className="size-4" />} label="邮箱" value={s.contact.email} />
                  <Row icon={<MessageCircle className="size-4" />} label="WhatsApp" value={s.contact.whatsapp} />
                  <Row icon={<MessageCircle className="size-4" />} label="微信" value={s.contact.wechat} />
                  <Button className="mt-2 w-full" onClick={() => { actions.downloadResume(id); setWatermark(true) }}><Download className="size-4" />下载简历（带水印）</Button>
                </div>
              </>
            ) : (
              <div className="p-5">
                <div className="flex items-center gap-2 font-semibold"><Lock className="size-5 text-gray-400" />联系方式已隐藏</div>
                <div className="mt-4 space-y-2 text-sm text-gray-300">
                  <p className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5"><Phone className="size-4" />+60 ●● ●●●● ●●●●</p>
                  <p className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5"><Mail className="size-4" />●●●●●●@●●●●.com</p>
                  <p className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5"><FileText className="size-4" />原始简历 PDF</p>
                </div>
                <Button size="lg" className="mt-4 w-full" onClick={() => setConfirm(true)}><Unlock className="size-4" />解锁联系方式（{cost} 点）</Button>
                <p className="mt-2 text-center text-xs text-gray-400"><Coins className="mr-0.5 inline size-3.5" />当前余额 {state.credits} 点</p>
                <ul className="mt-4 space-y-1 border-t border-gray-100 pt-4 text-xs text-gray-500">
                  <li>· 同一学生只需解锁一次，团队成员共享</li>
                  <li>· 学生会收到“某企业解锁了你”的通知</li>
                  <li>· 也可以发「邀请投递」，学生接受后免费查看</li>
                </ul>
              </div>
            )}
          </Card>
          <Card className="flex gap-2 p-4">
            <Button variant="outline" className="flex-1" onClick={() => invite(s)}><Send className="size-4" />邀请投递</Button>
            <Button variant="white" className="flex-1" onClick={() => { actions.toggleTalentFavorite(id); toast(fav ? '已取消收藏' : '已加入收藏夹') }}>
              <Star className={cn('size-4', fav && 'fill-amber-400 text-amber-400')} />{fav ? '已收藏' : '收藏'}
            </Button>
          </Card>
        </aside>
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="确认解锁" footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>取消</Button><Button onClick={doUnlock}>确认解锁</Button></>}>
        <p className="text-sm text-gray-600">将消耗 <b className="text-brand-600">{cost} 点</b> 解锁 {name} 的联系方式和原始简历。解锁后团队所有成员都可以查看，学生会收到通知。</p>
        <p className="mt-3 text-sm text-gray-500">当前余额 {state.credits} 点 → 解锁后 {state.credits - cost} 点</p>
      </Modal>
      <Modal
        open={lack}
        onClose={() => setLack(false)}
        title="点数不足"
        footer={state.settings.billingEnabled ? <Button onClick={() => nav('/e/billing')}>去购买点数</Button> : <Button onClick={() => setLack(false)}>知道了</Button>}
      >
        <p className="text-sm text-gray-600">
          {state.settings.billingEnabled
            ? '当前余额不足，购买点数包或年度会员后即可继续解锁。'
            : `公益期每月 1 日自动补足到 ${state.settings.pilotMonthlyCredits} 点。你也可以先发「邀请投递」，学生接受后免费查看联系方式。`}
        </p>
      </Modal>
      {watermark && <WatermarkModal student={s} onClose={() => setWatermark(false)} />}
      {modal}
    </div>
  )
}

/** 标准化简历摘要：每个人同一格式，HR 一眼对比（PRD v0.2 §3.4） */
function StandardCard({ row }: { row: ReturnType<typeof toStandardRow> }) {
  const cells: [string, string | number][] = [
    ['学校', row.school], ['专业', row.major], ['学历', row.degree], ['毕业', row.grad], ['CGPA', row.cgpa],
    ['工作资格', row.workAuth], ['语言', row.languages], ['实习', row.internships], ['校园经历', row.campus], ['完成度', `${row.completeness}%`],
  ]
  return (
    <Card className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm sm:grid-cols-5">
      {cells.map(([k, v]) => <div key={k} className="min-w-0"><p className="text-xs text-gray-400">{k}</p><p className="truncate font-medium text-gray-800">{v}</p></div>)}
    </Card>
  )
}
