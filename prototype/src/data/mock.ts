// 原型用的模拟数据：所有企业、人物、编号均为虚构
import type { CompanyTag } from './taxonomy'

export type JobType = 'INTERNSHIP' | 'FULL_TIME' | 'PART_TIME'
export type WorkAuth = 'MY_CITIZEN' | 'MY_PR' | 'STUDENT_PASS' | 'DEPENDANT_PASS' | 'NEEDS_WORK_PASS' | 'OTHER'
export type Degree = 'DIPLOMA' | 'BACHELOR' | 'MASTER' | 'PHD'
export type LangLevel = 'BASIC' | 'CONVERSATIONAL' | 'FLUENT' | 'NATIVE'
export type JobStatus = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'CLOSED' | 'REJECTED'
export type AppStatus = 'APPLIED' | 'VIEWED' | 'SHORTLISTED' | 'INTERVIEW' | 'OFFER' | 'HIRED' | 'REJECTED' | 'WITHDRAWN'

export interface School { id: string; name: string; short: string; en: string }
export interface Company {
  id: string; name: string; short: string; industryCode: string; size: string; state: string; city: string
  tags: CompanyTag[]; founding?: boolean; color: string; intro: string; benefits: string[]; ssm: string; founded: number
}
export interface Job {
  id: string; companyId: string; title: string; type: JobType; category: string; state: string; city: string
  salaryMin: number; salaryMax: number; degree: Degree; languages: string[]; skills: string[]
  acceptsStudentPass: boolean; sponsorsWorkPass: boolean; headcount: number; publishedAt: string
  description: string[]; requirements: string[]; status: JobStatus; hot?: boolean; reviewNote?: string
  lat: number; lng: number; area: string; salaryHidden?: boolean
}
export interface Experience { id: string; kind: '实习' | '工作' | '项目' | '校园' | '奖项'; title: string; org: string; period: string; desc: string }
export interface Education { school: string; degree: Degree; major: string; period: string; gpa?: string }
export interface Student {
  id: string; fullName: string; schoolId: string; degree: Degree; major: string; gradYear: number; gradMonth: number
  nationality: string; workAuth: WorkAuth; intents: JobType[]; languages: { lang: string; level: LangLevel }[]
  skills: string[]; headline: string; summary: string; experiences: Experience[]; education: Education[]
  states: string[]; availableFrom: string; expectedSalary: string; lastActive: string; hasResume: boolean
  resumeName?: string; contact: { phone: string; email: string; whatsapp: string; wechat: string }
  visibility: 'PUBLIC' | 'HIDDEN'; cgpa?: number
}
export interface Partner { id: string; name: string; type: string; color: string; showOnHome: boolean }

export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

// ---------- 字典 ----------
export const JOB_TYPE_LABEL: Record<JobType, string> = { INTERNSHIP: '实习', FULL_TIME: '全职', PART_TIME: '兼职' }
export const WORK_AUTH_LABEL: Record<WorkAuth, string> = {
  MY_CITIZEN: '马来西亚公民', MY_PR: '马来西亚 PR', STUDENT_PASS: '学生准证',
  DEPENDANT_PASS: '家属准证', NEEDS_WORK_PASS: '需办工作准证', OTHER: '其他',
}
export const DEGREE_LABEL: Record<Degree, string> = { DIPLOMA: '大专', BACHELOR: '本科', MASTER: '硕士', PHD: '博士' }
export const LANG_LEVEL_LABEL: Record<LangLevel, string> = { BASIC: '入门', CONVERSATIONAL: '日常交流', FLUENT: '流利', NATIVE: '母语' }
export const LANG_LEVEL_RANK: Record<LangLevel, number> = { BASIC: 1, CONVERSATIONAL: 2, FLUENT: 3, NATIVE: 4 }
export const APP_STATUS_LABEL: Record<AppStatus, string> = {
  APPLIED: '新投递', VIEWED: '已查看', SHORTLISTED: '入围', INTERVIEW: '面试',
  OFFER: 'Offer', HIRED: '已录用', REJECTED: '不合适', WITHDRAWN: '已撤回',
}
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  DRAFT: '草稿', PENDING_REVIEW: '审核中', PUBLISHED: '招聘中', CLOSED: '已关闭', REJECTED: '未通过',
}
export const STATES = ['吉隆坡', '雪兰莪', '槟城', '柔佛', '霹雳', '森美兰', '马六甲', '布城', '沙巴', '砂拉越']
export const LANGS = ['中文', '英文', '马来文', '粤语', '淡米尔文']
export const HOT_SEARCHES = ['前端开发', '中马翻译', '会计', '跨境电商运营', '土木工程师', '数据分析', '管培生']

export const CATEGORIES = [
  { key: '技术', name: '技术/互联网', subs: ['前端开发', '后端开发', '数据分析', '算法工程师', '测试', '运维'] },
  { key: '产品', name: '产品/设计', subs: ['产品经理', 'UI设计', '交互设计'] },
  { key: '市场', name: '市场/运营', subs: ['跨境电商运营', '新媒体运营', '市场营销', '直播运营'] },
  { key: '销售', name: '销售/客户', subs: ['客户经理', '课程顾问', '销售代表'] },
  { key: '金融', name: '金融/财会', subs: ['会计', '审计', '金融分析', '风控'] },
  { key: '工程', name: '工程/制造', subs: ['土木工程师', '电气工程师', '机械工程师', '工艺工程师', '光伏'] },
  { key: '物流', name: '物流/贸易', subs: ['供应链', '报关', '采购', '国际贸易'] },
  { key: '行政', name: '翻译/行政/人事', subs: ['中马翻译', '中英翻译', '行政助理', '人力资源'] },
  { key: '教育', name: '教育/培训', subs: ['中文教师', '助教', '课程顾问'] },
]

export const SCHOOLS: School[] = [
  { id: 'xmum', name: '厦门大学马来西亚分校', short: '厦大马校', en: 'XMUM' },
  { id: 'utar', name: '拉曼大学', short: '拉曼大学', en: 'UTAR' },
  { id: 'um', name: '马来亚大学', short: '马来亚大学', en: 'UM' },
  { id: 'sunway', name: '双威大学', short: '双威大学', en: 'Sunway' },
  { id: 'taylors', name: '泰莱大学', short: '泰莱大学', en: "Taylor's" },
  { id: 'newera', name: '新纪元大学学院', short: '新纪元', en: 'New Era UC' },
  { id: 'southern', name: '南方大学学院', short: '南方大学', en: 'Southern UC' },
]

