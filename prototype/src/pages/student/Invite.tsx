import { Copy, Gift, UserPlus } from 'lucide-react'
import { myQuota, useStore } from '../../store'
import { maskName } from '../../lib/privacy'
import { cn, formatDate } from '../../lib/utils'
import { Button, Card, Empty, Progress, Tag } from '../../components/ui'
import { useToast } from '../../components/toast'

/** 邀请好友 / 我的查看额度（PRD v0.2 §2.5） */
export default function Invite() {
  const { state } = useStore()
  const toast = useToast()
  const st = state.settings
  const q = myQuota(state)
  // 原型用 HashRouter，链接直接打开注册页并带上邀请码
  const link = `https://findmyjob.asia/#/login?ref=${state.me.id.toUpperCase()}7Q`
  const marks = Array.from({ length: Math.ceil(st.unlimitedAt / st.tierSize) }, (_, i) => Math.min((i + 1) * st.tierSize, st.unlimitedAt))

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h1 className="flex items-center gap-2 text-lg font-semibold"><Gift className="size-5 text-brand-500" />我的查看额度</h1>
        {!st.quotaEnabled || q.limit === null ? (
          <p className="mt-2 text-sm text-gray-600">{st.quotaEnabled ? '你已经邀请满 ' + st.unlimitedAt + ' 位同学，查看职位详情不限次数。' : '目前查看职位详情不限次数。'}</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-gray-600">已看 <b className="text-brand-500">{q.used}</b> / {q.limit} 个职位详情。已投递和企业邀请你投递的职位不占额度。</p>
            <Progress value={Math.min(100, (q.used / q.limit) * 100)} className="mt-3" />
          </>
        )}
        <ul className="mt-4 space-y-1 text-sm text-gray-500">
          <li>· 注册后可以看 {st.baseJobViews} 个职位详情</li>
          <li>· 每邀请 {st.tierSize} 位同学完成资料（完成度 ≥ {st.referralMinCompleteness}%），多看 {st.tierBonus} 个</li>
          <li>· 累计邀请 {st.unlimitedAt} 位，查看不限次数</li>
        </ul>
        {st.studentBillingEnabled && <Button variant="ghost" size="sm" className="mt-3" disabled>购买额度（即将开放）</Button>}
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold"><UserPlus className="size-4 text-brand-500" />邀请同学</h2>
        <div className="mt-3 flex gap-2">
          <input readOnly value={link} className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-600" aria-label="邀请链接" />
          <Button onClick={() => { navigator.clipboard?.writeText(link).catch(() => {}); toast('邀请链接已复制') }}><Copy className="size-4" />复制</Button>
        </div>
        <div className="mt-5">
          <div className="flex justify-between text-xs text-gray-500"><span>有效邀请 {q.qualified} 位</span>{q.next && <span>再邀请 {q.next.need} 位{q.next.bonus === 'UNLIMITED' ? '，不限次数' : `，多看 ${q.next.bonus} 个`}</span>}</div>
          <div className="relative mt-2">
            <Progress value={Math.min(100, (q.qualified / st.unlimitedAt) * 100)} />
            <div className="mt-1 flex justify-between text-[11px] text-gray-400">
              <span>0</span>
              {marks.map((m) => <span key={m} className={cn(q.qualified >= m && 'font-medium text-brand-500')}>{m}</span>)}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">我邀请的同学</h2>
        {state.referrals.length === 0 ? (
          <Empty title="还没有邀请记录" desc="把上面的链接发到班级群或学联群里试试" />
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {state.referrals.map((r) => {
              const ok = r.status !== 'VOID' && r.emailVerified && r.completeness >= st.referralMinCompleteness
              return (
                <li key={r.id} className="flex items-center gap-3 py-3 text-sm">
                  <span className="font-medium">{maskName(r.inviteeName)}</span>
                  <span className="text-xs text-gray-400">{formatDate(r.createdAt)}</span>
                  <span className="ml-auto">
                    {r.status === 'VOID' ? <Tag>已作废</Tag> : ok ? <Tag tone="green">已生效</Tag> : <Tag tone="amber">资料未完成（{r.completeness}%）</Tag>}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
