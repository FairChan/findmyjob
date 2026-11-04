import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, BadgeCheck, Building2, ChevronRight, Coins, GraduationCap, Languages, Lock, Search, ShieldAlert, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { CATEGORIES, COMPANIES, HOT_SEARCHES, SCHOOLS, companyById } from '../../data/mock'
import { MY_COMPANY_ID, talentPool, useStore } from '../../store'
import { completeness } from '../../lib/privacy'
import { cn } from '../../lib/utils'
import { Avatar, Button, Card, CompanyLogo, LogoMark, Progress, buttonClass } from '../../components/ui'
import { CompanyCard, JobCard, PartnerWall } from '../../components/jobs'

function SearchBand() {
  const nav = useNavigate()
  const [kw, setKw] = useState('')
  const [type, setType] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const p = new URLSearchParams()
    if (kw) p.set('kw', kw)
    if (type) p.set('type', type)
    nav(`/jobs?${p}`)
  }
  return (
    <section className="bg-gradient-to-b from-[#dfe8ff] via-[#edf2ff] to-page">
      <div className="wrap flex flex-col gap-4 py-6 md:flex-row md:items-center md:gap-10 md:py-8">
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          <LogoMark size={40} />
          <div>
            <div className="text-2xl font-bold leading-none text-brand-500">FindMYJob</div>
            <div className="mt-1 text-[11px] tracking-wider text-brand-400">FIND MY JOB · MALAYSIA</div>
          </div>
        </Link>
        <form onSubmit={submit} className="flex h-12 flex-1 overflow-hidden rounded-full border-2 border-brand-500 bg-white">
          <select value={type} onChange={(e) => setType(e.target.value)} className="hidden cursor-pointer border-r border-gray-200 bg-transparent pl-5 pr-2 text-sm text-gray-600 outline-none sm:block" aria-label="职位类型">
            <option value="">全部类型</option>
            <option value="INTERNSHIP">实习</option>
            <option value="FULL_TIME">全职</option>
            <option value="PART_TIME">兼职</option>
          </select>
          <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索职位、公司、技能，如：前端、会计、中马翻译" className="min-w-0 flex-1 px-4 text-sm outline-none" />
          <button className="flex cursor-pointer items-center gap-1.5 bg-brand-500 px-6 font-medium text-white hover:bg-brand-600 md:px-9"><Search className="size-4" />搜索</button>
        </form>
        <Link to="/login?role=employer" className="hidden shrink-0 items-center gap-2 rounded-xl bg-white/80 px-4 py-2 text-sm shadow-sm hover:bg-white lg:flex">
          <Building2 className="size-5 text-brand-500" />
          <span><span className="block font-medium text-gray-800">企业免费招人</span><span className="text-xs text-gray-400">公益期每月送 30 次解锁</span></span>
        </Link>
      </div>
      <div className="wrap flex flex-wrap gap-x-4 gap-y-1 pb-5 text-sm text-gray-500">
        <span className="text-gray-400">热门搜索：</span>
        {HOT_SEARCHES.map((h) => <Link key={h} to={`/jobs?kw=${encodeURIComponent(h)}`} className="hover:text-brand-500">{h}</Link>)}
      </div>
    </section>
  )
}

function CategoryMenu() {
  const [active, setActive] = useState<number | null>(null)
  return (
    <div className="relative hidden w-[220px] shrink-0 bg-menu md:block" onMouseLeave={() => setActive(null)}>
      {CATEGORIES.map((c, i) => (
        <Link
          key={c.key}
          to={`/jobs?cat=${encodeURIComponent(c.key)}`}
          onMouseEnter={() => setActive(i)}
          className={cn('flex h-[37.7px] items-center justify-between px-5 text-sm text-white/95', active === i && 'bg-white/15')}
        >
          {c.name}<ChevronRight className="size-4 text-white/60" />
        </Link>
      ))}
      {active !== null && (
        <div className="absolute left-full top-0 z-20 h-full w-[520px] border border-gray-100 bg-white p-6 shadow-xl">
          <p className="font-semibold text-gray-900">{CATEGORIES[active].name}</p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
            {CATEGORIES[active].subs.map((s) => <Link key={s} to={`/jobs?kw=${encodeURIComponent(s)}`} className="text-sm text-gray-600 hover:text-brand-500">{s}</Link>)}
          </div>
        </div>
      )}
    </div>
  )
}

