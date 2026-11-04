import { AlertTriangle, Flag, Phone, PlayCircle, ShieldAlert } from 'lucide-react'
import { CONTACTS, SCAMS } from '../../data/safety'
import { Card, SectionTitle } from '../../components/ui'

/** 反诈专区：常见骗局、视频和紧急联系方式（PRD v0.2 §2.6） */
export default function Safety() {
  return (
    <div className="wrap max-w-4xl py-8">
      <SectionTitle title="反诈专区" sub="找实习前花两分钟看一看，能避开大多数求职骗局" />
      <Card className="mb-5 flex gap-3 border-l-4 border-amber-400 p-4 text-sm text-gray-700">
        <ShieldAlert className="size-5 shrink-0 text-amber-500" />
        <p>FindMYJob 上的企业都经过 SSM 注册证书人工审核，但仍可能有人冒充。<b>任何要求你先交钱、交出证件的招聘，都先停下来</b>，在职位页点"举报这个职位"，或者问问同学和学联。</p>
      </Card>

      <h2 className="mb-3 flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-red-500" />常见骗局</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {SCAMS.map((s) => (
          <Card key={s.title} className="p-4">
            <p className="font-medium text-gray-900">{s.title}</p>
            <ul className="mt-2 space-y-1 text-sm text-gray-600">{s.signs.map((x) => <li key={x}>· {x}</li>)}</ul>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 mt-8 flex items-center gap-2 font-semibold"><PlayCircle className="size-4 text-brand-500" />视频</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {['留学生求职防骗三步走', '怎么核实一家公司是真的', '护照被扣怎么办'].map((t) => (
          <Card key={t} className="grid aspect-video place-items-center bg-gray-50 p-4 text-center text-sm text-gray-500">
            <span><PlayCircle className="mx-auto mb-2 size-8 text-gray-300" />{t}<br /><span className="text-xs">（视频由运营上传）</span></span>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 mt-8 flex items-center gap-2 font-semibold"><Phone className="size-4 text-emerald-600" />紧急联系</h2>
      <Card className="divide-y divide-gray-100">
        {CONTACTS.map((c) => (
          <div key={c.name} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 text-sm">
            <span className="font-medium text-gray-900">{c.name}</span>
            <span className="font-semibold text-brand-600">{c.phone}</span>
            <span className="text-xs text-gray-400 sm:ml-auto">{c.note}</span>
          </div>
        ))}
      </Card>

      <p className="mt-6 flex items-center gap-1.5 text-sm text-gray-500"><Flag className="size-4" />在任何职位详情页底部，都可以点"举报这个职位"。</p>
    </div>
  )
}
