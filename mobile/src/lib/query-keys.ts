// 查询 key 集中放：写操作成功后按 key 失效，避免各页面各写一套字符串。
// 注意：jobOpen 不是查询，只是"用户点了查看详情之后"的结果缓存，永远没有 queryFn（见 features/jobs/api.ts）。
export const qk = {
  me: ['me'] as const,
  profile: ['profile'] as const,
  completeness: ['profile', 'completeness'] as const,
  schools: ['schools'] as const,
  jobs: (filters: object) => ['jobs', filters] as const,
  jobsAll: ['jobs'] as const,
  jobPreview: (id: string) => ['jobs', 'preview', id] as const,
  jobOpen: (id: string) => ['jobOpen', id] as const,
  applications: ['applications'] as const,
  timeline: (id: string) => ['applications', id, 'timeline'] as const,
  invitations: ['invitations'] as const,
  companies: (tag: string | null) => ['companies', tag] as const,
  company: (id: string) => ['company', id] as const,
  notifications: ['notifications'] as const,
  referrals: ['referrals'] as const,
  resumes: ['resumes'] as const,
  privacy: ['privacy'] as const,
  blockSearch: (q: string) => ['privacy', 'companies', q] as const,
}
