/**
 * 防泄漏测试 (ARCHITECTURE §5.2) — DO NOT DELETE OR WEAKEN.
 * Asserts that toTalentCard / toTalentDetail never expose PII when unlocked=false,
 * and that contact info is only included when explicitly unlocked.
 */
import { describe, it, expect } from 'vitest'
import { toTalentCard, toTalentDetail } from '@/server/serializers/talent-card'
import type { ProfileDetailInput, ContactInput } from '@/server/serializers/talent-card'
import { buildEmployerStudentPayload } from '@/server/services/notifications'

// --- Sentinel PII values (must NOT appear in locked output) ---
const S_NAME = '王明明'
const S_PHONE = '+60 12-000 0420'
const S_EMAIL = 'leak-sentinel@example.test'
const S_WHATSAPP = '+60 11-9876 5432'
const S_WECHAT = 'wx_leak_test_account'
const S_LINKEDIN = 'https://linkedin.com/in/leak-test'
const S_STORAGE_KEY = 'resumes/leak-student/sentinel.pdf'

const piiProfile: ProfileDetailInput = {
  id: 'stu-leak-01',
  fullName: S_NAME,
  headline: `联系我：${S_PHONE}`,
  summary: `微信 ${S_WECHAT} 或邮件 ${S_EMAIL}`,
  skills: [`微信 ${S_WECHAT}`, 'TypeScript'],
  major: '计算机科学',
  degreeLevel: 'BACHELOR',
  graduationYear: 2025,
  cgpa: null,
  workAuth: 'STUDENT_PASS',
  completeness: 80,
  visibility: 'PUBLIC',
  school: { id: 's1', nameZh: '马来亚大学', nameEn: 'University of Malaya' },
  educations: [
    {
      id: 'edu-1',
      schoolName: '马来亚大学',
      major: '计算机科学',
      degreeLevel: 'BACHELOR',
      startDate: null,
      endDate: null,
      description: `请联系 ${S_EMAIL}`,
      sortOrder: 0,
    },
  ],
  experiences: [
    {
      id: 'exp-1',
      kind: 'INTERNSHIP',
      title: `实习 ${S_PHONE}`,
      organization: `某公司 wx ${S_WECHAT}`,
      startDate: null,
      endDate: null,
      description: null,
      sortOrder: 0,
    },
  ],
  resumes: [
    {
      id: 'res-1',
      storageKey: S_STORAGE_KEY,
      isPrimary: true,
      parsedJson: null,
    },
  ],
}

const contact: ContactInput = {
  phone: S_PHONE,
  email: S_EMAIL,
  whatsapp: S_WHATSAPP,
  wechat: S_WECHAT,
  linkedinUrl: S_LINKEDIN,
}

// ---- toTalentCard locked ------------------------------------------------

describe('toTalentCard – 防泄漏 (unlocked=false)', () => {
  const result = toTalentCard(piiProfile, { unlocked: false })
  const json = JSON.stringify(result)

  it('JSON 里不含全名', () => expect(json).not.toContain(S_NAME))
  it('JSON 里不含哨兵电话', () => expect(json).not.toContain(S_PHONE))
  it('JSON 里不含哨兵邮箱', () => expect(json).not.toContain(S_EMAIL))
  it('JSON 里不含微信号', () => expect(json).not.toContain(S_WECHAT))
  it('JSON 里不含 storageKey', () => expect(json).not.toContain(S_STORAGE_KEY))

  it('name 是脱敏后的姓名', () => {
    expect(result.name).not.toBe(S_NAME)
    expect(result.name).toContain('同学')
  })

  it('headline 经过 redact', () => {
    expect(result.headline).not.toContain(S_PHONE)
    expect(result.headline).toContain('[已隐藏]')
  })

  it('skills 经过 redact', () => {
    const skill = result.skills[0]!
    expect(skill).not.toContain(S_WECHAT)
    expect(skill).toContain('[已隐藏]')
  })
})

// ---- toTalentDetail locked ----------------------------------------------

