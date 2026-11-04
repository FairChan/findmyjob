import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Eye, FileText, Lock, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import {
  DEGREE_LABEL, JOB_TYPE_LABEL, LANG_LEVEL_LABEL, LANG_LEVEL_RANK, WORK_AUTH_LABEL, schoolById,
  type Experience, type Student,
} from '../../data/mock'
import { useStore } from '../../store'
import { completeness, MIN_COMPLETENESS } from '../../lib/privacy'
import { cn, uid } from '../../lib/utils'
import { Avatar, Button, Card, Modal, Progress, Tag, Toggle } from '../../components/ui'
import { TalentCard } from '../../components/talent'
import { BasicFields, ContactFields, ExperienceForm, IntentFields, SkillFields } from '../../components/profile-fields'
import { useToast } from '../../components/toast'

function Section({ title, sub, icon, onEdit, action, children }: { title: string; sub?: string; icon?: ReactNode; onEdit?: () => void; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 font-semibold">{icon}{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
        </div>
        {action ?? (onEdit && <Button variant="ghost" size="sm" onClick={onEdit}><Pencil className="size-3.5" />编辑</Button>)}
      </div>
      {children}
    </Card>
  )
}

type EditKind = 'basic' | 'intent' | 'skills' | 'contact' | 'exp' | null

function EditModal({ kind, me, onClose }: { kind: Exclude<EditKind, null>; me: Student; onClose: () => void }) {
  const { actions } = useStore()
  const toast = useToast()
  const [d, setD] = useState<Student>(structuredClone(me))
  const [exp, setExp] = useState<Experience>({ id: uid(), kind: '实习', title: '', org: '', period: '', desc: '' })
  const save = () => {
    if (kind === 'exp') {
      if (!exp.title.trim()) return toast('请填写经历名称', 'error')
      actions.updateMe({ experiences: [exp, ...me.experiences] })
    } else actions.updateMe(d)
    toast('已保存')
    onClose()
  }
  const set = (p: Partial<Student>) => setD({ ...d, ...p })
  const titles = { basic: '编辑基本信息', intent: '编辑求职意向', skills: '编辑语言与技能', contact: '编辑联系方式', exp: '添加经历' }
  return (
    <Modal open onClose={onClose} title={titles[kind]} width={560} footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button onClick={save}>保存</Button></>}>
      {kind === 'basic' && <BasicFields d={d} set={set} withSummary />}
      {kind === 'intent' && <IntentFields d={d} set={set} />}
      {kind === 'skills' && <SkillFields d={d} set={set} />}
      {kind === 'contact' && <ContactFields d={d} set={set} />}
      {kind === 'exp' && <ExperienceForm exp={exp} setExp={setExp} />}
    </Modal>
  )
}

