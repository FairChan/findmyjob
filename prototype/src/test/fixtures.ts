import type { Company, Job, Student } from '../data/mock'

// 测试数据：默认值故意选得"中性"，不碰到 synonyms.ts 里的任何词，避免搜索测试误命中

export function emptyStudent(p: Partial<Student> = {}): Student {
  return {
    id: 'sx', fullName: '', schoolId: '', degree: '' as Student['degree'], major: '', gradYear: 0, gradMonth: 0,
    nationality: '', workAuth: '' as Student['workAuth'], intents: [], languages: [], skills: [], headline: '', summary: '',
    experiences: [], education: [], states: [], availableFrom: '', expectedSalary: '', lastActive: '2026-11-01T00:00:00.000Z',
    hasResume: false, contact: { phone: '', email: '', whatsapp: '', wechat: '' }, visibility: 'PUBLIC',
    ...p,
  }
}

/** 除 PDF 外全部填满 */
export function fullStudent(p: Partial<Student> = {}): Student {
  return emptyStudent({
    fullName: '测试同学', schoolId: 'xmum', degree: 'BACHELOR', major: '土木工程', gradYear: 2027, gradMonth: 6,
    nationality: '中国', workAuth: 'STUDENT_PASS', intents: ['INTERNSHIP'], states: ['雪兰莪'], availableFrom: '2026-12',
    languages: [{ lang: '中文', level: 'NATIVE' }], skills: ['AutoCAD', 'Revit', 'BIM'], headline: '一句话介绍',
    experiences: [{ id: 'e1', kind: '项目', title: '桥梁模型', org: '课程', period: '2025', desc: '' }],
    education: [{ school: '厦门大学马来西亚分校', degree: 'BACHELOR', major: '土木工程', period: '2023.09 - 2027.06' }],
    contact: { phone: '+60 11-0000 0000', email: '', whatsapp: '', wechat: '' },
    ...p,
  })
}

export function fixtureJob(p: Partial<Job> = {}): Job {
  return {
    id: 'jx', companyId: 'cx', title: '岗位', type: 'INTERNSHIP', category: '工程', state: '雪兰莪', city: '莎阿南',
    salaryMin: 1000, salaryMax: 1500, degree: 'BACHELOR', languages: [], skills: [], acceptsStudentPass: true,
    sponsorsWorkPass: false, headcount: 1, publishedAt: '2026-11-01T00:00:00.000Z', description: [], requirements: [],
    status: 'PUBLISHED', lat: 3.073, lng: 101.518, area: '莎阿南',
    ...p,
  }
}

export function fixtureCompany(p: Partial<Company> = {}): Company {
  return {
    id: 'cx', name: '测试公司', short: '测试公司', industryCode: 'construction', tags: [], size: '51-200人',
    state: '雪兰莪', city: '莎阿南', color: '#426EFF', intro: '', benefits: [], ssm: '', founded: 2020,
    ...p,
  }
}
