import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronRight, SearchX, Search } from 'lucide-react'
import { JOB_TYPE_LABEL, companyById } from '../../data/mock'
import { LANDMARKS } from '../../data/taxonomy'
import { jobAccess, useStore } from '../../store'
import { filterJobs, parseFilters, toParams, type JobFilters } from '../../lib/filters'
import { pickDetail } from '../../lib/quota'
import { searchJobs, type SearchHit, type SearchMode } from '../../lib/search'
import { cn } from '../../lib/utils'
import { Card, Empty } from '../../components/ui'
import { FilterPanel } from '../../components/filters'
import { JobCard, JobDetailPanel, JobListItem, useApplyFlow } from '../../components/jobs'

const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches

export default function Jobs() {
  const { state, actions } = useStore()
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const { start, modal } = useApplyFlow()
  const [kw, setKw] = useState(params.get('kw') ?? '')
  useEffect(() => {
    setKw(params.get('kw') ?? '')
  }, [params])

  const q = params.get('kw') ?? ''
  const mode = (params.get('mode') as SearchMode | null) ?? state.settings.searchDefaultMode
  const sort = params.get('sort') ?? ''
  const filters = useMemo(() => parseFilters(params), [params])
  const write = (next: { kw?: string; mode?: SearchMode; sort?: string; filters?: JobFilters }) => {
    const o: Record<string, string> = toParams(next.filters ?? filters)
    const k = next.kw ?? q
    if (k) o.kw = k
    const m = next.mode ?? mode
    if (m !== state.settings.searchDefaultMode) o.mode = m
    const so = next.sort ?? sort
    if (so) o.sort = so
    setParams(o, { replace: true })
  }

  const { exact, related } = useMemo(() => {
    const published = filterJobs(state.jobs.filter((j) => j.status === 'PUBLISHED'), filters, { companyById, landmarks: LANDMARKS })
    const r = searchJobs(published, q, mode, { fallbackBelow: state.settings.relatedFallbackBelow, canSeeBody: (j) => jobAccess(state, j.id) === 'open' })
    // 薪资面议的职位排在最后，不参与比较，否则排序位置会暴露它的薪资
    const pay = (h: SearchHit) => (h.job.salaryHidden ? -Infinity : h.job.salaryMax)
    if (sort === 'salary') r.exact.sort((a, b) => pay(b) - pay(a))
    return r
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, filters, q, mode, sort])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const hits = [...exact, ...related]
  // 桌面右栏默认显示第一条，但只有用户点过才算"打开"，不扣额度
  const { job: selected, explicit } = pickDetail(hits.map((h) => h.job), selectedId)
  const selectedAccess = selected ? jobAccess(state, selected.id) : 'open'
  const panelAccess = selectedAccess === 'open' && !explicit && state.role === 'student' && state.settings.quotaEnabled ? 'preview' : selectedAccess

  const open = (id: string) => {
    if (isDesktop()) {
      setSelectedId(id)
      actions.viewJob(id)
    } else nav(`/jobs/${id}`)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    write({ kw: kw.trim() })
  }
  const item = (h: SearchHit) => (
    <JobListItem key={h.job.id} job={h.job} active={selected?.id === h.job.id} related={h.matchedBy === 'related'} locked={jobAccess(state, h.job.id) === 'locked'} onClick={() => open(h.job.id)} />
  )

  return (
    <div className="bg-gradient-to-b from-[#e8eeff] to-page to-[220px]">
      <div className="wrap py-5">
        <form onSubmit={submit} className="flex h-11 overflow-hidden rounded-full border-2 border-brand-500 bg-white md:mx-auto md:max-w-2xl">
          <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索职位、公司、技能" className="min-w-0 flex-1 px-5 text-sm outline-none" />
          <button className="flex cursor-pointer items-center gap-1 bg-brand-500 px-6 text-sm font-medium text-white"><Search className="size-4" />搜索</button>
        </form>
        <div className="mt-3 flex items-center justify-center gap-2 text-sm">
          <span className="text-gray-500">搜索方式</span>
          {(['EXACT', 'RELATED'] as const).map((m) => (
            <button key={m} type="button" onClick={() => write({ mode: m })} className={cn('cursor-pointer rounded-full px-3 py-1', mode === m ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:text-brand-500')}>
              {m === 'EXACT' ? '精确' : '关联'}
            </button>
          ))}
          <span className="hidden text-xs text-gray-400 sm:inline">{mode === 'EXACT' ? '只找名称和技能里出现这个词的职位' : '"财务"也会找会计、审计等相关职位'}</span>
        </div>

        <div className="mt-4"><FilterPanel value={filters} onChange={(f) => write({ filters: f })} bands={state.settings.salaryBands} /></div>

        <div className="mt-3 flex items-center gap-3 text-sm">
          <span className="text-gray-500">共 <b className="text-brand-500">{exact.length}</b> 个职位</span>
          <select aria-label="排序" value={sort} onChange={(e) => write({ sort: e.target.value })} className="ml-auto h-8 cursor-pointer rounded-full border border-gray-200 bg-white pl-3 pr-2 text-sm text-gray-600 outline-none">
            <option value="">{q ? '最相关' : '最新发布'}</option>
            <option value="salary">薪资最高</option>
          </select>
        </div>

        {hits.length === 0 ? (
          <Card className="mt-4"><Empty icon={<SearchX className="size-12" />} title="没有找到符合条件的职位" desc="换个关键词、切到关联搜索，或者减少筛选条件试试" /></Card>
        ) : (
          <div className="mt-4 flex gap-4">
            <div className="w-full shrink-0 space-y-3 lg:w-[400px]">
              {exact.length === 0 && <p className="rounded-xl bg-white p-4 text-sm text-gray-500">没有名称里带"{q}"的职位。</p>}
              {exact.map(item)}
              {related.length > 0 && (
                <>
                  <p className="pt-2 text-sm font-medium text-gray-600">没找到想要的？看看相关职位（{related.length}）</p>
                  {related.map(item)}
                </>
              )}
            </div>
            <div className="hidden min-w-0 flex-1 lg:block">
              <div className="sticky top-20 max-h-[calc(100vh-96px)] overflow-y-auto rounded-xl">
                {selected && <JobDetailPanel job={selected} start={start} compact access={panelAccess} onOpen={() => open(selected.id)} />}
              </div>
            </div>
          </div>
        )}
      </div>
      {modal}
    </div>
  )
}

export function JobDetail() {
  const { id } = useParams()
  const { state, actions } = useStore()
  const { start, modal } = useApplyFlow()
  const job = state.jobs.find((j) => j.id === id)
  // 打开详情页算一次查看；StrictMode 下会调用两次，靠 recordJobView 的幂等兜住
  useEffect(() => {
    if (id) actions.viewJob(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  if (!job) return <div className="wrap py-10"><Card><Empty title="职位不存在或已下线" action={<Link to="/jobs" className="text-brand-500">返回职位列表</Link>} /></Card></div>
  const c = companyById(job.companyId)
  const access = jobAccess(state, job.id)
  const others = state.jobs.filter((j) => j.companyId === c.id && j.id !== job.id && j.status === 'PUBLISHED')
  const similar = state.jobs.filter((j) => j.category === job.category && j.id !== job.id && j.status === 'PUBLISHED').slice(0, 3)
  return (
    <div className="wrap py-5">
      <nav className="mb-4 flex items-center gap-1 text-sm text-gray-400">
        <Link to="/" className="hover:text-brand-500">首页</Link><ChevronRight className="size-3.5" />
        <Link to="/jobs" className="hover:text-brand-500">职位</Link><ChevronRight className="size-3.5" />
        <span className="truncate text-gray-600">{job.title}</span>
      </nav>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <JobDetailPanel job={job} start={start} access={access} />
        <aside className="space-y-4">
          <Card className="p-4">
            <p className="mb-3 font-semibold">{c.short}的其他职位</p>
            {others.length === 0 && <p className="text-sm text-gray-400">暂无其他在招职位</p>}
            <div className="space-y-3">
              {others.map((j) => (
                <Link key={j.id} to={`/jobs/${j.id}`} className="block rounded-lg p-2 hover:bg-gray-50">
                  <p className="text-sm font-medium">{j.title}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{JOB_TYPE_LABEL[j.type]} · {j.state}</p>
                </Link>
              ))}
            </div>
          </Card>
        </aside>
      </div>
      {similar.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-lg font-semibold">相似职位</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{similar.map((j) => <JobCard key={j.id} job={j} />)}</div>
        </section>
      )}
      {modal}
    </div>
  )
}
