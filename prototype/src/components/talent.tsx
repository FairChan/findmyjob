import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Send, Star, Unlock } from 'lucide-react'
import { DEGREE_LABEL, LANG_LEVEL_LABEL, WORK_AUTH_LABEL, schoolById, type Student, type WorkAuth } from '../data/mock'
import { HR_NAME, MY_COMPANY_ID, companyJobs, hasAccess, invitesThisMonth, useStore } from '../store'
import { maskName } from '../lib/privacy'
import { cn, formatDate, timeAgo } from '../lib/utils'
import { Avatar, Button, Card, Field, Modal, Select, Tag, Textarea, buttonClass } from './ui'
import { useToast } from './toast'
import { companyById } from '../data/mock'

export const authTone = (a: WorkAuth) => (a === 'MY_CITIZEN' || a === 'MY_PR' ? 'green' : a === 'STUDENT_PASS' ? 'blue' : 'orange') as 'green' | 'blue' | 'orange'

/** 人才卡片。企业侧的姓名脱敏都走这里（对应 serializers/talent-card.ts） */
export function TalentCard({ student, preview, onInvite }: { student: Student; preview?: boolean; onInvite?: (s: Student) => void }) {
  const { state, actions } = useStore()
  const toast = useToast()
  const unlocked = !preview && hasAccess(state, student.id)
  const name = unlocked ? student.fullName : maskName(student.fullName)
  const fav = state.talentFavorites.includes(student.id)
  const appliedToUs = state.applications.some((a) => a.studentId === student.id && companyJobs(state).some((j) => j.id === a.jobId))
  return (
    <Card className={cn('flex flex-col gap-4 p-4 sm:flex-row', !preview && 'transition hover:border-brand-200 hover:shadow-md')}>
      <Avatar name={name} size={48} masked={!unlocked} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {preview ? <span className="font-semibold">{name}</span> : <Link to={`/e/talent/${student.id}`} className="font-semibold hover:text-brand-500">{name}</Link>}
          <span className="text-sm text-gray-500">{student.gradYear} 届 · {DEGREE_LABEL[student.degree]}</span>
          <Tag tone={authTone(student.workAuth)}>{WORK_AUTH_LABEL[student.workAuth]}</Tag>
          {unlocked && <Tag tone="green"><Unlock className="size-3" />已解锁</Tag>}
          {!preview && appliedToUs && <Tag tone="blue">投递过本公司</Tag>}
        </div>
        <p className="mt-1 text-sm text-gray-600">{schoolById(student.schoolId)?.name} · {student.major}</p>
        <p className="mt-1.5 line-clamp-1 text-sm text-gray-800">{student.headline}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {student.languages.map((l) => <Tag key={l.lang}>{l.lang} · {LANG_LEVEL_LABEL[l.level]}</Tag>)}
          {student.skills.slice(0, preview ? 3 : 5).map((s) => <Tag key={s} tone="blue">{s}</Tag>)}
        </div>
      </div>
      {!preview && (
        <div className="flex shrink-0 flex-row items-center justify-between gap-2 sm:flex-col sm:items-end">
          <span className="text-xs text-gray-400">{timeAgo(student.lastActive)}活跃</span>
          <div className="flex gap-2">
            <Button
              variant="white"
              size="sm"
              aria-label={fav ? '取消收藏' : '收藏'}
              onClick={() => {
                actions.toggleTalentFavorite(student.id)
                toast(fav ? '已取消收藏' : '已加入收藏夹')
              }}
            >
              <Star className={cn('size-4', fav && 'fill-amber-400 text-amber-400')} />
            </Button>
            {onInvite && <Button variant="outline" size="sm" onClick={() => onInvite(student)}><Send className="size-3.5" />邀请投递</Button>}
            <Link to={`/e/talent/${student.id}`} className={buttonClass('primary', 'sm')}>查看</Link>
          </div>
        </div>
      )}
    </Card>
  )
}

