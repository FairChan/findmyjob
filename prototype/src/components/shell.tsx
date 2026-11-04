import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { Bell, Building2, LayoutDashboard, Lock, MapPin, Menu, RotateCcw, UserRound, X } from 'lucide-react'
import { useStore, type NoticeTo, type Role } from '../store'
import { cn, timeAgo } from '../lib/utils'
import { Avatar, Button, Card, LogoMark } from './ui'
import { useToast } from './toast'

export function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export function NotificationBell({ to, light }: { to: NoticeTo; light?: boolean }) {
  const { state, actions } = useStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const list = state.notices.filter((n) => n.to === to)
  const unread = list.filter((n) => !n.read).length
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        aria-label={`消息通知，${unread} 条未读`}
        className={cn('relative grid size-9 cursor-pointer place-items-center rounded-full', light ? 'text-white hover:bg-white/15' : 'text-gray-600 hover:bg-gray-100')}
      >
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-gray-100 bg-white text-gray-800 shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="font-medium">消息通知</span>
            <button className="cursor-pointer text-xs text-brand-500 hover:underline" onClick={() => actions.markRead(to)}>全部已读</button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {list.length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-400">暂无消息</p>}
            {list.slice(0, 8).map((n) => (
              <button
                key={n.id}
                className="flex w-full cursor-pointer gap-3 border-b border-gray-50 px-4 py-3 text-left hover:bg-gray-50"
                onClick={() => {
                  setOpen(false)
                  if (n.link) nav(n.link)
                }}
              >
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-red-500')} />
                <span className="flex-1">
                  <span className="block text-sm leading-snug">{n.text}</span>
                  <span className="mt-1 block text-xs text-gray-400">{timeAgo(n.at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const PUBLIC_LINKS = [
  { to: '/', label: '首页', end: true },
  { to: '/jobs', label: '职位' },
  { to: '/companies', label: '企业' },
  { to: '/partners', label: '合作伙伴' },
  { to: '/safety', label: '反诈专区' },
]

const ROLE_ENTRY = {
  student: { to: '/s/resume', label: '我的简历', icon: UserRound },
  employer: { to: '/e', label: '企业中心', icon: Building2 },
  admin: { to: '/admin', label: '运营后台', icon: LayoutDashboard },
} as const

/** 顶栏：白色悬浮胶囊（参考 21st.dev 的 Navbar1） */
export function PublicHeader() {
  const { state } = useStore()
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => {
    setOpen(false)
  }, [pathname])
  // 手机菜单打开时锁住页面滚动，按 Esc 关闭
  useEffect(() => {
    if (!open) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const entry = state.role === 'guest' ? null : ROLE_ENTRY[state.role]

  return (
    <MotionConfig reducedMotion="user">
      <header className="sticky top-0 z-40 px-3 py-3 sm:px-4">
        <div className="relative z-10 mx-auto flex h-14 max-w-[1168px] items-center justify-between gap-3 rounded-full bg-white/95 pl-3 pr-2 shadow-lg shadow-brand-900/10 ring-1 ring-black/5 backdrop-blur md:pl-5 md:pr-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" className="flex items-center gap-2 font-semibold text-gray-900">
              <motion.span className="inline-flex" initial={{ scale: 0.8 }} animate={{ scale: 1 }} whileHover={{ rotate: 10 }} transition={{ duration: 0.3 }}>
                <LogoMark size={30} />
              </motion.span>
              <span>FindMYJob</span>
            </Link>
            <span className="hidden items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500 lg:flex"><MapPin className="size-3.5" />马来西亚</span>
          </div>

          <nav className="hidden items-center gap-1 md:flex" aria-label="主导航">
            {PUBLIC_LINKS.map((l, i) => (
              <motion.div key={l.to} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: i * 0.04 }} whileHover={{ scale: 1.05 }}>
                <NavLink
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) => cn('relative block rounded-full px-3 py-2 text-sm font-medium transition-colors lg:px-4', isActive ? 'text-brand-600' : 'text-gray-700 hover:text-brand-500')}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-full bg-brand-50" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                      <span className="relative">{l.label}</span>
                    </>
                  )}
                </NavLink>
              </motion.div>
            ))}
          </nav>

          <motion.div className="flex shrink-0 items-center gap-1.5 sm:gap-2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: 0.2 }}>
            {state.role === 'guest' && (
              <>
                <Link to="/login?role=employer" className="hidden px-2 text-sm font-medium text-gray-700 hover:text-brand-500 md:inline">我要招人</Link>
                <motion.div whileHover={{ scale: 1.05 }}>
                  <Link to="/login" className="inline-flex items-center rounded-full bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 sm:px-5">登录 / 注册</Link>
                </motion.div>
              </>
            )}
            {state.role === 'student' && (
              <>
                <NotificationBell to="student" />
                <Link to="/s/resume" className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1 text-sm text-gray-800 hover:bg-gray-100 sm:pr-3">
                  <Avatar name={state.me.fullName} size={30} />
                  <span className="hidden sm:inline">{state.me.fullName}</span>
                </Link>
              </>
            )}
            {(state.role === 'employer' || state.role === 'admin') && entry && (
              <motion.div whileHover={{ scale: 1.05 }}>
                <Link to={entry.to} className="inline-flex items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"><entry.icon className="size-4" />{entry.label}</Link>
              </motion.div>
            )}
            <motion.button
              className="grid size-10 cursor-pointer place-items-center rounded-full text-gray-900 hover:bg-gray-100 md:hidden"
              onClick={() => setOpen(true)}
              whileTap={{ scale: 0.9 }}
              aria-label="打开菜单"
              aria-expanded={open}
            >
              <Menu className="size-6" />
            </motion.button>
          </motion.div>
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 z-[60] overflow-y-auto bg-white px-6 pb-10 pt-6 md:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="菜单"
              initial={{ opacity: 0, x: '100%' }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            >
              <div className="flex items-center justify-between">
                <Link to="/" onClick={() => setOpen(false)} className="flex items-center gap-2 font-semibold text-gray-900"><LogoMark size={30} />FindMYJob</Link>
                <motion.button
                  className="grid size-10 cursor-pointer place-items-center rounded-full hover:bg-gray-100"
                  onClick={() => setOpen(false)}
                  whileTap={{ scale: 0.9 }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  aria-label="关闭菜单"
                >
                  <X className="size-6 text-gray-900" />
                </motion.button>
              </div>
              <nav className="mt-8 flex flex-col gap-1" aria-label="主导航">
                {PUBLIC_LINKS.map((l, i) => (
                  <motion.div key={l.to} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ delay: i * 0.08 + 0.1 }}>
                    <NavLink
                      to={l.to}
                      end={l.end}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) => cn('block rounded-xl px-3 py-3 text-lg font-medium', isActive ? 'bg-brand-50 text-brand-600' : 'text-gray-900')}
                    >
                      {l.label}
                    </NavLink>
                  </motion.div>
                ))}
              </nav>
              <motion.div className="mt-6 space-y-3 border-t border-gray-100 pt-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ delay: 0.5 }}>
                {state.role === 'guest' ? (
                  <>
                    <Link to="/login" onClick={() => setOpen(false)} className="flex w-full items-center justify-center rounded-full bg-brand-500 px-5 py-3 text-base font-medium text-white">登录 / 注册</Link>
                    <Link to="/login?role=employer" onClick={() => setOpen(false)} className="flex w-full items-center justify-center rounded-full border border-gray-200 px-5 py-3 text-base font-medium text-gray-800">我要招人</Link>
                  </>
                ) : (
                  entry && (
                    <Link to={entry.to} onClick={() => setOpen(false)} className="flex w-full items-center justify-center gap-2 rounded-full bg-brand-500 px-5 py-3 text-base font-medium text-white"><entry.icon className="size-5" />{entry.label}</Link>
                  )
                )}
                <p className="flex items-center justify-center gap-1 pt-2 text-sm text-gray-400"><MapPin className="size-4" />马来西亚</p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
    </MotionConfig>
  )
}

