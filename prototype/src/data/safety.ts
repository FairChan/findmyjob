// 反诈专区内容（PRD v0.2 §2.6）。正式版放进 Article 表，由运营维护；电话一律由运营核实后再填
export interface Scam { title: string; signs: string[] }

export const SCAMS: Scam[] = [
  { title: '刷单兼职、"点赞赚钱"', signs: ['先让你做几单小任务，返一点钱建立信任', '接着要求你先垫付大额"订单"才能提现', '对方只用私人社交账号联系，不给公司地址'] },
  { title: '先交培训费、押金、制服费', signs: ['"录用后统一扣回"或"包过面试"', '要求转账到个人账户', '正规企业招聘不会向求职者收钱'] },
  { title: '扣押护照或学生准证', signs: ['以"办工作准证"为名要求把护照交给中介', '护照被扣后被迫在不合法的岗位工作', '护照是你的个人证件，任何雇主都无权扣留'] },
  { title: '"境外高薪"招聘', signs: ['薪资远高于同类职位，岗位描述含糊', '要求出境到第三国"入职"，机票由对方包办', '入境后被没收手机和证件'] },
]

export interface Contact { name: string; phone: string; note: string }

export const CONTACTS: Contact[] = [
  { name: '马来西亚报警与急救', phone: '999', note: '紧急情况直接拨打' },
  { name: '中国驻马来西亚大使馆领事保护', phone: '由运营核实后填写', note: '原型里不放未经核实的号码' },
  { name: '学校国际学生办公室', phone: '见本校官网', note: '准证和在学证明相关问题' },
]