/** 邀请投递：不扣点，占邀请配额（PRD §3.4） */
export function useInviteFlow() {
  const { state, actions } = useStore()
  const toast = useToast()
  const [target, setTarget] = useState<Student | null>(null)
  const jobs = companyJobs(state).filter((j) => j.status === 'PUBLISHED')
  const [jobId, setJobId] = useState('')
  const [msg, setMsg] = useState('')
  const open = (s: Student) => {
    setTarget(s)
    setJobId(jobs[0]?.id ?? '')
    setMsg(`你好，我们是${companyById(MY_COMPANY_ID).short}，看到你的经历和我们的岗位很匹配，欢迎投递！`)
  }
  const used = invitesThisMonth(state)
  const modal = target && (
    <Modal
      open
      onClose={() => setTarget(null)}
      title={`邀请 ${hasAccess(state, target.id) ? target.fullName : maskName(target.fullName)} 投递`}
      footer={
        <>
          <Button variant="ghost" onClick={() => setTarget(null)}>取消</Button>
          <Button
            disabled={!jobId}
            onClick={() => {
              const r = actions.invite(target.id, jobId, msg)
              if (r === 'ok') toast('邀请已发送，学生接受后会出现在「收到的简历」里')
              else if (r === 'exists') toast('已经邀请过这位同学投递该职位', 'info')
              else toast('本月邀请次数已用完', 'error')
              setTarget(null)
            }}
          >
            发送邀请
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="邀请投递的职位">
          <Select value={jobId} onChange={(e) => setJobId(e.target.value)}>{jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</Select>
        </Field>
        <Field label="邀请留言"><Textarea value={msg} onChange={(e) => setMsg(e.target.value)} /></Field>
        <p className="rounded-lg bg-brand-50 p-3 text-xs text-brand-700">邀请不消耗点数。本月已用 {used} / {state.settings.invitationQuota} 次。学生接受后视为投递，可免费查看联系方式。</p>
      </div>
    </Modal>
  )
  return { open, modal }
}

/** 带水印的简历预览（对应 ARCHITECTURE §5.5） */
export function WatermarkModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const mark = `仅供 ${companyById(MY_COMPANY_ID).short} 招聘使用 · ${formatDate(new Date().toISOString())} · ${HR_NAME}`
  return (
    <Modal open onClose={onClose} title="简历已生成（带水印）" width={640} footer={<Button onClick={onClose}>完成</Button>}>
      <p className="mb-3 text-sm text-gray-500">企业下载的每一页都会加上水印，降低简历被转卖或外传的风险。</p>
      <div className="relative mx-auto aspect-[1/1.3] max-w-md overflow-hidden rounded-lg border border-gray-200 bg-white p-8 shadow-inner">
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-around opacity-[0.13]">
          {Array.from({ length: 7 }).map((_, i) => (
            <p key={i} className="-rotate-[24deg] whitespace-nowrap text-center text-sm font-semibold text-gray-900">{mark}　{mark}</p>
          ))}
        </div>
        <p className="text-xl font-bold">{student.fullName}</p>
        <p className="mt-1 text-xs text-gray-500">{student.contact.phone} · {student.contact.email}</p>
        <div className="mt-5 space-y-2">
          <div className="h-2 w-24 rounded bg-brand-200" />
          <p className="text-xs text-gray-600">{schoolById(student.schoolId)?.name} · {student.major} · {student.gradYear}</p>
          <div className="h-2 w-24 rounded bg-brand-200" />
          {student.experiences.map((e) => <p key={e.id} className="text-xs text-gray-600">{e.title} · {e.org}</p>)}
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-1.5 rounded bg-gray-100" style={{ width: `${60 + ((i * 37) % 40)}%` }} />)}
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-gray-400">原型：真实系统会用 pdf-lib 在原始 PDF 每页加水印后下载</p>
    </Modal>
  )
}
