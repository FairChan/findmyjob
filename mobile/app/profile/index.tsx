import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useFormatter, useLocale, useTranslations } from 'use-intl'

import { Button, Card, ErrorState, ListRow, ListSkeleton, OfflineBanner, Screen, TopBar } from '@/components/ui'
import { webUrl } from '@/features/auth/actions'
import { useCompleteness, useProfile, useSchools } from '@/features/profile/api'
import { useProfileLabels } from '@/features/profile/forms'
import { useErrorMessage } from '@/i18n/error-message'
import { COMMON_INDUSTRIES, localized, stateLabel } from '@/lib/reference-data'
import { useTheme } from '@/theme/use-theme'

/** S17 档案：分区卡片，每区单独编辑；完成度在保存后由服务端重算 */
export default function ProfileScreen() {
  const router = useRouter()
  const locale = useLocale()
  const format = useFormatter()
  const t = useTranslations('onboarding')
  const p = useTranslations('profile')
  const m = useTranslations('mobile.profile')
  const home = useTranslations('mobile.home')
  const errorMessage = useErrorMessage()
  const labels = useProfileLabels()
  const { colors } = useTheme()
  const profile = useProfile()
  const completeness = useCompleteness()
  const schools = useSchools()

  if (profile.isPending)
    return (
      <Screen>
        <TopBar title={m('title')} />
        <ListSkeleton rows={3} />
      </Screen>
    )
  if (profile.isError)
    return (
      <Screen>
        <TopBar title={m('title')} />
        <ErrorState message={errorMessage(profile.error)} onRetry={() => void profile.refetch()} />
      </Screen>
    )

  const d = profile.data
  const school = schools.data?.items.find((s) => s.id === d.schoolId)
  const dash = '—'
  const salary =
    d.expectedSalaryMin !== null || d.expectedSalaryMax !== null
      ? `RM ${[d.expectedSalaryMin, d.expectedSalaryMax].map((v) => (v === null ? '?' : format.number(v))).join('–')}`
      : null
  const edit = (section: string) => () => router.push(`/profile/edit?section=${section}`)

  return (
    <Screen onRefresh={() => void Promise.all([profile.refetch(), completeness.refetch()])} refreshing={profile.isRefetching}>
      <TopBar title={m('title')} />
      <OfflineBanner />
      {completeness.data ? <Text style={[styles.completeness, { color: colors.foreground }]}>{home('completeness', { percent: completeness.data.completeness })}</Text> : null}

      <Section title={t('step1Title')} onEdit={edit('basic')} editLabel={m('editSection', { section: t('step1Title') })} testID="profile-edit-basic">
        <Field label={t('fullNameLabel')} value={d.fullName || dash} />
        <Field label={t('schoolLabel')} value={school ? (locale === 'en' ? school.nameEn : school.nameZh) : dash} />
        <Field label={t('degreeLevelLabel')} value={labels.degree(d.degreeLevel) ?? dash} />
        <Field label={t('majorLabel')} value={d.major ?? dash} />
        <Field label={t('graduationYearLabel')} value={d.graduationYear ? `${d.graduationYear}${d.graduationMonth ? `-${String(d.graduationMonth).padStart(2, '0')}` : ''}` : dash} />
        <Field label={t('workAuthLabel')} value={labels.workAuth(d.workAuth) ?? dash} />
      </Section>

      <Section title={t('step2Title')} onEdit={edit('preferences')} editLabel={m('editSection', { section: t('step2Title') })}>
        <Field label={t('intentsLabel')} value={d.intents.map(labels.intent).join('、') || dash} />
        <Field label={t('preferredStatesLabel')} value={d.preferredStates.map((s) => stateLabel(s, locale)).join('、') || dash} />
        <Field
          label={t('preferredIndustriesLabel')}
          value={d.preferredIndustries.map((c) => { const i = COMMON_INDUSTRIES.find((x) => x.code === c); return i ? localized(i, locale) : c }).join('、') || dash}
        />
        <Field label={t('expectedSalaryLabel')} value={salary ?? dash} />
      </Section>

      <Section title={m('skillsSection')} onEdit={edit('skills')} editLabel={m('editSection', { section: m('skillsSection') })}>
        <Field label={t('languagesLabel')} value={d.languages.map((l) => `${l.language}（${labels.langLevel(l.level)}）`).join('、') || dash} />
        <Field label={m('skills')} value={d.skills.join('、') || dash} />
        <Field label={m('headline')} value={d.headline ?? dash} />
        {d.summary ? <Text style={{ color: colors.foreground, lineHeight: 22 }}>{d.summary}</Text> : null}
      </Section>

      <Section title={p('sectionExperience')}>
        {d.educations.length === 0 && d.experiences.length === 0 ? <Text style={{ color: colors.mutedForeground }}>{m('noExperience')}</Text> : null}
        {d.educations.map((e) => (
          <Field key={e.id} label={t('educationsLabel')} value={[e.schoolName, e.major].filter(Boolean).join(' · ')} />
        ))}
        {d.experiences.map((e) => (
          <Field key={e.id} label={e.organization ?? t('experiencesLabel')} value={e.title} />
        ))}
        <Button label={m('editExperienceOnWeb')} variant="ghost" accessibilityHint={m('opensWeb')} onPress={() => void WebBrowser.openBrowserAsync(webUrl(`/${locale}/s/profile`))} />
      </Section>

      <Card>
        <ListRow label={m('resumes')} onPress={() => router.push('/resumes')} />
        <ListRow label={m('schoolVerification')} value={completeness.data?.schoolVerified ? m('verified') : undefined} onPress={() => router.push('/school-verification')} />
        <ListRow testID="profile-contact" label={m('contact')} value={completeness.data?.hasContact ? m('filled') : undefined} onPress={() => router.push('/contact')} />
      </Card>
    </Screen>
  )
}

function Section({ title, children, onEdit, editLabel, testID }: { title: string; children: ReactNode; onEdit?: () => void; editLabel?: string; testID?: string }) {
  const { colors } = useTheme()
  const common = useTranslations('mobile.common')
  return (
    <Card>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.foreground }]}>
          {title}
        </Text>
        {onEdit ? <Button testID={testID} label={common('edit')} variant="ghost" accessibilityLabel={editLabel} onPress={onEdit} /> : null}
      </View>
      {children}
    </Card>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme()
  return (
    <View style={styles.field} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  completeness: { fontSize: 17, fontWeight: '600' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 18, fontWeight: '600', flex: 1 },
  field: { gap: 2, paddingVertical: 2 },
  fieldLabel: { fontSize: 13 },
  fieldValue: { fontSize: 16, lineHeight: 22 },
})