const SLIDES = [
  { bg: 'from-[#3a63f3] via-[#4d7bff] to-[#7aa2ff]', title: '在马来西亚找实习，从 FindMYJob 开始', sub: '中资 / 华资企业 · 接受学生准证 · 中文沟通 · 学生免费使用', cta: '学生免费注册', to: '/login?role=student' },
  { bg: 'from-[#f76b1c] via-[#fa8c3c] to-[#ffb36b]', title: '公益试点期 · 企业免费入驻', sub: '认证企业每月赠送 30 次人才解锁，收到的投递免费查看', cta: '企业免费入驻', to: '/login?role=employer' },
  { bg: 'from-[#0b9b8a] via-[#16b3a0] to-[#5fd3c0]', title: '语言能力 × 工作准证 精准筛选', sub: '中文 / 英文 / 马来文程度，学生准证、需办准证，一键筛出合适的人', cta: '看看人才库', to: '/e/talent' },
]

function Banner() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % SLIDES.length), 5000)
    return () => clearInterval(t)
  }, [])
  const s = SLIDES[i]
  return (
    <div className={cn('relative flex min-h-[220px] flex-1 overflow-hidden bg-gradient-to-br text-white transition-all md:min-h-[340px]', s.bg)}>
      <span className="absolute -right-16 -top-16 size-72 rounded-full bg-white/10" />
      <span className="absolute -bottom-24 right-24 size-56 rounded-full bg-white/10" />
      <span className="absolute bottom-10 right-10 hidden size-24 rotate-12 rounded-3xl border-4 border-white/25 md:block" />
      <div className="relative flex flex-col justify-center gap-3 p-8 md:p-12">
        <span className="flex w-fit items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs"><Sparkles className="size-3.5" />厦大校友企业与国企合作背书</span>
        <h2 className="text-2xl font-bold leading-tight md:text-4xl">{s.title}</h2>
        <p className="max-w-lg text-sm text-white/90 md:text-base">{s.sub}</p>
        <Link to={s.to} className="mt-2 flex w-fit items-center gap-1 rounded-full bg-white px-5 py-2 text-sm font-semibold text-gray-900 hover:bg-white/90">{s.cta}<ArrowRight className="size-4" /></Link>
      </div>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
        {SLIDES.map((_, k) => <button key={k} onClick={() => setI(k)} aria-label={`第 ${k + 1} 张`} className={cn('h-1.5 cursor-pointer rounded-full transition-all', k === i ? 'w-6 bg-white' : 'w-1.5 bg-white/50')} />)}
      </div>
    </div>
  )
}

