import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BadgeCheck, Building2, CalendarDays, GraduationCap, Handshake, MapPin, ShieldCheck, Users } from 'lucide-react'
import { COMPANIES } from '../../data/mock'
import { COMPANY_TAG_LABEL, industryName, type CompanyTag } from '../../data/taxonomy'
import { studentCount, useStore, type Role } from '../../store'
import { cn } from '../../lib/utils'
import { Button, Card, Chip, CompanyLogo, Empty, Field, Input, SectionTitle } from '../../components/ui'
import { CompanyBadges, CompanyCard, JobCard, PartnerWall } from '../../components/jobs'
import { useToast } from '../../components/toast'

export function Companies() {
  const { state } = useStore()
  const [tag, setTag] = useState<CompanyTag | ''>('')
  const list = COMPANIES.filter((c) => !tag || c.tags.includes(tag))
  return (
    <div className="wrap py-8">
      <SectionTitle title="合作企业" sub="所有企业都经过 SSM 注册证书人工审核" />
      <div className="mb-5 flex flex-wrap gap-2">
        {(['', 'ALUMNI', 'SOE', 'CN_OVERSEAS', 'CHINESE_MY', 'FORTUNE_500'] as const).map((t) => <Chip key={t} active={tag === t} onClick={() => setTag(t)}>{t ? COMPANY_TAG_LABEL[t] : '全部'}</Chip>)}
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {list.map((c) => <CompanyCard key={c.id} company={c} jobCount={state.jobs.filter((j) => j.companyId === c.id && j.status === 'PUBLISHED').length} />)}
      </div>
    </div>
  )
}

export function CompanyPage() {
  const { id } = useParams()
  const { state } = useStore()
  const c = COMPANIES.find((x) => x.id === id)
  if (!c) return <div className="wrap py-10"><Card><Empty title="企业不存在" /></Card></div>
  const jobs = state.jobs.filter((j) => j.companyId === c.id && j.status === 'PUBLISHED')
  return (
    <div>
      <div className="h-36" style={{ background: `linear-gradient(120deg, ${c.color}, ${c.color}99)` }} />
      <div className="wrap -mt-14">
        <Card className="p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <CompanyLogo company={c} size={88} className="text-2xl ring-4 ring-white" />
            <div className="flex-1">
              <h1 className="text-2xl font-semibold">{c.name}</h1>
              <div className="mt-2 flex flex-wrap gap-1.5"><CompanyBadges company={c} /></div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-500">
                <span className="flex items-center gap-1"><Building2 className="size-4" />{industryName(c.industryCode)}</span>
                <span className="flex items-center gap-1"><Users className="size-4" />{c.size}</span>
                <span className="flex items-center gap-1"><MapPin className="size-4" />{c.city}，{c.state}</span>
                <span className="flex items-center gap-1"><CalendarDays className="size-4" />成立于 {c.founded} 年</span>
              </div>
            </div>
            <div className="text-center md:px-6"><p className="text-3xl font-semibold text-brand-500">{jobs.length}</p><p className="text-sm text-gray-500">在招职位</p></div>
          </div>
        </Card>
        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_300px]">
          <div>
            <h2 className="mb-3 text-lg font-semibold">在招职位</h2>
            {jobs.length ? <div className="grid gap-4 sm:grid-cols-2">{jobs.map((j) => <JobCard key={j.id} job={j} />)}</div> : <Card><Empty title="暂无在招职位" /></Card>}
          </div>
          <aside className="space-y-4">
            <Card className="p-5">
              <h3 className="font-semibold">公司介绍</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{c.intro}</p>
              <h3 className="mt-5 font-semibold">福利</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">{c.benefits.map((b) => <span key={b} className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{b}</span>)}</div>
            </Card>
            <Card className="p-5 text-sm">
              <h3 className="flex items-center gap-1 font-semibold"><ShieldCheck className="size-4 text-emerald-500" />认证信息</h3>
              <p className="mt-2 text-gray-500">SSM 注册号</p>
              <p className="font-mono text-gray-800">{c.ssm}</p>
              <p className="mt-2 text-xs text-gray-400">平台已人工核对注册证书</p>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  )
}

export function Partners() {
  const { state } = useStore()
  return (
    <div className="wrap py-8">
      <div className="rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 p-8 text-white md:p-12">
        <Handshake className="size-10" />
        <h1 className="mt-4 text-3xl font-bold">背书与合作伙伴</h1>
        <p className="mt-3 max-w-2xl text-white/90">FindMYJob 由厦大校友企业、国企在马机构和高校就业中心共同支持。合作伙伴为平台提供岗位和信任背书，平台为合作伙伴提供人才数据报告和校园活动支持。</p>
      </div>
      <h2 className="mb-4 mt-10 text-lg font-semibold">合作伙伴（原型中为示例名称）</h2>
      <PartnerWall partners={state.partners} />
      <Card className="mt-8 flex flex-col items-start gap-4 p-6 md:flex-row md:items-center">
        <div className="flex-1">
          <h3 className="font-semibold">成为合作伙伴</h3>
          <p className="mt-1 text-sm text-gray-500">校友组织、商会、高校就业中心都可以申请。合作伙伴企业享受首年会员 5 折和首页品牌展示。</p>
        </div>
        <Button>联系我们（原型）</Button>
      </Card>
    </div>
  )
}