describe('toTalentDetail – 防泄漏 (unlocked=false)', () => {
  const result = toTalentDetail(piiProfile, { unlocked: false, contact })
  const json = JSON.stringify(result)

  it('JSON 里不含全名', () => expect(json).not.toContain(S_NAME))
  it('JSON 里不含电话', () => expect(json).not.toContain(S_PHONE))
  it('JSON 里不含邮箱', () => expect(json).not.toContain(S_EMAIL))
  it('JSON 里不含 WhatsApp', () => expect(json).not.toContain(S_WHATSAPP))
  it('JSON 里不含微信', () => expect(json).not.toContain(S_WECHAT))
  it('JSON 里不含 LinkedIn', () => expect(json).not.toContain(S_LINKEDIN))
  it('JSON 里不含 storageKey', () => expect(json).not.toContain(S_STORAGE_KEY))

  it('contact 为 null（即使传了 contact 参数）', () => expect(result.contact).toBeNull())

  it('educations description 经过 redact', () => {
    expect(result.educations[0]?.description).not.toContain(S_EMAIL)
  })

  it('experiences title 经过 redact', () => {
    expect(result.experiences[0]?.title).not.toContain(S_PHONE)
  })

  it('experiences organization 经过 redact', () => {
    expect(result.experiences[0]?.organization).not.toContain(S_WECHAT)
  })

  it('resumePreview 为 null', () => expect(result.resumePreview).toBeNull())
})

// ---- toTalentDetail unlocked --------------------------------------------

describe('toTalentDetail – 已解锁 (unlocked=true)', () => {
  const result = toTalentDetail(piiProfile, { unlocked: true, contact })

  it('返回全名', () => expect(result.name).toBe(S_NAME))
  it('返回电话', () => expect(result.contact?.phone).toBe(S_PHONE))
  it('返回邮箱', () => expect(result.contact?.email).toBe(S_EMAIL))
  it('返回微信', () => expect(result.contact?.wechat).toBe(S_WECHAT))
  it('返回 LinkedIn', () => expect(result.contact?.linkedinUrl).toBe(S_LINKEDIN))

  it('storageKey 不出现在 JSON（永远不暴露）', () => {
    expect(JSON.stringify(result)).not.toContain(S_STORAGE_KEY)
  })
})

// ---- TM-002: school name and major always redacted ----------------------

describe('TM-002 – school name and major always go through redact()', () => {
  it('school.nameZh 经过 redact（即使 unlocked=true）', () => {
    const p = { ...piiProfile, school: { id: 's1', nameZh: '大学 test@bad.com', nameEn: 'U' } }
    const r = toTalentCard(p, { unlocked: true })
    expect(r.school?.nameZh).not.toContain('test@bad.com')
    expect(r.school?.nameZh).toContain('[已隐藏]')
  })

  it('major 经过 redact（即使 unlocked=true）', () => {
    const p = { ...piiProfile, major: '专业 wx test123' }
    const r = toTalentCard(p, { unlocked: true })
    expect(r.major).not.toContain('wx test123')
    expect(r.major).toContain('[已隐藏]')
  })

  it('education.schoolName 经过 redact（即使 unlocked=true）', () => {
    const p: ProfileDetailInput = {
      ...piiProfile,
      educations: [
        { ...piiProfile.educations[0]!, schoolName: '马来亚大学 test@bad.com' },
      ],
    }
    const r = toTalentDetail(p, { unlocked: true, contact })
    expect(r.educations[0]?.schoolName).not.toContain('test@bad.com')
    expect(r.educations[0]?.schoolName).toContain('[已隐藏]')
  })
})

// ---- notifications.ts payload -------------------------------------------

describe('buildEmployerStudentPayload – canSeeName 控制姓名可见性', () => {
  it('canSeeName:false → 名字脱敏', () => {
    const p = buildEmployerStudentPayload(piiProfile, { canSeeName: false })
    expect(p.name).not.toBe(S_NAME)
    expect(p.name).toContain('同学')
  })

  it('canSeeName:true → 全名', () => {
    const p = buildEmployerStudentPayload(piiProfile, { canSeeName: true })
    expect(p.name).toBe(S_NAME)
  })

  it('canSeeName:true 时 headline 里的手机号仍被遮（payload 始终 unlocked=false）', () => {
    const p = buildEmployerStudentPayload(piiProfile, { canSeeName: true })
    const json = JSON.stringify(p)
    expect(json).not.toContain(S_PHONE)
    expect(p.name).toBe(S_NAME)
  })

  it('canSeeName:false 时 payload JSON 里不含手机号', () => {
    const p = buildEmployerStudentPayload(piiProfile, { canSeeName: false })
    expect(JSON.stringify(p)).not.toContain(S_PHONE)
  })
})