export function Footer() {
  return (
    <footer className="mt-16 border-t border-gray-200 bg-white">
      <div className="wrap grid gap-8 py-10 text-sm text-gray-500 sm:grid-cols-2 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 font-semibold text-gray-900"><LogoMark size={24} />FindMYJob</div>
          <p className="mt-3 leading-relaxed">帮在马来西亚的留学生找实习和工作，连接中资、华资企业。学生免费使用。</p>
        </div>
        <div>
          <p className="mb-3 font-medium text-gray-900">求职者</p>
          <ul className="space-y-2">
            <li><Link to="/jobs" className="hover:text-brand-500">浏览职位</Link></li>
            <li><Link to="/s/resume" className="hover:text-brand-500">创建简历</Link></li>
            <li><Link to="/s/privacy" className="hover:text-brand-500">隐私中心</Link></li>
            <li><Link to="/safety" className="hover:text-brand-500">反诈专区</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 font-medium text-gray-900">企业</p>
          <ul className="space-y-2">
            <li><Link to="/login?role=employer" className="hover:text-brand-500">免费入驻</Link></li>
            <li><Link to="/e/talent" className="hover:text-brand-500">人才库</Link></li>
            <li><Link to="/e/billing" className="hover:text-brand-500">价格说明</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 font-medium text-gray-900">关于</p>
          <ul className="space-y-2">
            <li><Link to="/partners" className="hover:text-brand-500">合作伙伴</Link></li>
            <li><span>隐私政策（草案，待律师审阅）</span></li>
            <li><span>用户协议（草案，待律师审阅）</span></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-gray-100 py-4 text-center text-xs text-gray-400">
        © 2026 FindMYJob · 产品原型 · 页面中的企业、人物和数据均为虚构
      </div>
    </footer>
  )
}