export function Login() {
  const [params] = useSearchParams()
  const [tab, setTab] = useState<'student' | 'employer'>(params.get('role') === 'employer' ? 'employer' : 'student')
  const ref = params.get('ref')
  const [mode, setMode] = useState<'login' | 'register'>(ref ? 'register' : 'login')
  const [agree, setAgree] = useState(false)
  const [pool, setPool] = useState(true)
  const { state, actions } = useStore()
  // 学生注册上限（DECISIONS Q5）：满额后带邀请码进来的也不能注册，已注册的人照常登录
  const full = studentCount(state) >= state.settings.signupCap
  const nav = useNavigate()
  const toast = useToast()
  const go = (role: Role) => {
    actions.setRole(role)
    nav(role === 'student' ? '/s/resume' : role === 'employer' ? '/e' : '/admin')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'register' && !agree) return toast('请先阅读并同意用户协议和隐私政策', 'error')
    if (mode === 'register' && tab === 'student') {
      if (full) return toast('本阶段学生名额已满，请稍后再来', 'error')
      actions.startFreshStudent()
      actions.setVisibility(pool ? 'PUBLIC' : 'HIDDEN')
      toast('注册成功，接下来分 4 步完善资料')
      return nav('/s/onboarding?step=1')
    }
    toast(mode === 'login' ? '登录成功' : tab === 'student' ? '注册成功，验证码已发送到学校邮箱（原型）' : '注册成功，请提交企业认证材料（原型）')
    go(tab)
  }
  const benefits = tab === 'student'
    ? ['完全免费，一份简历被所有认证企业看到', '自己决定是否进人才库，可屏蔽任意公司', '谁看过你、谁解锁了你，全部透明']
    : ['学生主动投递的简历，免费查看联系方式', '按语言能力、工作准证精准筛人', '公益期每月赠送 30 次人才解锁']
  return (
    <div className="wrap grid items-center gap-8 py-10 lg:grid-cols-2">
      <div className={cn('hidden rounded-2xl p-10 text-white lg:block', tab === 'student' ? 'bg-gradient-to-br from-brand-500 to-brand-700' : 'bg-gradient-to-br from-[#1f2433] to-[#3a4157]')}>
        {tab === 'student' ? <GraduationCap className="size-10" /> : <Building2 className="size-10" />}
        <h1 className="mt-4 text-3xl font-bold">{tab === 'student' ? '找实习、找工作，从这里开始' : '找到懂中文的本地好人才'}</h1>
        <ul className="mt-6 space-y-3">{benefits.map((b) => <li key={b} className="flex items-start gap-2 text-white/90"><BadgeCheck className="mt-0.5 size-5 shrink-0" />{b}</li>)}</ul>
      </div>
      <Card className="mx-auto w-full max-w-md p-6 md:p-8">
        <div className="grid grid-cols-2 rounded-lg bg-gray-100 p-1 text-sm">
          {(['student', 'employer'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn('cursor-pointer rounded-md py-2', tab === t ? 'bg-white font-semibold text-brand-600 shadow-sm' : 'text-gray-500')}>{t === 'student' ? '我是学生' : '我是企业'}</button>
          ))}
        </div>
        <h2 className="mt-6 text-xl font-semibold">{mode === 'login' ? '登录' : tab === 'student' ? '学生注册' : '企业注册'}</h2>
        {ref && tab === 'student' && <p className="mt-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-700">好友邀请你加入 FindMYJob。注册并把资料填到 {state.settings.referralMinCompleteness}% 后，你的好友能多看职位。</p>}
        {full && mode === 'register' && tab === 'student' && <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">本阶段学生名额已满（{state.settings.signupCap} 人），请稍后再来。已经注册的同学照常登录。</p>}
        <form onSubmit={submit} className="mt-5 space-y-4">
          {mode === 'register' && tab === 'employer' && <Field label="公司名称" required><Input placeholder="与 SSM 注册证书一致" /></Field>}
          <Field label={tab === 'student' ? '邮箱' : '企业邮箱'} hint={tab === 'student' && mode === 'register' ? '用学校邮箱注册，可以自动完成学校认证' : undefined}>
            <Input type="email" placeholder={tab === 'student' ? 'yourname@xmu.edu.my' : 'hr@company.com.my'} />
          </Field>
          {mode === 'register' && tab === 'student' ? (
            <Field label="验证码" hint="原型不会真的发送">
              <div className="flex gap-2"><Input inputMode="numeric" placeholder="6 位数字" /><Button type="button" variant="white" onClick={() => toast('验证码已发送（原型）', 'info')}>发送</Button></div>
            </Field>
          ) : (
            <Field label="密码"><Input type="password" placeholder="至少 8 位" /></Field>
          )}
          {mode === 'register' && (
            <div className="space-y-2 rounded-lg bg-gray-50 p-3 text-sm">
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 accent-brand-500" />
                <span>我已阅读并同意《用户协议》和《隐私政策》<span className="text-red-500">*</span></span>
              </label>
              {tab === 'student' && (
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="checkbox" checked={pool} onChange={(e) => setPool(e.target.checked)} className="mt-0.5 accent-brand-500" />
                  <span>加入人才库：允许认证企业查看我的匿名档案，并在付费解锁后查看我的联系方式（随时可在隐私中心关闭）</span>
                </label>
              )}
            </div>
          )}
          <Button type="submit" size="lg" className="w-full">{mode === 'login' ? '登录' : '注册'}</Button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-500">
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <button className="cursor-pointer text-brand-500 hover:underline" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? '免费注册' : '去登录'}</button>
        </p>
        <div className="mt-6 border-t border-gray-100 pt-4">
          <p className="mb-2 text-center text-xs text-gray-400">原型演示：一键进入</p>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="white" size="sm" onClick={() => go('student')}>学生 林雨晴</Button>
            <Button variant="white" size="sm" onClick={() => go('employer')}>企业 HR</Button>
            <Button variant="white" size="sm" onClick={() => go('admin')}>平台运营</Button>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-gray-400"><Link to="/" className="hover:text-brand-500">返回首页</Link></p>
      </Card>
    </div>
  )
}