// ---- issue #1: 自由文本里的姓名遮蔽 ----------------------------------------

const S_GIVEN = '明明' // given name from S_NAME '王明明'

describe('toTalentCard – 未解锁时自由文本里不出现姓名', () => {
  const nameInHeadlineProfile = {
    ...piiProfile,
    headline: `我是马来亚大学的${S_NAME}`,
    skills: [`${S_NAME}的技能`, 'TypeScript'],
  }

  it('headline 里的全名被遮', () => {
    const r = toTalentCard(nameInHeadlineProfile, { unlocked: false })
    expect(r.headline).not.toContain(S_NAME)
    expect(r.headline).not.toContain(S_GIVEN)
  })

  it('skill 里的全名被遮', () => {
    const r = toTalentCard(nameInHeadlineProfile, { unlocked: false })
    expect(r.skills[0]).not.toContain(S_NAME)
    expect(r.skills[0]).not.toContain(S_GIVEN)
  })

  it('已解锁时 headline 保留原文', () => {
    const r = toTalentCard(nameInHeadlineProfile, { unlocked: true })
    expect(r.headline).toContain(S_NAME)
  })
})

describe('toTalentDetail – 未解锁时自由文本里不出现姓名 (中文)', () => {
  const p: ProfileDetailInput = {
    ...piiProfile,
    summary: `我是${S_NAME}同学，请联系我`,
    educations: [
      {
        ...piiProfile.educations[0]!,
        major: `${S_NAME}专业方向`,
        description: `指导老师是${S_GIVEN}`,
      },
    ],
    experiences: [
      {
        ...piiProfile.experiences[0]!,
        title: `${S_NAME}的实习`,
        organization: `${S_GIVEN}公司`,
        description: `描述：${S_NAME}负责前端`,
      },
    ],
  }

  it('summary 里的全名和名被遮', () => {
    const r = toTalentDetail(p, { unlocked: false })
    expect(r.summary).not.toContain(S_NAME)
    expect(r.summary).not.toContain(S_GIVEN)
  })

  it('education.major 里的名被遮', () => {
    const r = toTalentDetail(p, { unlocked: false })
    expect(r.educations[0]?.major).not.toContain(S_NAME)
  })

  it('education.description 里的名被遮', () => {
    const r = toTalentDetail(p, { unlocked: false })
    expect(r.educations[0]?.description).not.toContain(S_GIVEN)
  })

  it('experience.title 里的全名被遮', () => {
    const r = toTalentDetail(p, { unlocked: false })
    expect(r.experiences[0]?.title).not.toContain(S_NAME)
  })

  it('experience.organization 里的名被遮', () => {
    const r = toTalentDetail(p, { unlocked: false })
    expect(r.experiences[0]?.organization).not.toContain(S_GIVEN)
  })

  it('experience.description 里的全名被遮', () => {
    const r = toTalentDetail(p, { unlocked: false })
    expect(r.experiences[0]?.description).not.toContain(S_NAME)
  })
})

