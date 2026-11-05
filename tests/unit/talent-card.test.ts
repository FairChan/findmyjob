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

describe('buildEmployerStudentPayload – 全名只在已解锁或已投递时出现', () => {
  it('未解锁且未投递 → 名字脱敏', () => {
    const p = buildEmployerStudentPayload(piiProfile, { isUnlocked: false, hasApplied: false })
    expect(p.name).not.toBe(S_NAME)
    expect(p.name).toContain('同学')
  })

  it('已解锁 → 全名', () => {
    const p = buildEmployerStudentPayload(piiProfile, { isUnlocked: true, hasApplied: false })
    expect(p.name).toBe(S_NAME)
  })

  it('已投递 → 全名', () => {
    const p = buildEmployerStudentPayload(piiProfile, { isUnlocked: false, hasApplied: true })
    expect(p.name).toBe(S_NAME)
  })
})