export const COMPANIES: Company[] = [
  { id: 'c1', name: '鹭江科技（马来西亚）有限公司', short: '鹭江科技', industryCode: 'tech.software', size: '201-1000人', state: '吉隆坡', city: '吉隆坡 · 孟沙', tags: ['ALUMNI'], founding: true, color: '#426EFF', founded: 2018, ssm: '201801012345 (1271234-K)', intro: '鹭江科技由厦大校友创立，为东南亚中小商家提供电商 SaaS 和支付对账服务，在吉隆坡和厦门设有研发中心。', benefits: ['弹性工作', '年度旅游', '双语团队', '导师制', '转正机会'] },
  { id: 'c2', name: '南洋建工集团马来西亚分公司', short: '南洋建工', industryCode: 'construction', size: '1000人以上', state: '雪兰莪', city: '莎阿南', tags: ['SOE', 'CN_OVERSEAS'], founding: true, color: '#E8590C', founded: 2009, ssm: '200901023456 (856789-A)', intro: '大型基建企业在马分支机构，承建轨道交通、港口与住宅项目，长期招聘工程与翻译人才。', benefits: ['项目奖金', '提供宿舍', '协助办理工作准证', '管培生计划'] },
  { id: 'c3', name: '星港跨境电商有限公司', short: '星港电商', industryCode: 'tech.ecommerce', size: '51-200人', state: '吉隆坡', city: '吉隆坡 · 武吉免登', tags: ['CN_OVERSEAS'], color: '#7048E8', founded: 2020, ssm: '202001034567 (1367890-D)', intro: '专注东南亚市场的跨境电商品牌商，在 Shopee、Lazada、TikTok Shop 运营多个类目的头部店铺。', benefits: ['业绩提成', '年轻团队', '免费午餐', '快速晋升'] },
  { id: 'c4', name: '丝路能源（马来西亚）有限公司', short: '丝路能源', industryCode: 'energy', size: '1000人以上', state: '柔佛', city: '新山', tags: ['SOE', 'CN_OVERSEAS', 'FORTUNE_500'], founding: true, color: '#0CA678', founded: 2015, ssm: '201501045678 (1123456-W)', intro: '电力能源企业在马投资运营的公司，负责电厂运维与新能源项目开发。', benefits: ['稳定发展', '海外培训', '交通补贴', '协助办理工作准证'] },
  { id: 'c5', name: '嘉禾金融服务有限公司', short: '嘉禾金融', industryCode: 'finance.securities', size: '201-1000人', state: '吉隆坡', city: '吉隆坡 · 敦拉萨国际贸易中心', tags: ['CHINESE_MY'], color: '#C2255C', founded: 2011, ssm: '201101056789 (945678-H)', intro: '本地华资金融服务集团，业务覆盖财富管理、企业融资与保险经纪。', benefits: ['专业培训', '绩效奖金', '医疗保险', 'CFA 资助'] },
  { id: 'c6', name: '芯海半导体（槟城）有限公司', short: '芯海半导体', industryCode: 'tech.hardware', size: '1000人以上', state: '槟城', city: '峇六拜自贸区', tags: ['CN_OVERSEAS', 'MULTINATIONAL'], color: '#1098AD', founded: 2019, ssm: '201901067890 (1323456-P)', intro: '半导体封装测试企业，槟城工厂是集团在东南亚的核心生产基地。', benefits: ['轮班津贴', '通勤巴士', '技能认证', '协助办理工作准证'] },
  { id: 'c7', name: '海峡物流集团', short: '海峡物流', industryCode: 'trade', size: '201-1000人', state: '雪兰莪', city: '巴生港', tags: ['CHINESE_MY', 'MY_LEADING'], color: '#F59F00', founded: 2003, ssm: '200301078901 (612345-T)', intro: '巴生港综合物流服务商，提供清关、仓储和中马跨境运输。', benefits: ['年终花红', '交通补贴', '带薪培训'] },
  { id: 'c8', name: '云帆数据科技有限公司', short: '云帆数据', industryCode: 'tech.software', size: '51-200人', state: '雪兰莪', city: '赛城', tags: ['ALUMNI'], founding: true, color: '#4263EB', founded: 2021, ssm: '202101089012 (1412345-M)', intro: '厦大校友创办的数据智能公司，为零售和金融客户提供数据平台与大模型应用。', benefits: ['技术分享', '远程办公', '股票期权', '设备补贴'] },
  { id: 'c9', name: '椰风教育集团', short: '椰风教育', industryCode: 'education', size: '51-200人', state: '吉隆坡', city: '吉隆坡 · 蕉赖', tags: ['CHINESE_MY'], color: '#37B24D', founded: 2014, ssm: '201401090123 (1087654-V)', intro: '面向本地华裔家庭的中文与升学辅导机构，在雪隆地区有 8 个教学点。', benefits: ['寒暑假', '教学培训', '课时奖金'] },
  { id: 'c10', name: '东盟汽车零部件有限公司', short: '东盟汽配', industryCode: 'manufacturing', size: '1000人以上', state: '霹雳', city: '怡保', tags: ['CN_OVERSEAS'], color: '#5C7CFA', founded: 2017, ssm: '201701101234 (1234567-U)', intro: '汽车零部件制造商，为东盟地区的整车厂配套生产底盘与电控部件。', benefits: ['提供宿舍', '技能津贴', '协助办理工作准证'] },
  { id: 'c11', name: '金桥会计师事务所', short: '金桥会计', industryCode: 'finance.accounting', size: '51-200人', state: '吉隆坡', city: '吉隆坡 · 旧巴生路', tags: ['CHINESE_MY'], color: '#AE3EC9', founded: 2006, ssm: '200601112345 (734567-X)', intro: '本地中型会计师事务所，服务大量中资在马企业的审计、税务与公司秘书业务。', benefits: ['ACCA 资助', '加班补贴', '导师带教'] },
  { id: 'c12', name: '绿洲新能源（马来西亚）有限公司', short: '绿洲新能源', industryCode: 'energy', size: '201-1000人', state: '森美兰', city: '芙蓉', tags: ['CN_OVERSEAS'], color: '#2F9E44', founded: 2022, ssm: '202201123456 (1456789-K)', intro: '光伏组件与电站 EPC 企业，正在建设马来西亚第二工厂。', benefits: ['项目奖金', '海外培训', '协助办理工作准证', '宿舍'] },
]

export const PARTNERS: Partner[] = [
  { id: 'p1', name: '厦大马来西亚校友会（示例）', type: '校友组织', color: '#426EFF', showOnHome: true },
  { id: 'p2', name: '中资企业驻马机构（示例）', type: '国企', color: '#E03131', showOnHome: true },
  { id: 'p3', name: '合作高校就业中心（示例）', type: '高校', color: '#0CA678', showOnHome: true },
  { id: 'p4', name: '南洋校友企业联盟（示例）', type: '企业联盟', color: '#7048E8', showOnHome: true },
  { id: 'p5', name: '中马青年创业协会（示例）', type: '社团', color: '#F59F00', showOnHome: true },
  { id: 'p6', name: '华商企业联合会（示例）', type: '商会', color: '#1098AD', showOnHome: false },
]

