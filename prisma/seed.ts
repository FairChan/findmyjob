import { PrismaClient, PartnerType, ArticleCategory } from '@prisma/client'

const db = new PrismaClient()

// System settings from PRD §5 — all defaults
const SETTINGS: Array<[string, unknown]> = [
  ['billing.enabled', false],
  ['billing.studentEnabled', false],
  ['pilot.monthlyCredits', 30],
  ['unlock.costCredits', 1],
  ['limits.profileViewsPerDay', 200],
  ['limits.companyProfileViewsPerDay', 400],
  ['limits.searchPagesPerDay', 300],
  ['limits.unlocksPerDay', 50],
  ['limits.otpSendsPerHour', 5],
  ['limits.otpSendsPerEmailPerDay', 5],
  ['limits.uploadsPerHour', 20],
  ['limits.jobReportsPerDay', 10],
  ['talentSearch.maxPage', 25],
  ['talentPool.minCompleteness', 60],
  ['team.maxMembers', 3],
  ['jobs.autoPublishAfter', 1000],
  ['jobs.salaryBands', [2000, 3000, 5000, 8000]],
  ['invitations.expireDays', 14],
  ['invitations.freeMonthlyQuota', 20],
  ['studentQuota.enabled', true],
  ['studentQuota.baseJobViews', 20],
  ['studentQuota.tierSize', 3],
  ['studentQuota.tierBonus', 10],
  ['studentQuota.unlimitedAt', 12],
  ['referral.minCompleteness', 90],
  ['referral.requireSchoolVerified', false],
  ['referral.maxQualifiedPerDay', 3],
  ['apply.minCompleteness', 60],
  ['signup.studentCap', 3000],
  ['signup.warnRatio', 0.9],
  ['signup.unverifiedTtlHours', 48],
  ['search.defaultMode', 'EXACT'],
  ['search.relatedFallbackBelow', 5],
  ['resume.maxPages', 20],
  ['legal.currentVersion', '2026-11-draft'],
  ['unlock.enabled', true],
  ['talentPool.searchEnabled', true],
  ['uploads.enabled', true],
]

// Default synonym groups — matches prototype src/data/synonyms.ts
const SYNONYM_GROUPS = [
  ['财务', '会计', '审计', '出纳', '税务', '金融', 'finance', 'accounting', 'audit'],
  ['管理', '管培生', '管理培训生', 'management', 'mt'],
  ['前端', '前端开发', 'web', 'react', 'vue', 'frontend'],
  ['后端', '后端开发', '服务端', 'java', 'backend'],
  ['数据', '数据分析', '数据科学', 'sql', 'python', 'bi', 'data'],
  ['算法', '算法工程师', '机器学习', '人工智能', '大模型', 'ai', 'llm'],
  ['电商', '跨境电商', '跨境电商运营', 'shopee', 'lazada', 'tiktok shop', 'ecommerce'],
  ['新媒体', '新媒体运营', '小红书', '直播', '内容运营', 'tiktok', 'social media'],
  ['翻译', '中马翻译', '中英翻译', '口译', '笔译', 'translator'],
  ['土木', '土木工程师', '结构', '施工', '工程管理', 'civil'],
  ['电气', '电气工程师', '电力', 'plc', 'electrical'],
  ['机械', '机械工程师', 'solidworks', 'mechanical'],
  ['物流', '供应链', '报关', '采购', '国际贸易', 'logistics', 'supply chain'],
  ['行政', '行政助理', '人力资源', '招聘', 'hr', 'admin'],
  ['教育', '助教', '中文教师', '课程顾问', 'teacher'],
  ['销售', '客户经理', '销售代表', 'sales'],
  ['产品', '产品经理', '产品助理', 'product manager', 'pm'],
]