export function PublicShell() {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="flex-1"><Outlet /></main>
      <Footer />
    </div>
  )
}

const ROLE_HOME: { role: Role; label: string; to: string }[] = [
  { role: 'guest', label: '访客', to: '/' },
  { role: 'student', label: '学生', to: '/s/resume' },
  { role: 'employer', label: '企业 HR', to: '/e' },
  { role: 'admin', label: '运营', to: '/admin' },
]

export function DemoBar() {
  const { state, actions } = useStore()
  const nav = useNavigate()
  const toast = useToast()
  const [open, setOpen] = useState(() => window.innerWidth >= 768)
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="fixed bottom-4 left-4 z-50 cursor-pointer rounded-full bg-gray-900 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
        演示面板
      </button>
    )
  return (
    <div className="fixed bottom-4 left-4 z-50 w-[288px] rounded-xl bg-gray-900/95 p-3 text-xs text-white shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">原型演示 · 切换身份</span>
        <button className="cursor-pointer text-white/60 hover:text-white" onClick={() => setOpen(false)} aria-label="收起"><X className="size-4" /></button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {ROLE_HOME.map((r) => (
          <button
            key={r.role}
            onClick={() => {
              actions.setRole(r.role)
              nav(r.to)
            }}
            className={cn('cursor-pointer rounded-md py-1.5', state.role === r.role ? 'bg-brand-500 font-semibold' : 'bg-white/10 hover:bg-white/20')}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1">
        <button className="cursor-pointer rounded-md bg-white/10 py-1.5 hover:bg-white/20" onClick={() => { actions.startFreshStudent(); nav('/s/onboarding?step=1') }}>新同学注册</button>
        <button className="cursor-pointer rounded-md bg-white/10 py-1.5 hover:bg-white/20" onClick={() => { actions.simulateReferral(state.settings.referralMinCompleteness); toast('模拟好友注册并完成资料') }}>好友注册（达标）</button>
        <button className="cursor-pointer rounded-md bg-white/10 py-1.5 hover:bg-white/20" onClick={() => { actions.simulateReferral(70); toast('模拟好友注册，资料 70%') }}>好友注册（70%）</button>
      </div>
      <div className="mt-2 flex items-center justify-between text-white/50">
        <span>操作会保存在本浏览器</span>
        <button
          className="flex cursor-pointer items-center gap-1 text-white/80 hover:text-white"
          onClick={() => {
            actions.reset()
            toast('演示数据已重置')
          }}
        >
          <RotateCcw className="size-3.5" />重置数据
        </button>
      </div>
    </div>
  )
}

const ROLE_LABEL: Record<Exclude<Role, 'guest'>, string> = { student: '学生', employer: '企业 HR', admin: '平台运营' }

export function RequireRole({ role, children }: { role: Exclude<Role, 'guest'>; children: ReactNode }) {
  const { state, actions } = useStore()
  if (state.role === role) return <>{children}</>
  const body = (
    <div className="wrap py-20">
      <Card className="mx-auto max-w-md p-8 text-center">
        <Lock className="mx-auto size-10 text-brand-400" />
        <h2 className="mt-4 text-lg font-semibold">这个页面需要以「{ROLE_LABEL[role]}」身份登录</h2>
        <p className="mt-2 text-sm text-gray-500">原型里不需要真实账号，点下面的按钮直接切换身份。</p>
        <Button className="mt-6" onClick={() => actions.setRole(role)}>以{ROLE_LABEL[role]}身份进入</Button>
        <div className="mt-3"><Link to="/" className="text-sm text-gray-400 hover:text-brand-500">返回首页</Link></div>
      </Card>
    </div>
  )
  if (role === 'student') return body
  return (
    <div className="min-h-screen">
      <PublicHeader />
      {body}
    </div>
  )
}