// ---------- 职位 ----------
// 近似坐标，只用于原型演示"附近"筛选
const CITY_GEO: Record<string, [number, number, string]> = {
  '吉隆坡 · 孟沙': [3.129, 101.679, '孟沙'], '莎阿南': [3.073, 101.518, '莎阿南'], '吉隆坡 · 武吉免登': [3.147, 101.711, '武吉免登'],
  '新山': [1.463, 103.761, '新山'], '吉隆坡 · 敦拉萨国际贸易中心': [3.142, 101.719, 'TRX'], '峇六拜自贸区': [5.297, 100.268, '峇六拜'],
  '巴生港': [3.0, 101.392, '巴生港'], '赛城': [2.921, 101.656, '赛城'], '吉隆坡 · 蕉赖': [3.093, 101.744, '蕉赖'],
  '怡保': [4.597, 101.09, '怡保'], '吉隆坡 · 旧巴生路': [3.098, 101.676, '旧巴生路'], '芙蓉': [2.726, 101.938, '芙蓉'],
}
/** 城市 → 坐标；未知城市落在吉隆坡市中心 */
export function geoOf(city: string) {
  const [lat, lng, area] = CITY_GEO[city] ?? [3.147, 101.695, city]
  return { lat, lng, area }
}

type JobInput = Omit<Job, 'status' | 'publishedAt' | 'lat' | 'lng' | 'area'> & { days: number; status?: JobStatus }
const job = ({ days, status = 'PUBLISHED', ...rest }: JobInput): Job => ({ ...rest, ...geoOf(rest.city), status, publishedAt: daysAgo(days) })