function SideCard() {
  const { state } = useStore()
  const nav = useNavigate()
  if (state.role === 'student') {
    const { score } = completeness(state.me)
    return (
      <div className="p-5">
        <div className="flex items-center gap-3"><Avatar name={state.me.fullName} size={44} /><div><p className="font-medium">{state.me.fullName}</p><p className="text-xs text-gray-400">{SCHOOLS.find((s) => s.id === state.me.schoolId)?.short} · {state.me.major}</p></div></div>
        <p className="mt-4 text-sm text-gray-500">简历完成度 <span className="font-semibold text-brand-500">{score}%</span></p>
        <Progress value={score} className="mt-2" />
        <div className="mt-4 grid grid-cols-2 gap-2 text-center text-sm">
          <Link to="/s/applications" className="rounded-lg bg-gray-50 py-2 hover:bg-brand-50"><b className="block text-lg">{state.applications.filter((a) => a.studentId === state.me.id && a.status !== 'WITHDRAWN').length}</b>投递</Link>
          <Link to="/s/invitations" className="rounded-lg bg-gray-50 py-2 hover:bg-brand-50"><b className="block text-lg">{state.invitations.filter((i) => i.studentId === state.me.id && i.status === 'SENT').length}</b>新邀请</Link>
        </div>
        <Link to="/s/resume" className={buttonClass('primary', 'md', 'mt-4 w-full')}>完善简历</Link>
      </div>
    )
  }
  if (state.role === 'employer') {
    const c = companyById(MY_COMPANY_ID)
    return (
      <div className="p-5">
        <div className="flex items-center gap-3"><CompanyLogo company={c} size={44} /><div><p className="font-medium">{c.short}</p><p className="flex items-center gap-1 text-xs text-emerald-600"><BadgeCheck className="size-3.5" />已认证企业</p></div></div>
        <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"><Coins className="mr-1 inline size-4" />剩余 <b>{state.credits}</b> 点</div>
        <Button className="mt-4 w-full" onClick={() => nav('/e/talent')}>搜索人才</Button>
        <Button variant="outline" className="mt-2 w-full" onClick={() => nav('/e/jobs/new')}>发布职位</Button>
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col p-5">
      <p className="font-semibold text-gray-900">欢迎来到 FindMYJob</p>
      <p className="mt-1 text-xs text-gray-400">在马留学生 × 中资华资企业</p>
      <Button className="mt-5 w-full" onClick={() => nav('/login?role=student')}><GraduationCap className="size-4" />我是学生，找工作</Button>
      <Button variant="outline" className="mt-2 w-full" onClick={() => nav('/login?role=employer')}><Building2 className="size-4" />我是企业，招人才</Button>
      <ul className="mt-auto space-y-2 pt-5 text-xs text-gray-500">
        <li className="flex items-center gap-1.5"><BadgeCheck className="size-4 text-emerald-500" />学生用学校邮箱认证</li>
        <li className="flex items-center gap-1.5"><ShieldCheck className="size-4 text-emerald-500" />企业用 SSM 证书认证</li>
        <li className="flex items-center gap-1.5"><Lock className="size-4 text-emerald-500" />联系方式加密，解锁才可见</li>
      </ul>
    </div>
  )
}

export default function Home() {
  const { state } = useStore()
  const [tab, setTab] = useState('全部')
  const published = state.jobs.filter((j) => j.status === 'PUBLISHED')
  const tabs = ['全部', '实习', '接受学生准证', '技术', '工程', '金融', '市场']
  const shown = published
    .filter((j) => tab === '全部' || (tab === '实习' ? j.type === 'INTERNSHIP' : tab === '接受学生准证' ? j.acceptsStudentPass : j.category === tab))
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
    .slice(0, 9)
  const featured = [...COMPANIES].sort((a, b) => Number(!!b.founding) - Number(!!a.founding)).slice(0, 8)
  const stats = [
    { icon: <Building2 className="size-5" />, label: '在招职位', value: published.length },
    { icon: <BadgeCheck className="size-5" />, label: '认证企业', value: COMPANIES.length },
    { icon: <Users className="size-5" />, label: '人才库学生', value: talentPool(state).length },
    { icon: <GraduationCap className="size-5" />, label: '覆盖高校', value: SCHOOLS.length },
  ]
  return (
    <>
      <SearchBand />

      <section className="wrap">
        <div className="flex overflow-hidden rounded-xl bg-white shadow-sm md:h-[340px]">
          <CategoryMenu />
          <Banner />
          <div className="hidden w-[260px] shrink-0 border-l border-gray-100 lg:block"><SideCard /></div>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 md:hidden">
          {CATEGORIES.map((c) => <Link key={c.key} to={`/jobs?cat=${encodeURIComponent(c.key)}`} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-sm text-gray-600 shadow-sm">{c.name}</Link>)}
        </div>
      </section>

      <section className="wrap mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="flex items-center gap-3 p-4">
            <span className="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-500">{s.icon}</span>
            <div><p className="text-xl font-semibold tabular-nums">{s.value}</p><p className="text-xs text-gray-500">{s.label}</p></div>
          </Card>
        ))}
      </section>

      <section className="wrap mt-12">
        <h2 className="text-center text-2xl font-semibold">合作名企 · 正在招聘</h2>
        <p className="mt-2 text-center text-sm text-gray-500">厦大校友企业、国企在马机构和本地华资企业</p>
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {featured.map((c) => <CompanyCard key={c.id} company={c} jobCount={published.filter((j) => j.companyId === c.id).length} />)}
        </div>
      </section>

      <section className="wrap mt-12">
        <h2 className="text-center text-2xl font-semibold">最新职位</h2>
        <div className="mt-5 flex gap-1 overflow-x-auto border-b border-gray-200 md:justify-center">
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn('shrink-0 cursor-pointer border-b-2 px-4 py-2.5 text-sm', tab === t ? 'border-brand-500 font-semibold text-brand-500' : 'border-transparent text-gray-600 hover:text-brand-500')}>{t}</button>
          ))}
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shown.map((j) => <JobCard key={j.id} job={j} />)}</div>
        <div className="mt-6 text-center"><Link to="/jobs" className={buttonClass('outline', 'md', 'rounded-full px-8')}>查看更多职位</Link></div>
      </section>

      <section className="wrap mt-8">
        <Link to="/safety" className="flex items-center gap-4 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 hover:border-amber-300">
          <ShieldAlert className="size-8 shrink-0 text-amber-500" />
          <span className="flex-1"><b className="block text-base">求职防骗，先看这里</b>刷单兼职、先交押金、扣押护照……找实习前花两分钟看看常见骗局和紧急电话。</span>
          <ArrowRight className="size-5 shrink-0" />
        </Link>
      </section>

      <section className="wrap mt-12">
        <h2 className="text-center text-2xl font-semibold">背书与合作伙伴</h2>
        <p className="mt-2 text-center text-sm text-gray-500">由校友组织、国企和高校就业中心共同支持（原型中为示例名称）</p>
        <div className="mt-6"><PartnerWall partners={state.partners.filter((p) => p.showOnHome)} /></div>
      </section>

      <section className="wrap mt-12 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 p-7 text-white">
          <GraduationCap className="size-8" />
          <h3 className="mt-3 text-xl font-semibold">给学生：免费使用</h3>
          <ul className="mt-4 space-y-2 text-sm text-white/90">
            <li>· 一份标准化简历，被所有认证企业看到</li>
            <li>· 注册送 20 次职位详情查看，邀请同学还能再加</li>
            <li>· 可以选择不进人才库，或屏蔽某家公司</li>
            <li>· 谁看过你、谁解锁了你，一目了然</li>
            <li>· 按「接受学生准证」筛岗位，不白投</li>
          </ul>
          <Link to="/login?role=student" className="mt-6 inline-flex items-center gap-1 rounded-full bg-white px-5 py-2 text-sm font-semibold text-brand-600">免费创建简历<ArrowRight className="size-4" /></Link>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-[#1f2433] to-[#3a4157] p-7 text-white">
          <Building2 className="size-8" />
          <h3 className="mt-3 text-xl font-semibold">给企业：按需解锁</h3>
          <ul className="mt-4 space-y-2 text-sm text-white/90">
            <li>· 按学校、专业、语言、工作准证精准筛人</li>
            <li>· 学生主动投递的简历，免费查看联系方式</li>
            <li>· 主动找人才需要解锁，1 次 1 点，团队共享</li>
            <li>· 公益期：认证企业每月赠送 30 点</li>
          </ul>
          <Link to="/login?role=employer" className="mt-6 inline-flex items-center gap-1 rounded-full bg-white px-5 py-2 text-sm font-semibold text-gray-900">企业免费入驻<ArrowRight className="size-4" /></Link>
        </div>
      </section>

      <section className="wrap mt-6">
        <Card className="flex flex-col items-start gap-3 p-5 text-sm text-gray-600 md:flex-row md:items-center">
          <Languages className="size-6 shrink-0 text-brand-500" />
          <p className="flex-1">平台支持中文、英文界面（马来文即将上线）。所有简历按马来西亚《个人资料保护法》（PDPA）处理：学生明确同意后才进入人才库，联系方式加密存储。</p>
        </Card>
      </section>
    </>
  )
}