async function main() {
  // --- Schools ---
  // Pilot school (D9: 厦门大学马来西亚分校, email domain pending confirmation)
  await db.school.upsert({
    where: { id: 'school-xmum' },
    create: {
      id: 'school-xmum',
      nameZh: '厦门大学马来西亚分校',
      nameEn: 'Xiamen University Malaysia',
      shortName: 'XMUM',
      country: 'MY',
      state: 'Sepang',
      emailDomains: ['xmu.edu.my'],
      isPartner: true,
      active: true,
    },
    update: {
      nameZh: '厦门大学马来西亚分校',
      nameEn: 'Xiamen University Malaysia',
      shortName: 'XMUM',
      emailDomains: ['xmu.edu.my'],
      isPartner: true,
    },
  })

  // Example schools
  await db.school.upsert({
    where: { id: 'school-um' },
    create: {
      id: 'school-um',
      nameZh: '马来亚大学',
      nameEn: 'Universiti Malaya',
      shortName: 'UM',
      country: 'MY',
      state: 'WP Kuala Lumpur',
      emailDomains: ['siswa.um.edu.my'],
      isPartner: false,
      active: true,
    },
    update: { nameZh: '马来亚大学', nameEn: 'Universiti Malaya' },
  })

  await db.school.upsert({
    where: { id: 'school-upm' },
    create: {
      id: 'school-upm',
      nameZh: '博特拉大学',
      nameEn: 'Universiti Putra Malaysia',
      shortName: 'UPM',
      country: 'MY',
      state: 'Selangor',
      emailDomains: ['student.upm.edu.my'],
      isPartner: false,
      active: true,
    },
    update: { nameZh: '博特拉大学', nameEn: 'Universiti Putra Malaysia' },
  })

  await db.school.upsert({
    where: { id: 'school-utm' },
    create: {
      id: 'school-utm',
      nameZh: '马来西亚理工大学',
      nameEn: 'Universiti Teknologi Malaysia',
      shortName: 'UTM',
      country: 'MY',
      state: 'Johor',
      emailDomains: ['graduate.utm.my'],
      isPartner: false,
      active: true,
    },
    update: { nameZh: '马来西亚理工大学', nameEn: 'Universiti Teknologi Malaysia' },
  })

  // --- Partners (2 examples) ---
  await db.partner.upsert({
    where: { id: 'partner-example-01' },
    create: {
      id: 'partner-example-01',
      name: '示例华人商会',
      nameEn: 'Example Chinese Chamber of Commerce',
      type: PartnerType.ENTERPRISE,
      website: 'https://example.com',
      showOnHome: true,
      sortOrder: 1,
    },
    update: { name: '示例华人商会', nameEn: 'Example Chinese Chamber of Commerce' },
  })

  await db.partner.upsert({
    where: { id: 'partner-example-02' },
    create: {
      id: 'partner-example-02',
      name: '示例留学生联合会',
      nameEn: 'Example International Students Association',
      type: PartnerType.ALUMNI_ASSOCIATION,
      website: 'https://example.org',
      showOnHome: true,
      sortOrder: 2,
    },
    update: { name: '示例留学生联合会', nameEn: 'Example International Students Association' },
  })

  // --- System settings ---
  for (const [key, value] of SETTINGS) {
    await db.systemSetting.upsert({
      where: { key },
      create: { key, value: value as Parameters<typeof db.systemSetting.create>[0]['data']['value'] },
      update: {},
    })
  }

  // --- Synonym groups ---
  for (let i = 0; i < SYNONYM_GROUPS.length; i++) {
    const id = `sg-${String(i + 1).padStart(2, '0')}`
    await db.searchSynonymGroup.upsert({
      where: { id },
      create: { id, terms: SYNONYM_GROUPS[i], active: true },
      update: { terms: SYNONYM_GROUPS[i] },
    })
  }

  // --- Anti-fraud content ---
  await db.article.upsert({
    where: { id: 'article-contact-police' },
    create: {
      id: 'article-contact-police',
      category: ArticleCategory.CONTACT,
      title: '紧急求助与投诉渠道',
      body: [
        '## 马来西亚紧急报警电话',
        '',
        '- **警察 / 紧急事故**：999',
        '- **非紧急警察热线**：03-2266 2222',
        '',
        '## 中国驻马来西亚大使馆领事保护',
        '',
        '- **领事保护与协助热线**：待运营核实',
        '',
        '> 如遭遇招聘诈骗，请立即向当地警察报案，并联系使馆领事保护热线。',
      ].join('\n'),
      sortOrder: 1,
      published: true,
    },
    update: {
      title: '紧急求助与投诉渠道',
    },
  })

  await db.article.upsert({
    where: { id: 'article-fraud-case-01' },
    create: {
      id: 'article-fraud-case-01',
      category: ArticleCategory.FRAUD_CASE,
      title: '【案例占位】招聘诈骗典型案例',
      body: '此处将由运营团队填写真实反诈案例。',
      sortOrder: 1,
      published: false,
    },
    update: {},
  })

  // --- Platform admin user ---
  // Password-based Account setup requires Better Auth (M1-T01).
  // This seed creates the User record so it can be referenced in tests.
  const adminEmail = process.env.SEED_ADMIN_EMAIL
  if (adminEmail) {
    await db.user.upsert({
      where: { email: adminEmail },
      create: {
        id: 'user-seed-admin',
        name: '平台管理员',
        email: adminEmail,
        emailVerified: true,
        role: 'ADMIN',
      },
      update: { role: 'ADMIN', emailVerified: true },
    })
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