export const JOBS: Job[] = [
  job({ id: 'j1', companyId: 'c1', title: '前端开发实习生', type: 'INTERNSHIP', category: '技术', state: '吉隆坡', city: '吉隆坡 · 孟沙', salaryMin: 1500, salaryMax: 2000, degree: 'BACHELOR', languages: ['中文', '英文'], skills: ['React', 'TypeScript', 'CSS'], acceptsStudentPass: true, sponsorsWorkPass: false, headcount: 3, days: 1, hot: true,
    description: ['参与东南亚电商 SaaS 产品的前端开发', '与产品、设计、后端同学协作完成需求落地', '参与组件库建设和页面性能优化'],
    requirements: ['计算机相关专业在读，每周可实习 4 天以上，实习期不少于 3 个月', '熟悉 HTML / CSS / JavaScript，了解 React 或 Vue', '中英文读写流利，能阅读英文技术文档'] }),
  job({ id: 'j2', companyId: 'c1', title: '后端开发工程师（应届）', type: 'FULL_TIME', category: '技术', state: '吉隆坡', city: '吉隆坡 · 孟沙', salaryMin: 4500, salaryMax: 6500, degree: 'BACHELOR', languages: ['中文', '英文'], skills: ['Java', 'Spring Boot', 'MySQL'], acceptsStudentPass: false, sponsorsWorkPass: true, headcount: 2, days: 2, hot: true,
    description: ['负责支付对账、订单等核心服务的设计与开发', '参与系统稳定性建设和性能调优', '编写技术文档，参与代码评审'],
    requirements: ['2026 / 2027 届计算机相关专业本科及以上', '扎实的 Java 基础，熟悉 Spring Boot 和关系型数据库', '有完整项目经历者优先'] }),
  job({ id: 'j3', companyId: 'c1', title: '产品经理助理', type: 'INTERNSHIP', category: '产品', state: '吉隆坡', city: '吉隆坡 · 孟沙', salaryMin: 1200, salaryMax: 1800, degree: 'BACHELOR', languages: ['中文', '英文'], skills: ['需求分析', 'Axure', '数据分析'], acceptsStudentPass: true, sponsorsWorkPass: false, headcount: 1, days: 3,
    description: ['协助产品经理调研本地商家需求', '撰写需求文档、绘制原型', '跟进需求上线并分析数据效果'],
    requirements: ['专业不限，对互联网产品有热情', '逻辑清晰，善于沟通', '会马来文者优先'] }),
  job({ id: 'j4', companyId: 'c2', title: '土木工程师（管培生）', type: 'FULL_TIME', category: '工程', state: '雪兰莪', city: '莎阿南', salaryMin: 4000, salaryMax: 5500, degree: 'BACHELOR', languages: ['中文', '英文', '马来文'], skills: ['AutoCAD', '结构设计', '项目管理'], acceptsStudentPass: false, sponsorsWorkPass: true, headcount: 5, days: 1, hot: true,
    description: ['参与轨道交通 / 住宅项目的施工技术管理', '编制施工方案，参与图纸会审', '一年轮岗：技术、商务、安全质量'],
    requirements: ['土木工程相关专业本科', '能适应项目现场工作', '中英文流利，会马来文优先'] }),
  job({ id: 'j5', companyId: 'c2', title: '中马翻译（项目部）', type: 'FULL_TIME', category: '行政', state: '雪兰莪', city: '莎阿南', salaryMin: 3500, salaryMax: 4500, degree: 'BACHELOR', languages: ['中文', '马来文', '英文'], skills: ['笔译', '口译', '公文写作'], acceptsStudentPass: false, sponsorsWorkPass: false, headcount: 2, days: 4,
    description: ['负责项目会议的中马、中英口译', '翻译合同、往来函件和政府审批文件', '协助项目部与当地政府、分包商沟通'],
    requirements: ['中文、马来文均达到流利水平', '有正式场合口译经验者优先', '能接受出差'] }),
  job({ id: 'j6', companyId: 'c2', title: '工程管理实习生', type: 'INTERNSHIP', category: '工程', state: '雪兰莪', city: '莎阿南', salaryMin: 1000, salaryMax: 1500, degree: 'BACHELOR', languages: ['中文', '英文'], skills: ['施工管理', 'MS Project'], acceptsStudentPass: true, sponsorsWorkPass: false, headcount: 4, days: 5,
    description: ['跟随项目经理参与现场管理', '整理施工日志和进度报告'],
    requirements: ['土木 / 工程管理专业在读', '课程要求的实习优先'] }),
  job({ id: 'j7', companyId: 'c3', title: '跨境电商运营实习生', type: 'INTERNSHIP', category: '市场', state: '吉隆坡', city: '吉隆坡 · 武吉免登', salaryMin: 1200, salaryMax: 1600, degree: 'DIPLOMA', languages: ['中文', '英文'], skills: ['Shopee', 'TikTok Shop', '数据分析'], acceptsStudentPass: true, sponsorsWorkPass: false, headcount: 4, days: 0, hot: true,
    description: ['负责店铺日常运营：上新、活动报名、商品优化', '跟踪销售数据，输出周报', '参与大促活动策划'],
    requirements: ['对电商有兴趣，有开店经历者优先', '熟练使用 Excel', '每周可实习 4 天以上'] }),
  job({ id: 'j8', companyId: 'c3', title: '新媒体运营（中英双语）', type: 'FULL_TIME', category: '市场', state: '吉隆坡', city: '吉隆坡 · 武吉免登', salaryMin: 3200, salaryMax: 4200, degree: 'BACHELOR', languages: ['中文', '英文'], skills: ['小红书', 'TikTok', '文案'], acceptsStudentPass: false, sponsorsWorkPass: true, headcount: 1, days: 2,
    description: ['运营品牌 TikTok、Instagram、小红书账号', '策划短视频选题并跟进拍摄剪辑'],
    requirements: ['有账号运营作品者优先', '中英文写作能力强'] }),
  job({ id: 'j9', companyId: 'c4', title: '电气工程师', type: 'FULL_TIME', category: '工程', state: '柔佛', city: '新山', salaryMin: 4500, salaryMax: 6000, degree: 'BACHELOR', languages: ['中文', '英文'], skills: ['电力系统', 'AutoCAD', 'PLC'], acceptsStudentPass: false, sponsorsWorkPass: true, headcount: 3, days: 3, hot: true,
    description: ['负责电厂电气设备的运行维护', '参与新能源项目电气设计审查'],
    requirements: ['电气工程相关专业本科', '能适应倒班'] }),
  job({ id: 'j10', companyId: 'c4', title: '行政助理（中英文）', type: 'FULL_TIME', category: '行政', state: '柔佛', city: '新山', salaryMin: 2800, salaryMax: 3500, degree: 'DIPLOMA', languages: ['中文', '英文', '马来文'], skills: ['Office', '公文写作'], acceptsStudentPass: false, sponsorsWorkPass: false, headcount: 1, days: 6,
    description: ['负责公司日常行政事务和接待', '协助办理外籍员工准证手续'],
    requirements: ['大专及以上', '三语沟通流利'] }),
  job({ id: 'j11', companyId: 'c5', title: '金融分析实习生', type: 'INTERNSHIP', category: '金融', state: '吉隆坡', city: '吉隆坡 · 敦拉萨国际贸易中心', salaryMin: 1500, salaryMax: 2000, degree: 'BACHELOR', languages: ['中文', '英文'], skills: ['Excel', '财务建模', 'Python'], acceptsStudentPass: true, sponsorsWorkPass: false, headcount: 2, days: 1,
    description: ['协助分析师完成行业和公司研究', '搭建财务模型，整理数据'],
    requirements: ['金融、会计、经济类专业', '有 CFA 备考经历者优先'] }),
  job({ id: 'j12', companyId: 'c5', title: '客户经理（华语市场）', type: 'FULL_TIME', category: '销售', state: '吉隆坡', city: '吉隆坡 · 敦拉萨国际贸易中心', salaryMin: 3500, salaryMax: 6000, salaryHidden: true, degree: 'BACHELOR', languages: ['中文', '粤语', '英文'], skills: ['客户沟通', '金融产品'], acceptsStudentPass: false, sponsorsWorkPass: false, headcount: 3, days: 2,
    description: ['开发和维护华语高净值客户', '为客户提供财富管理方案'],
    requirements: ['沟通能力强，会粤语优先', '应届生可培养'] }),
  job({ id: 'j13', companyId: 'c6', title: '工艺工程师（应届）', type: 'FULL_TIME', category: '工程', state: '槟城', city: '峇六拜自贸区', salaryMin: 4800, salaryMax: 6500, degree: 'BACHELOR', languages: ['英文', '中文'], skills: ['半导体工艺', 'SPC', '6σ'], acceptsStudentPass: false, sponsorsWorkPass: true, headcount: 4, days: 2, hot: true,
    description: ['负责封装测试产线的工艺维护与改善', '分析良率数据，推动工艺优化'],
    requirements: ['微电子、材料、化工、机械等专业', '英文读写熟练'] }),
  job({ id: 'j14', companyId: 'c6', title: '设备维护实习生', type: 'INTERNSHIP', category: '工程', state: '槟城', city: '峇六拜自贸区', salaryMin: 1200, salaryMax: 1500, degree: 'DIPLOMA', languages: ['英文'], skills: ['机械维护', 'PLC'], acceptsStudentPass: true, sponsorsWorkPass: false, headcount: 6, days: 7,
    description: ['协助工程师完成设备保养和故障排查'],
    requirements: ['机械 / 机电相关专业在读'] }),
  job({ id: 'j15', companyId: 'c7', title: '供应链管培生', type: 'FULL_TIME', category: '物流', state: '雪兰莪', city: '巴生港', salaryMin: 3500, salaryMax: 4500, degree: 'BACHELOR', languages: ['中文', '英文', '马来文'], skills: ['供应链', 'ERP', 'Excel'], acceptsStudentPass: false, sponsorsWorkPass: true, headcount: 3, days: 3,
    description: ['18 个月轮岗：清关、仓储、运输、客服', '参与中马跨境专线项目'],
    requirements: ['物流、供应链、商科专业', '三语沟通优先'] }),
  job({ id: 'j16', companyId: 'c7', title: '报关专员', type: 'FULL_TIME', category: '物流', state: '雪兰莪', city: '巴生港', salaryMin: 3000, salaryMax: 3800, degree: 'DIPLOMA', languages: ['中文', '马来文'], skills: ['报关', '国际贸易'], acceptsStudentPass: false, sponsorsWorkPass: false, headcount: 2, days: 5,
    description: ['负责进出口货物报关单证制作', '对接海关与客户'],
    requirements: ['大专及以上，懂马来文'] }),
  job({ id: 'j17', companyId: 'c8', title: '数据分析实习生', type: 'INTERNSHIP', category: '技术', state: '雪兰莪', city: '赛城', salaryMin: 1500, salaryMax: 2200, degree: 'BACHELOR', languages: ['中文', '英文'], skills: ['Python', 'SQL', 'Power BI'], acceptsStudentPass: true, sponsorsWorkPass: false, headcount: 2, days: 0, hot: true,
    description: ['为零售客户搭建数据看板', '清洗数据，完成专题分析报告'],
    requirements: ['统计、计算机、数学相关专业', '熟悉 SQL 和 Python'] }),
  job({ id: 'j18', companyId: 'c8', title: '算法工程师（大模型应用）', type: 'FULL_TIME', category: '技术', state: '雪兰莪', city: '赛城', salaryMin: 6000, salaryMax: 9000, degree: 'MASTER', languages: ['中文', '英文'], skills: ['Python', 'PyTorch', 'LLM'], acceptsStudentPass: false, sponsorsWorkPass: true, headcount: 2, days: 1, hot: true,
    description: ['负责 RAG、Agent 等大模型应用的研发', '评估和优化模型效果'],
    requirements: ['计算机、人工智能相关专业硕士', '有大模型项目经验者优先'] }),
  job({ id: 'j19', companyId: 'c9', title: '中文课程助教（兼职）', type: 'PART_TIME', category: '教育', state: '吉隆坡', city: '吉隆坡 · 蕉赖', salaryMin: 1000, salaryMax: 1600, degree: 'BACHELOR', languages: ['中文', '英文'], skills: ['教学', '沟通'], acceptsStudentPass: false, sponsorsWorkPass: false, headcount: 5, days: 3,
    description: ['协助老师上课，批改作业', '周末上课，每周 8 - 12 小时'],
    requirements: ['中文表达好，有耐心'] }),
  job({ id: 'j20', companyId: 'c9', title: '课程顾问', type: 'FULL_TIME', category: '销售', state: '吉隆坡', city: '吉隆坡 · 蕉赖', salaryMin: 3000, salaryMax: 5000, degree: 'DIPLOMA', languages: ['中文', '英文'], skills: ['沟通', '销售'], acceptsStudentPass: false, sponsorsWorkPass: false, headcount: 2, days: 4,
    description: ['为家长提供课程咨询', '维护学员关系'],
    requirements: ['沟通能力强，有销售经验优先'] }),
  job({ id: 'j21', companyId: 'c10', title: '机械工程师', type: 'FULL_TIME', category: '工程', state: '霹雳', city: '怡保', salaryMin: 4200, salaryMax: 5500, degree: 'BACHELOR', languages: ['中文', '英文'], skills: ['SolidWorks', '机械设计'], acceptsStudentPass: false, sponsorsWorkPass: true, headcount: 3, days: 6,
    description: ['负责底盘零部件的结构设计和改进', '支持产线工艺问题解决'],
    requirements: ['机械工程相关专业', '熟练使用 SolidWorks'] }),
  job({ id: 'j22', companyId: 'c10', title: '采购助理实习生', type: 'INTERNSHIP', category: '物流', state: '霹雳', city: '怡保', salaryMin: 1000, salaryMax: 1300, degree: 'DIPLOMA', languages: ['中文', '英文'], skills: ['Excel', '采购'], acceptsStudentPass: true, sponsorsWorkPass: false, headcount: 2, days: 8,
    description: ['协助采购员询价、比价', '整理供应商资料'],
    requirements: ['商科、物流相关专业在读'] }),
  job({ id: 'j23', companyId: 'c11', title: '审计助理（应届）', type: 'FULL_TIME', category: '金融', state: '吉隆坡', city: '吉隆坡 · 旧巴生路', salaryMin: 3200, salaryMax: 4000, degree: 'BACHELOR', languages: ['中文', '英文'], skills: ['审计', 'ACCA', 'Excel'], acceptsStudentPass: false, sponsorsWorkPass: false, headcount: 4, days: 2,
    description: ['参与中资企业年度审计', '编制审计底稿'],
    requirements: ['会计专业，ACCA 在读者优先'] }),
  job({ id: 'j24', companyId: 'c11', title: '会计实习生', type: 'INTERNSHIP', category: '金融', state: '吉隆坡', city: '吉隆坡 · 旧巴生路', salaryMin: 1000, salaryMax: 1500, degree: 'DIPLOMA', languages: ['英文', '中文'], skills: ['会计', 'SQL Account'], acceptsStudentPass: true, sponsorsWorkPass: false, headcount: 3, days: 3,
    description: ['协助记账和报税资料整理'],
    requirements: ['会计专业在读'] }),
  job({ id: 'j25', companyId: 'c12', title: '光伏项目工程师', type: 'FULL_TIME', category: '工程', state: '森美兰', city: '芙蓉', salaryMin: 4500, salaryMax: 6000, degree: 'BACHELOR', languages: ['中文', '英文'], skills: ['光伏', '项目管理'], acceptsStudentPass: false, sponsorsWorkPass: true, headcount: 2, days: 5,
    description: ['负责光伏电站项目的现场技术管理', '协调设计、采购和施工'],
    requirements: ['电气、能源相关专业'] }),
  job({ id: 'j26', companyId: 'c12', title: '人力资源实习生', type: 'INTERNSHIP', category: '行政', state: '森美兰', city: '芙蓉', salaryMin: 1000, salaryMax: 1400, degree: 'BACHELOR', languages: ['中文', '英文', '马来文'], skills: ['招聘', 'Office'], acceptsStudentPass: true, sponsorsWorkPass: false, headcount: 1, days: 4,
    description: ['协助招聘、入职和员工活动组织'],
    requirements: ['人力资源相关专业在读'] }),
  job({ id: 'j27', companyId: 'c3', title: '直播运营实习生', type: 'INTERNSHIP', category: '市场', state: '吉隆坡', city: '吉隆坡 · 武吉免登', salaryMin: 1200, salaryMax: 1500, degree: 'DIPLOMA', languages: ['中文', '马来文'], skills: ['直播', 'TikTok Shop'], acceptsStudentPass: true, sponsorsWorkPass: false, headcount: 2, days: 0, status: 'PENDING_REVIEW',
    description: ['协助主播完成 TikTok 直播带货', '整理直播数据'],
    requirements: ['会马来文，镜头感好'] }),
]