export default function Resume() {
  const { state, actions } = useStore()
  const toast = useToast()
  const me = state.me
  const [edit, setEdit] = useState<EditKind>(null)
  const { score, items } = completeness(me)
  const school = schoolById(me.schoolId)
  const inPool = me.visibility === 'PUBLIC' && score >= MIN_COMPLETENESS
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        <Card className="p-5">
          <div className="flex flex-wrap items-start gap-4">
            <Avatar name={me.fullName} size={64} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold">{me.fullName}</h1>
                <Tag tone="green"><BadgeCheck className="size-3" />学校已认证</Tag>
              </div>
              <p className="mt-1 text-sm text-gray-500">{school?.name} · {DEGREE_LABEL[me.degree]} · {me.major} · {me.gradYear} 年 {me.gradMonth} 月毕业</p>
              <p className="mt-1 text-sm text-gray-500">国籍 {me.nationality} · 工作资格：{WORK_AUTH_LABEL[me.workAuth]}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEdit('basic')}><Pencil className="size-3.5" />编辑</Button>
          </div>
          <div className="mt-4 rounded-lg bg-brand-50/70 p-4">
            <div className="flex items-center justify-between text-sm"><span>简历完成度</span><span className="font-semibold text-brand-600">{score}%</span></div>
            <Progress value={score} className="mt-2" />
            <div className="mt-3 flex flex-wrap gap-2">
              {items.map((i) => (
                <span key={i.label} className={cn('rounded-full px-2.5 py-0.5 text-xs', i.got >= i.pts ? 'bg-white text-gray-400 line-through' : 'bg-white text-brand-600')}>
                  {i.label} {i.got >= i.pts ? '✓' : `+${i.pts - i.got}`}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">完成度达到 {MIN_COMPLETENESS}% 才会出现在企业人才库中</p>
          </div>
        </Card>

        <Section title="求职意向" onEdit={() => setEdit('intent')}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-gray-400">求职类型</dt><dd className="mt-1 flex gap-1.5">{me.intents.map((t) => <Tag key={t} tone="blue">{JOB_TYPE_LABEL[t]}</Tag>)}</dd></div>
            <div><dt className="text-gray-400">意向地区</dt><dd className="mt-1">{me.states.join('、') || '未填写'}</dd></div>
            <div><dt className="text-gray-400">最早到岗</dt><dd className="mt-1">{me.availableFrom || '未填写'}</dd></div>
            <div><dt className="text-gray-400">期望薪资</dt><dd className="mt-1">{me.expectedSalary || '面议'}</dd></div>
          </dl>
        </Section>

        <Section title="自我介绍" onEdit={() => setEdit('basic')}>
          <p className="font-medium">{me.headline}</p>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">{me.summary}</p>
        </Section>

        <Section title="语言与技能" onEdit={() => setEdit('skills')}>
          <div className="space-y-2">
            {me.languages.map((l) => (
              <div key={l.lang} className="flex items-center gap-3 text-sm">
                <span className="w-14 text-gray-600">{l.lang}</span>
                <div className="flex gap-1">{[1, 2, 3, 4].map((n) => <span key={n} className={cn('h-2 w-8 rounded-full', n <= LANG_LEVEL_RANK[l.level] ? 'bg-brand-500' : 'bg-gray-100')} />)}</div>
                <span className="text-xs text-gray-400">{LANG_LEVEL_LABEL[l.level]}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">{me.skills.map((s) => <Tag key={s} tone="blue">{s}</Tag>)}</div>
        </Section>

        <Section title="实习 / 项目 / 校园经历" action={<Button variant="ghost" size="sm" onClick={() => setEdit('exp')}><Plus className="size-4" />添加</Button>}>
          <div className="space-y-4">
            {me.experiences.map((e) => (
              <div key={e.id} className="group relative border-l-2 border-brand-100 pl-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag>{e.kind}</Tag>
                  <span className="font-medium">{e.title}</span>
                  <span className="text-sm text-gray-500">{e.org}</span>
                  <span className="ml-auto text-xs text-gray-400">{e.period}</span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{e.desc}</p>
                <button
                  className="absolute -left-2.5 top-0 hidden size-5 cursor-pointer place-items-center rounded-full bg-white text-gray-400 shadow group-hover:grid hover:text-red-500"
                  aria-label="删除"
                  onClick={() => {
                    actions.updateMe({ experiences: me.experiences.filter((x) => x.id !== e.id) })
                    toast('已删除')
                  }}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </Section>

        <Section title="教育经历">
          {me.education.map((e) => (
            <div key={e.school} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{e.school}</span>
              <span className="text-gray-500">{DEGREE_LABEL[e.degree]} · {e.major}</span>
              {e.gpa && <Tag>GPA {e.gpa}</Tag>}
              <span className="ml-auto text-xs text-gray-400">{e.period}</span>
            </div>
          ))}
        </Section>

        <Section title="附件简历" sub="企业解锁或你投递后才能下载，下载时自动加水印">
          {me.hasResume ? (
            <div className="flex items-center gap-3 rounded-lg border border-gray-100 p-3">
              <FileText className="size-8 text-red-500" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{me.resumeName}</p><p className="text-xs text-gray-400">PDF · 主简历</p></div>
              <Button variant="ghost" size="sm" onClick={() => { actions.updateMe({ hasResume: false, resumeName: undefined }); toast('已删除附件简历') }}><Trash2 className="size-4" /></Button>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-gray-200 p-6 text-sm text-gray-500 hover:border-brand-300">
              <Upload className="size-6 text-brand-400" />
              <span className="mt-2">点击上传 PDF（≤ 5MB）</span>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  if (f.size > 5 * 1024 * 1024) return toast('文件超过 5MB', 'error')
                  actions.updateMe({ hasResume: true, resumeName: f.name })
                  toast('上传成功')
                }}
              />
            </label>
          )}
        </Section>

        <Section title="联系方式" icon={<Lock className="size-4 text-emerald-500" />} sub="只有你投递的企业，或付费解锁你的认证企业可以看到" onEdit={() => setEdit('contact')}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-gray-400">手机号</dt><dd className="mt-1">{me.contact.phone || '未填写'}</dd></div>
            <div><dt className="text-gray-400">联系邮箱</dt><dd className="mt-1">{me.contact.email || '未填写'}</dd></div>
            <div><dt className="text-gray-400">WhatsApp</dt><dd className="mt-1">{me.contact.whatsapp || '未填写'}</dd></div>
            <div><dt className="text-gray-400">微信</dt><dd className="mt-1">{me.contact.wechat || '未填写'}</dd></div>
          </dl>
        </Section>
      </div>

      <aside className="space-y-4">
        <Card className="p-4">
          <h3 className="flex items-center gap-1.5 font-semibold"><Eye className="size-4 text-brand-500" />企业在人才库看到的你</h3>
          <p className="mb-3 mt-1 text-xs text-gray-400">解锁前，姓名只显示姓氏，联系方式和原始简历都看不到</p>
          {inPool ? <TalentCard student={me} preview /> : <p className="rounded-lg bg-gray-50 p-4 text-center text-sm text-gray-500">{me.visibility === 'HIDDEN' ? '你已关闭人才库，企业搜不到你' : `完成度不足 ${MIN_COMPLETENESS}%，暂不进入人才库`}</p>}
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">加入人才库</p>
              <p className="mt-0.5 text-xs text-gray-400">关闭后企业无法主动找到你，但你仍可投递</p>
            </div>
            <Toggle
              label="加入人才库"
              checked={me.visibility === 'PUBLIC'}
              onChange={(v) => {
                actions.setVisibility(v ? 'PUBLIC' : 'HIDDEN')
                toast(v ? '已加入人才库' : '已退出人才库')
              }}
            />
          </div>
          <Link to="/s/privacy" className="mt-3 block text-sm text-brand-500 hover:underline">隐私中心：屏蔽公司、查看谁看过我 →</Link>
        </Card>
      </aside>
      {edit && <EditModal kind={edit} me={me} onClose={() => setEdit(null)} />}
    </div>
  )
}