describe('toTalentDetail – 未解锁时自由文本里不出现姓名 (拉丁字母)', () => {
  const S_LAT = 'Tan Wei Ming'
  const latProfile: ProfileDetailInput = {
    ...piiProfile,
    fullName: S_LAT,
    headline: `Hi, I am ${S_LAT}`,
    summary: `Contact Tan Wei for details`,
    experiences: [
      {
        ...piiProfile.experiences[0]!,
        title: `Intern, ${S_LAT}`,
        description: `Wei Ming leads this project`,
      },
    ],
  }

  it('headline 里的拉丁名各段被遮（unlocked=false）', () => {
    const r = toTalentDetail(latProfile, { unlocked: false })
    expect(r.headline).not.toContain('Tan')
    expect(r.headline).not.toContain('Wei')
    expect(r.headline).not.toContain('Ming')
  })

  it('summary 里的拉丁名段被遮', () => {
    const r = toTalentDetail(latProfile, { unlocked: false })
    expect(r.summary).not.toContain('Tan')
    expect(r.summary).not.toContain('Wei')
  })

  it('experience.title 里的拉丁全名被遮', () => {
    const r = toTalentDetail(latProfile, { unlocked: false })
    expect(r.experiences[0]?.title).not.toContain('Tan')
  })

  it('experience.description 里的拉丁名段被遮', () => {
    const r = toTalentDetail(latProfile, { unlocked: false })
    expect(r.experiences[0]?.description).not.toContain('Wei')
    expect(r.experiences[0]?.description).not.toContain('Ming')
  })

  it('已解锁时 headline 保留拉丁全名', () => {
    const r = toTalentDetail(latProfile, { unlocked: true })
    expect(r.headline).toContain(S_LAT)
  })
})

// ---- issue #3: 防泄漏 – 补充路径覆盖 --------------------------------------

const S_EXP_DESC_PHONE = '+60 11-5678 9012'
const S_EDU_MAJOR_EMAIL = 'major-sentinel@example.test'
const S_SCHOOL_EN_EMAIL = 'school-en-sentinel@example.test'
const S_RESUME_PHONE = '+60 13-9988 7766'
const S_RESUME_EMAIL = 'resume-sentinel@example.test'
const S_RESUME_KEY = 'resumes/sentinel-resume/leak.pdf'
const S_WA_LINK = 'wa.me/60129000001'
const S_LI_LINK = 'https://linkedin.com/in/sentinel-li-test'

describe('防泄漏 – 补充路径覆盖 (issue #3)', () => {
  const extraProfile: ProfileDetailInput = {
    ...piiProfile,
    headline: `WhatsApp ${S_WA_LINK} LinkedIn ${S_LI_LINK}`,
    school: { id: 's1', nameZh: '马来亚大学', nameEn: `UM ${S_SCHOOL_EN_EMAIL}` },
    educations: [
      {
        ...piiProfile.educations[0]!,
        major: `CS ${S_EDU_MAJOR_EMAIL}`,
        description: `描述 ${S_EDU_MAJOR_EMAIL}`,
      },
    ],
    experiences: [
      {
        ...piiProfile.experiences[0]!,
        description: `经历 ${S_EXP_DESC_PHONE}`,
      },
    ],
    resumes: [
      {
        id: 'res-2',
        storageKey: S_RESUME_KEY,
        isPrimary: true,
        parsedJson: { phone: S_RESUME_PHONE, email: S_RESUME_EMAIL, key: S_RESUME_KEY },
      },
    ],
  }

  const result = toTalentDetail(extraProfile, { unlocked: false, contact })
  const json = JSON.stringify(result)

  it('experience.description 经过 redact（电话被遮）', () => {
    expect(result.experiences[0]?.description).not.toContain(S_EXP_DESC_PHONE)
  })

  it('education.major 经过 redact（邮箱被遮）', () => {
    expect(result.educations[0]?.major).not.toContain(S_EDU_MAJOR_EMAIL)
  })

  it('school.nameEn 经过 redact（邮箱被遮）', () => {
    expect(result.school?.nameEn).not.toContain(S_SCHOOL_EN_EMAIL)
  })

  it('resumePreview 为 null（parsedJson 里的 PII 不出现）', () => {
    expect(result.resumePreview).toBeNull()
    expect(json).not.toContain(S_RESUME_PHONE)
    expect(json).not.toContain(S_RESUME_EMAIL)
    expect(json).not.toContain(S_RESUME_KEY)
  })

  it('headline 里的 WhatsApp 链接被遮', () => {
    expect(result.headline).not.toContain(S_WA_LINK)
  })

  it('headline 里的 LinkedIn URL 被遮', () => {
    expect(result.headline).not.toContain(S_LI_LINK)
  })
})