// ---------- 学生 ----------
type StuInput = Omit<Student, 'education' | 'hasResume' | 'resumeName' | 'lastActive' | 'visibility' | 'expectedSalary'> & {
  active: number; education?: Education[]; expectedSalary?: string; visibility?: 'PUBLIC' | 'HIDDEN'
}
const stu = ({ active, education, expectedSalary, visibility = 'PUBLIC', ...s }: StuInput): Student => {
  const school = SCHOOLS.find((x) => x.id === s.schoolId)!
  const years = s.degree === 'MASTER' ? 1 : s.degree === 'DIPLOMA' ? 2 : 3
  return {
    ...s,
    lastActive: daysAgo(active),
    education: education ?? [{ school: school.name, degree: s.degree, major: s.major, period: `${s.gradYear - years}.09 - ${s.gradYear}.${String(s.gradMonth).padStart(2, '0')}` }],
    expectedSalary: expectedSalary ?? (s.intents.includes('FULL_TIME') ? 'RM 3,500 - 4,500 / 月' : 'RM 1,200 - 1,800 / 月'),
    visibility,
    hasResume: true,
    resumeName: `${s.fullName}_简历.pdf`,
  }
}
const contact = (phone: string, email: string, wechat = '') => ({ phone, email, wechat, whatsapp: phone })
const L = (lang: string, level: LangLevel) => ({ lang, level })

