import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, FileText, Plus } from 'lucide-react'
import { DEGREE_LABEL, schoolById, type Experience, type Student } from '../../data/mock'
import { useStore } from '../../store'
import { completeness, firstIncompleteStep } from '../../lib/privacy'
import { cn, uid } from '../../lib/utils'
import { Button, Card, Progress, Tag } from '../../components/ui'
import { BasicFields, ContactFields, ExperienceForm, IntentFields, SkillFields } from '../../components/profile-fields'
import { useToast } from '../../components/toast'

const STEPS = ['基本信息', '求职意向', '语言与技能', '经历与联系方式']

/** 用基本信息生成第一条教育经历，免得同一件事填两遍 */
function withEducation(d: Student): Student {
  const school = schoolById(d.schoolId)
  if (!school || !d.major || !d.gradYear || d.education.length > 1) return d
  const years = d.degree === 'MASTER' ? 1 : d.degree === 'DIPLOMA' ? 2 : 4
  const gpa = d.cgpa !== undefined ? `${d.cgpa.toFixed(2)} / 4.0` : undefined
  return { ...d, education: [{ school: school.name, degree: d.degree, major: d.major, period: `${d.gradYear - years}.09 - ${d.gradYear}.${String(d.gradMonth || 6).padStart(2, '0')}`, gpa }] }
}

/** 注册后的完善资料向导：4 步，每步可以保存后退出（PRD v0.2 §2.2） */
export default function Onboarding() {
  const { state, actions } = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const step = Math.min(5, Math.max(1, Number(params.get('step')) || 1))
  const [d, setD] = useState<Student>(structuredClone(state.me))
  const [exp, setExp] = useState<Experience>({ id: uid(), kind: '实习', title: '', org: '', period: '', desc: '' })
  const set = (p: Partial<Student>) => setD((x) => ({ ...x, ...p }))
  const go = (n: number) => setParams({ step: String(n) }, { replace: true })

  const next = () => {
    const saved = step === 1 ? withEducation(d) : d
    setD(saved)
    actions.updateMe(saved)
    const missing = firstIncompleteStep(saved)
    if (missing !== null && missing <= step) return toast(`第 ${missing} 步还有必填项没填`, 'error')
    go(step + 1)
  }
  const score = completeness(d).score

  if (step === 5) {
    const live = completeness(state.me).score
    return (
      <div className="wrap max-w-xl py-10">
        <Card className="p-8 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Check className="size-7" /></span>
          <h1 className="mt-4 text-xl font-semibold">资料完成度 {live}%</h1>
          <p className="mt-2 text-sm text-gray-500">
            {live >= state.settings.applyMinCompleteness ? '已经可以投递职位了。' : `还差一点：完成度到 ${state.settings.applyMinCompleteness}% 才能投递。`}
            {live >= state.settings.referralMinCompleteness && ' 你的邀请人也会因为你完成资料而多得查看额度。'}
          </p>
          <Progress value={live} className="mx-auto mt-4 max-w-xs" />
          <div className="mt-6 flex justify-center gap-3">
            <Button variant="white" onClick={() => nav('/s/resume')}>查看我的简历</Button>
            <Button onClick={() => nav('/jobs')}>去看职位</Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="wrap max-w-2xl py-6">
      <div className="mb-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-900">第 {step} / 4 步 · {STEPS[step - 1]}</span>
          <span className="text-gray-500">完成度 {score}%</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {STEPS.map((s, i) => <div key={s} className={cn('h-1.5 rounded-full', i < step ? 'bg-brand-500' : 'bg-gray-200')} />)}
        </div>
      </div>

      <Card className="p-5">
        {step === 1 && <BasicFields d={d} set={set} />}
        {step === 2 && <IntentFields d={d} set={set} />}
        {step === 3 && <SkillFields d={d} set={set} withHeadline />}
        {step === 4 && (
          <div className="space-y-6">
            <section>
              <h2 className="mb-2 font-semibold">教育经历</h2>
              {d.education.length ? d.education.map((e) => (
                <p key={e.school + e.period} className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{e.school} · {DEGREE_LABEL[e.degree]} · {e.major} · {e.period}{e.gpa && ` · GPA ${e.gpa}`}</p>
              )) : <p className="text-sm text-gray-500">回到第 1 步填好学校、专业和毕业年份，这里会自动生成。</p>}
            </section>
            <section>
              <h2 className="mb-2 font-semibold">实习 / 项目 / 校园经历 <span className="text-xs font-normal text-gray-400">（没有可以先跳过）</span></h2>
              {d.experiences.map((e) => <p key={e.id} className="mb-2 text-sm text-gray-700"><Tag>{e.kind}</Tag> {e.title} · {e.org}</p>)}
              <ExperienceForm exp={exp} setExp={setExp} />
              <Button variant="soft" size="sm" className="mt-3" disabled={!exp.title.trim()} onClick={() => { set({ experiences: [...d.experiences, exp] }); setExp({ id: uid(), kind: '实习', title: '', org: '', period: '', desc: '' }) }}>
                <Plus className="size-4" />添加这条经历
              </Button>
            </section>
            <section>
              <h2 className="mb-2 font-semibold">联系方式</h2>
              <ContactFields d={d} set={set} phoneOnly />
            </section>
            <section>
              <h2 className="mb-2 font-semibold">附件简历 PDF <span className="text-xs font-normal text-gray-400">（选填，HR 主要看上面的标准化简历）</span></h2>
              <Button variant={d.hasResume ? 'soft' : 'white'} size="sm" onClick={() => set({ hasResume: !d.hasResume, resumeName: `${d.fullName || '我的'}_简历.pdf` })}>
                <FileText className="size-4" />{d.hasResume ? '已上传（演示），点击移除' : '上传 PDF（演示）'}
              </Button>
            </section>
          </div>
        )}
      </Card>

      <div className="mt-4 flex items-center justify-between">
        {step > 1 ? <Button variant="ghost" onClick={() => go(step - 1)}>上一步</Button> : <Link to="/s/resume" className="text-sm text-gray-500 hover:text-brand-500">以后再填</Link>}
        <div className="flex gap-2">
          <Button variant="white" onClick={() => { actions.updateMe(step === 1 ? withEducation(d) : d); toast('已保存，可以稍后继续'); nav('/s/resume') }}>保存并退出</Button>
          <Button onClick={next}>{step === 4 ? '完成' : '下一步'}</Button>
        </div>
      </div>
    </div>
  )
}