export const STUDENTS: Student[] = [
  stu({ id: 's1', cgpa: 3.72, fullName: '林雨晴', schoolId: 'xmum', degree: 'BACHELOR', major: '软件工程', gradYear: 2027, gradMonth: 6, nationality: '中国', workAuth: 'STUDENT_PASS', intents: ['INTERNSHIP'],
    languages: [L('中文', 'NATIVE'), L('英文', 'FLUENT'), L('马来文', 'BASIC')], skills: ['React', 'TypeScript', 'Python', 'Figma', 'SQL'],
    headline: '会做产品的前端，想去科技或跨境电商公司实习',
    summary: '厦大马来西亚分校软件工程大三学生，做过两个完整上线的项目，喜欢把产品体验做细。课程要求的实习期为 2026 年 12 月至 2027 年 3 月。',
    experiences: [
      { id: 'e1', kind: '实习', title: '前端开发实习生', org: '厦门某互联网公司', period: '2025.07 - 2025.09', desc: '负责商家后台 3 个模块的 React 开发，把列表页首屏加载时间从 3.2 秒降到 1.1 秒。' },
      { id: 'e2', kind: '项目', title: '校园二手交易平台（负责人）', org: '课程项目', period: '2025.02 - 2025.06', desc: '带 4 人小组完成需求、设计和开发，上线两个月有 600 多名同学注册。' },
      { id: 'e3', kind: '校园', title: '学生会技术部部长', org: '厦大马来西亚分校学生会', period: '2024.09 - 至今', desc: '负责学生会小程序和活动报名系统的维护。' },
    ],
    education: [{ school: '厦门大学马来西亚分校', degree: 'BACHELOR', major: '软件工程', period: '2023.09 - 2027.06', gpa: '3.72 / 4.0' }],
    states: ['吉隆坡', '雪兰莪'], availableFrom: '2026-12', expectedSalary: 'RM 1,500 - 2,000 / 月', active: 0,
    contact: contact('+60 11-2345 6789', 'yuqing.lin@example.com', 'lyq_2004') }),
  stu({ id: 's2', fullName: '陈俊杰', schoolId: 'utar', degree: 'BACHELOR', major: '电气与电子工程', gradYear: 2026, gradMonth: 12, nationality: '马来西亚', workAuth: 'MY_CITIZEN', intents: ['FULL_TIME'],
    languages: [L('中文', 'FLUENT'), L('英文', 'FLUENT'), L('马来文', 'FLUENT')], skills: ['PLC', 'AutoCAD', 'MATLAB', '电力系统'],
    headline: '三语流利的电气工程应届生，有变电站项目实习经历',
    summary: '拉曼大学电气与电子工程应届生，毕业设计做的是光伏并网逆变器控制。如需作品集请联系我：012-3456789。',
    experiences: [{ id: 'e1', kind: '实习', title: '电气工程实习生', org: '某电力工程承包商', period: '2025.06 - 2025.09', desc: '参与 2 个变电站改造项目的图纸绘制与现场调试。作品集可发邮件索取：junjie.chen@example.com' }],
    states: ['柔佛', '雪兰莪', '吉隆坡'], availableFrom: '2027-01', active: 1,
    contact: contact('012-345 6789', 'junjie.chen@example.com') }),
  stu({ id: 's3', cgpa: 3.85, fullName: '王思远', schoolId: 'xmum', degree: 'BACHELOR', major: '金融学', gradYear: 2027, gradMonth: 6, nationality: '中国', workAuth: 'STUDENT_PASS', intents: ['INTERNSHIP'],
    languages: [L('中文', 'NATIVE'), L('英文', 'FLUENT')], skills: ['Excel', 'Python', '财务建模', 'Wind'],
    headline: '金融专业，CFA 一级备考中，想做投研或分析类实习',
    summary: '对东南亚资本市场很感兴趣，课余在做马来西亚上市公司的行业研究笔记。',
    experiences: [{ id: 'e1', kind: '实习', title: '投研实习生', org: '某券商研究所', period: '2025.07 - 2025.08', desc: '协助完成消费行业深度报告的数据整理和图表制作。' }],
    states: ['吉隆坡'], availableFrom: '2026-12', active: 2,
    contact: contact('+60 16-888 1234', 'siyuan.wang@example.com', 'wsy_finance') }),
  stu({ id: 's4', cgpa: 3.6, fullName: 'Nur Aisyah binti Ahmad', schoolId: 'um', degree: 'BACHELOR', major: '会计学', gradYear: 2026, gradMonth: 12, nationality: '马来西亚', workAuth: 'MY_CITIZEN', intents: ['FULL_TIME'],
    languages: [L('马来文', 'NATIVE'), L('英文', 'FLUENT'), L('中文', 'CONVERSATIONAL')], skills: ['ACCA', 'SQL Account', 'Excel', '税务'],
    headline: '会说中文的马来西亚会计应届生，ACCA 已通过 9 门',
    summary: '在华文独中学过 3 年中文，能用中文和客户日常沟通。',
    experiences: [{ id: 'e1', kind: '实习', title: '审计实习生', org: '某会计师事务所', period: '2025.05 - 2025.08', desc: '参与 4 家中小企业的年审，负责存货和应收科目。' }],
    states: ['吉隆坡', '雪兰莪'], availableFrom: '2027-01', active: 3,
    contact: contact('+60 13-222 3344', 'aisyah.ahmad@example.com') }),
  stu({ id: 's5', cgpa: 3.41, fullName: '黄子轩', schoolId: 'sunway', degree: 'BACHELOR', major: '计算机科学', gradYear: 2027, gradMonth: 3, nationality: '马来西亚', workAuth: 'MY_CITIZEN', intents: ['INTERNSHIP', 'FULL_TIME'],
    languages: [L('中文', 'NATIVE'), L('英文', 'FLUENT'), L('马来文', 'CONVERSATIONAL')], skills: ['Python', 'SQL', 'Power BI', 'React', '机器学习'],
    headline: '数据和前端都能做的计算机专业学生',
    summary: '做过一个预测吉隆坡房租的机器学习项目，也在校园创业团队做过前端。',
    experiences: [{ id: 'e1', kind: '项目', title: '吉隆坡房租预测', org: '个人项目', period: '2025.03 - 2025.05', desc: '爬取 2 万条租房数据，用 XGBoost 建模，误差 8%。' }],
    states: ['吉隆坡', '雪兰莪'], availableFrom: '2026-11', active: 1,
    contact: contact('+60 17-555 6677', 'zixuan.huang@example.com', 'zx_huang') }),
  stu({ id: 's6', fullName: '欧阳晨曦', schoolId: 'xmum', degree: 'MASTER', major: '人工智能', gradYear: 2026, gradMonth: 12, nationality: '中国', workAuth: 'NEEDS_WORK_PASS', intents: ['FULL_TIME'],
    languages: [L('中文', 'NATIVE'), L('英文', 'FLUENT')], skills: ['PyTorch', 'LLM', 'Python', 'NLP', 'RAG'],
    headline: '大模型应用方向硕士，有 RAG 项目落地经验',
    summary: '毕业后希望留在马来西亚工作，需要企业协助办理工作准证。',
    experiences: [{ id: 'e1', kind: '项目', title: '多语种客服问答系统', org: '实验室横向项目', period: '2025.09 - 2026.06', desc: '基于 RAG 搭建中英马三语客服问答，准确率从 62% 提升到 85%。' }],
    states: ['雪兰莪', '吉隆坡'], availableFrom: '2027-01', active: 2,
    contact: contact('+60 11-6666 8888', 'chenxi.ouyang@example.com', 'oycx_ai') }),
  stu({ id: 's7', fullName: '李嘉欣', schoolId: 'newera', degree: 'DIPLOMA', major: '媒体与传播', gradYear: 2026, gradMonth: 11, nationality: '马来西亚', workAuth: 'MY_CITIZEN', intents: ['FULL_TIME'],
    languages: [L('中文', 'NATIVE'), L('英文', 'FLUENT'), L('马来文', 'FLUENT'), L('粤语', 'FLUENT')], skills: ['小红书', 'TikTok', 'Premiere', '文案', 'Canva'],
    headline: '做过 10 万粉账号的新媒体运营',
    summary: '擅长短视频选题和剪辑，熟悉本地华人和中国留学生两类受众。',
    experiences: [{ id: 'e1', kind: '实习', title: '新媒体运营实习生', org: '某美妆品牌', period: '2025.03 - 2025.08', desc: '独立运营品牌小红书账号，半年涨粉 10 万。作品集见 xhs.com/lijiaxin，微信：lijx_media' }],
    states: ['吉隆坡'], availableFrom: '2026-12', active: 0,
    contact: contact('+60 12-777 8899', 'jiaxin.li@example.com', 'lijx_media') }),
  stu({ id: 's8', cgpa: 3.55, fullName: '张伟', schoolId: 'xmum', degree: 'BACHELOR', major: '土木工程', gradYear: 2027, gradMonth: 6, nationality: '中国', workAuth: 'STUDENT_PASS', intents: ['INTERNSHIP'],
    languages: [L('中文', 'NATIVE'), L('英文', 'CONVERSATIONAL')], skills: ['AutoCAD', 'Revit', '结构力学', 'BIM'],
    headline: '土木工程大三，BIM 建模熟练，想参与海外基建项目',
    summary: '获得过校级结构设计竞赛一等奖。',
    experiences: [{ id: 'e1', kind: '奖项', title: '结构设计竞赛一等奖', org: '厦大马来西亚分校', period: '2025.04', desc: '团队设计的桥梁模型承重比全校第一。' }],
    states: ['雪兰莪', '柔佛'], availableFrom: '2026-12', active: 4,
    contact: contact('+60 11-1212 3434', 'wei.zhang@example.com', 'zw_civil') }),
  stu({ id: 's9', fullName: 'Tan Wei Ming', schoolId: 'taylors', degree: 'BACHELOR', major: '商业管理（供应链）', gradYear: 2026, gradMonth: 12, nationality: '马来西亚', workAuth: 'MY_CITIZEN', intents: ['FULL_TIME'],
    languages: [L('英文', 'NATIVE'), L('马来文', 'FLUENT'), L('中文', 'CONVERSATIONAL')], skills: ['供应链', 'SAP', 'Excel', '采购'],
    headline: '供应链专业应届生，有港口物流实习经验',
    summary: 'Supply chain graduate who enjoys solving messy operations problems.',
    experiences: [{ id: 'e1', kind: '实习', title: 'Logistics Intern', org: '某港口物流公司', period: '2025.06 - 2025.09', desc: '优化仓库拣货路线，把平均拣货时间缩短 15%。' }],
    states: ['雪兰莪', '槟城'], availableFrom: '2027-01', active: 5,
    contact: contact('+60 19-333 4455', 'weiming.tan@example.com') }),
  stu({ id: 's10', fullName: '刘可欣', schoolId: 'southern', degree: 'BACHELOR', major: '中文系（翻译方向）', gradYear: 2026, gradMonth: 12, nationality: '马来西亚', workAuth: 'MY_CITIZEN', intents: ['FULL_TIME'],
    languages: [L('中文', 'NATIVE'), L('马来文', 'FLUENT'), L('英文', 'FLUENT')], skills: ['笔译', '口译', '中马翻译', '公文写作'],
    headline: '中马英三语，做过政府活动现场口译',
    summary: '翻译过 20 万字的商务合同和政府公文。',
    experiences: [{ id: 'e1', kind: '实习', title: '翻译实习生', org: '某翻译公司', period: '2025.05 - 2025.08', desc: '完成中马互译约 8 万字，参与 3 场商务会议口译。' }],
    states: ['柔佛', '雪兰莪', '吉隆坡'], availableFrom: '2026-12', active: 1,
    contact: contact('+60 16-123 7788', 'kexin.liu@example.com', 'lkx_translate') }),
  stu({ id: 's11', cgpa: 3.3, fullName: '赵一鸣', schoolId: 'xmum', degree: 'BACHELOR', major: '机械工程', gradYear: 2027, gradMonth: 6, nationality: '中国', workAuth: 'STUDENT_PASS', intents: ['INTERNSHIP'],
    languages: [L('中文', 'NATIVE'), L('英文', 'FLUENT')], skills: ['SolidWorks', 'ANSYS', '机械设计', 'PLC'],
    headline: '机械工程大三，做过方程式赛车车架设计',
    summary: '大学方程式车队底盘组成员。',
    experiences: [{ id: 'e1', kind: '校园', title: '方程式车队底盘组', org: '厦大马来西亚分校车队', period: '2024.09 - 至今', desc: '负责车架有限元分析，减重 6%。' }],
    states: ['霹雳', '槟城', '雪兰莪'], availableFrom: '2026-12', active: 6,
    contact: contact('+60 11-5656 7878', 'yiming.zhao@example.com', 'zym_mech') }),
  stu({ id: 's12', fullName: 'Farah Izzati', schoolId: 'um', degree: 'BACHELOR', major: '人力资源管理', gradYear: 2027, gradMonth: 6, nationality: '马来西亚', workAuth: 'MY_CITIZEN', intents: ['INTERNSHIP'],
    languages: [L('马来文', 'NATIVE'), L('英文', 'FLUENT'), L('中文', 'BASIC')], skills: ['招聘', 'Office', '员工关系'],
    headline: '人力资源专业，正在学中文，想在中资企业实习',
    summary: '组织过 300 人规模的校园招聘日。',
    experiences: [{ id: 'e1', kind: '校园', title: '招聘日统筹', org: '马来亚大学职业发展社', period: '2025.03', desc: '对接 25 家企业，协调场地和流程。' }],
    states: ['吉隆坡', '森美兰'], availableFrom: '2027-03', active: 3,
    contact: contact('+60 14-909 1010', 'farah.izzati@example.com') }),
  stu({ id: 's13', fullName: '吴佳怡', schoolId: 'utar', degree: 'BACHELOR', major: '市场营销', gradYear: 2026, gradMonth: 12, nationality: '马来西亚', workAuth: 'MY_CITIZEN', intents: ['FULL_TIME'],
    languages: [L('中文', 'NATIVE'), L('英文', 'FLUENT'), L('马来文', 'FLUENT')], skills: ['Shopee', 'Lazada', '数据分析', 'Canva'],
    headline: '做过双 11 大促的电商运营应届生',
    summary: '在家族生意的网店做过两年运营。',
    experiences: [{ id: 'e1', kind: '工作', title: '网店运营', org: '家族企业', period: '2023.06 - 2025.06', desc: '负责 Shopee 店铺，月销售额从 2 万做到 8 万令吉。' }],
    states: ['吉隆坡', '雪兰莪'], availableFrom: '2026-12', active: 2,
    contact: contact('+60 12-456 1122', 'jiayi.wu@example.com', 'wjy_ecom') }),
  stu({ id: 's14', cgpa: 3.9, fullName: '周子涵', schoolId: 'xmum', degree: 'BACHELOR', major: '国际商务', gradYear: 2027, gradMonth: 6, nationality: '中国', workAuth: 'STUDENT_PASS', intents: ['INTERNSHIP'],
    languages: [L('中文', 'NATIVE'), L('英文', 'FLUENT')], skills: ['跨境电商', '数据分析', '市场调研', 'Excel'],
    headline: '国际商务专业，对东南亚跨境电商和产品很感兴趣',
    summary: '做过东南亚家电市场的调研报告。',
    experiences: [{ id: 'e1', kind: '项目', title: '东南亚小家电市场调研', org: '课程项目', period: '2025.09 - 2025.12', desc: '访谈 30 位本地消费者，输出 40 页调研报告。' }],
    states: ['吉隆坡'], availableFrom: '2026-12', active: 0,
    contact: contact('+60 11-3030 4040', 'zihan.zhou@example.com', 'zzh_biz') }),
  stu({ id: 's15', fullName: 'Lim Jia Hui', schoolId: 'utar', degree: 'BACHELOR', major: '微电子工程', gradYear: 2026, gradMonth: 12, nationality: '马来西亚', workAuth: 'MY_CITIZEN', intents: ['FULL_TIME'],
    languages: [L('英文', 'FLUENT'), L('中文', 'FLUENT'), L('马来文', 'FLUENT')], skills: ['半导体工艺', 'SPC', 'Python', '6σ'],
    headline: '微电子工程应届生，在槟城封测厂实习过',
    summary: '熟悉 SPC 和良率分析。',
    experiences: [{ id: 'e1', kind: '实习', title: 'Process Engineering Intern', org: '某封测厂', period: '2025.06 - 2025.11', desc: '分析键合工序良率数据，提出 2 项改善建议并被采纳。' }],
    states: ['槟城'], availableFrom: '2027-01', active: 1,
    contact: contact('+60 16-450 9988', 'jiahui.lim@example.com') }),
  stu({ id: 's16', fullName: '何诗琪', schoolId: 'xmum', degree: 'BACHELOR', major: '新闻传播', gradYear: 2027, gradMonth: 6, nationality: '马来西亚', workAuth: 'MY_CITIZEN', intents: ['INTERNSHIP'],
    languages: [L('中文', 'NATIVE'), L('英文', 'FLUENT'), L('马来文', 'CONVERSATIONAL')], skills: ['视频剪辑', '文案', '小红书', '摄影'],
    headline: '新闻传播专业，会拍会剪会写',
    summary: '校园电视台编导。',
    experiences: [{ id: 'e1', kind: '校园', title: '校园电视台编导', org: '厦大马来西亚分校', period: '2024.09 - 至今', desc: '策划并剪辑 20 多期校园新闻。' }],
    states: ['吉隆坡', '雪兰莪'], availableFrom: '2026-12', active: 1,
    contact: contact('+60 17-808 9090', 'shiqi.he@example.com', 'hsq_media') }),
  stu({ id: 's17', cgpa: 3.68, fullName: '孙浩然', schoolId: 'xmum', degree: 'MASTER', major: '数据科学', gradYear: 2026, gradMonth: 12, nationality: '中国', workAuth: 'NEEDS_WORK_PASS', intents: ['FULL_TIME'],
    languages: [L('中文', 'NATIVE'), L('英文', 'FLUENT')], skills: ['Python', 'Spark', 'SQL', 'Tableau', 'Java'],
    headline: '数据科学硕士，做过电商推荐系统',
    summary: '本科软件工程，有 Java 后端基础。',
    experiences: [{ id: 'e1', kind: '实习', title: '数据开发实习生', org: '某电商公司', period: '2025.06 - 2025.09', desc: '用 Spark 重构用户画像任务，运行时间缩短 40%。' }],
    states: ['吉隆坡', '雪兰莪'], availableFrom: '2027-01', active: 2,
    contact: contact('+60 11-7070 8080', 'haoran.sun@example.com', 'shr_data') }),
  stu({ id: 's18', fullName: '郑雅婷', schoolId: 'newera', degree: 'DIPLOMA', major: '会计', gradYear: 2026, gradMonth: 11, nationality: '马来西亚', workAuth: 'MY_CITIZEN', intents: ['FULL_TIME'],
    languages: [L('中文', 'NATIVE'), L('英文', 'FLUENT'), L('马来文', 'FLUENT')], skills: ['会计', 'Excel', 'SQL Account'],
    headline: '会计文凭应届生，细心靠谱',
    summary: '在会计公司兼职做过一年记账。',
    experiences: [{ id: 'e1', kind: '工作', title: '兼职记账员', org: '某会计公司', period: '2025.01 - 2025.12', desc: '为 12 家小企业做月度记账。' }],
    states: ['吉隆坡'], availableFrom: '2026-12', active: 7,
    contact: contact('+60 12-121 3131', 'yating.zheng@example.com') }),
  stu({ id: 's19', fullName: '冯一凡', schoolId: 'sunway', degree: 'BACHELOR', major: '计算机科学', gradYear: 2027, gradMonth: 6, nationality: '马来西亚', workAuth: 'MY_CITIZEN', intents: ['INTERNSHIP'],
    languages: [L('中文', 'NATIVE'), L('英文', 'FLUENT')], skills: ['Go', 'Docker', 'Linux'],
    headline: '后端方向，暂不公开档案', summary: '',
    experiences: [{ id: 'e1', kind: '项目', title: '个人博客系统', org: '个人项目', period: '2025', desc: '用 Go 写的博客系统。' }],
    states: ['雪兰莪'], availableFrom: '2027-01', active: 9, visibility: 'HIDDEN',
    contact: contact('+60 11-0000 1111', 'yifan.feng@example.com') }),
]

export const companyById = (id: string) => COMPANIES.find((c) => c.id === id)!
export const schoolById = (id: string) => SCHOOLS.find((s) => s.id === id)
