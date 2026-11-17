import { useNavigation, usePreventRemove, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { BadgeCheck, FileText, Phone } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, ErrorState, ListRow, ListSkeleton, Screen, Sheet, TopBar, useToast } from '@/components/ui'
import { webUrl } from '@/features/auth/actions'
import { useMe } from '@/features/auth/use-me'
import { useCompleteness, useProfile, useSaveProfileSection, useSchools } from '@/features/profile/api'
import {
  BasicFields,
  PreferencesFields,
  SkillsFields,
  basicStateFrom,
  preferencesStateFrom,
  skillsStateFrom,
  useParseBasic,
  useParsePreferences,
  useParseSkills,
  type BasicState,
  type FieldErrors,
  type PreferencesState,
  type SkillsState,
} from '@/features/profile/forms'
import { useErrorMessage } from '@/i18n/error-message'
import { useOnline } from '@/lib/online'
import { useTheme } from '@/theme/use-theme'

const TOTAL = 4

/**
 * S05 建档引导：基本信息 → 求职意向 → 语言与技能 → 简历与联系方式。
 * 每步"下一步"即保存（服务端整节替换并推进 onboardingStep），所以中途退出不丢已保存的步骤；
 * 求职意向和语言技能可以跳过。教育/经历一节 App 首版不做编辑，引导到档案页后补（Web 同样允许稍后补充）。
 */
export default function Onboarding() {
  const profile = useProfile()
  const schools = useSchools()
  const errorMessage = useErrorMessage()
  const t = useTranslations('onboarding')

  if (profile.isPending || schools.isPending) {
    return (
      <Screen>
        <TopBar title={t('title')} />
        <ListSkeleton rows={3} />
      </Screen>
    )
  }
  if (profile.isError || schools.isError) {
    return (
      <Screen>
        <TopBar title={t('title')} />
        <ErrorState message={errorMessage(profile.error ?? schools.error)} onRetry={() => void Promise.all([profile.refetch(), schools.refetch()])} />
      </Screen>
    )
  }
  return <Stepper profile={profile.data} schools={schools.data.items} />
}

function Stepper({ profile, schools }: { profile: NonNullable<ReturnType<typeof useProfile>['data']>; schools: NonNullable<ReturnType<typeof useSchools>['data']>['items'] }) {
  const router = useRouter()
  const navigation = useNavigation()
  const toast = useToast()
  const online = useOnline()
  const { me } = useMe()
  const t = useTranslations('onboarding')
  const m = useTranslations('mobile.onboarding')
  const common = useTranslations('mobile.common')
  const errorMessage = useErrorMessage()
  const { colors, radius } = useTheme()

  const [step, setStepRaw] = useState(() => Math.min(Math.max(profile.onboardingStep, 1), TOTAL))
  const [basic, setBasic] = useState<BasicState>(() => basicStateFrom(profile, me?.name ?? ''))
  const [prefs, setPrefs] = useState<PreferencesState>(() => preferencesStateFrom(profile))
  const [skills, setSkills] = useState<SkillsState>(() => skillsStateFrom(profile))
  const [errors, setErrors] = useState<FieldErrors>({})
  // 换步时清掉上一步的校验提示
  const setStep = (next: (s: number) => number) => {
    setErrors({})
    setStepRaw(next)
  }
  const [dirty, setDirty] = useState(false)
  const [pendingLeave, setPendingLeave] = useState<null | (() => void)>(null)

  const parseBasic = useParseBasic()
  const parsePrefs = useParsePreferences()
  const parseSkills = useParseSkills()
  const saveBasic = useSaveProfileSection('basic')
  const savePrefs = useSaveProfileSection('preferences')
  const saveSkills = useSaveProfileSection('skills')
  const busy = saveBasic.isPending || savePrefs.isPending || saveSkills.isPending

  // 预测性返回（MOBILE.md §5.6）：有未保存的修改时先确认是否放弃
  usePreventRemove(dirty, ({ data }) => setPendingLeave(() => () => navigation.dispatch(data.action)))

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v)
    setDirty(true)
  }

  async function next() {
    try {
      if (step === 1) {
        const r = parseBasic(basic)
        if (!r.ok) return setErrors(r.errors)
        await saveBasic.mutateAsync(r.value)
      } else if (step === 2) {
        const r = parsePrefs(prefs)
        if (!r.ok) return setErrors(r.errors)
        await savePrefs.mutateAsync(r.value)
      } else if (step === 3) {
        const r = parseSkills(skills)
        if (!r.ok) return setErrors(r.errors)
        await saveSkills.mutateAsync(r.value)
      }
      setDirty(false)
      setStep((s) => Math.min(s + 1, TOTAL))
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  function skip() {
    setDirty(false)
    setStep((s) => Math.min(s + 1, TOTAL))
  }

  const titles = [t('step1Title'), t('step2Title'), m('step3Title'), m('step4Title')]
  const footer =
    step < TOTAL ? (
      <View style={styles.footer}>
        {step > 1 ? <Button label={t('previous')} variant="secondary" onPress={() => setStep((s) => s - 1)} disabled={busy} /> : null}
        {step === 2 || step === 3 ? <Button testID="onboarding-skip" label={common('skip')} variant="ghost" onPress={skip} disabled={busy} /> : null}
        <View style={styles.flex}>
          <Button testID="onboarding-next" label={t('next')} onPress={next} loading={busy} disabled={!online} fullWidth />
        </View>
      </View>
    ) : (
      <Button testID="onboarding-finish" label={t('finish')} onPress={() => router.replace('/home')} fullWidth />
    )

  return (
    <Screen footer={footer}>
      <TopBar title={t('title')} />
      <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: TOTAL, now: step }} accessibilityLabel={t('stepProgress', { current: step, total: TOTAL })} style={styles.progressWrap}>
        <Text style={{ color: colors.mutedForeground }}>{t('stepProgress', { current: step, total: TOTAL })}</Text>
        <View style={[styles.track, { backgroundColor: colors.muted, borderRadius: radius.pill }]}>
          <View style={[styles.fill, { width: `${(step / TOTAL) * 100}%`, backgroundColor: colors.brand, borderRadius: radius.pill }]} />
        </View>
      </View>
      <Text accessibilityRole="header" style={[styles.stepTitle, { color: colors.foreground }]} testID={`onboarding-step-${step}`}>
        {titles[step - 1]}
      </Text>

      {step === 1 ? <BasicFields value={basic} onChange={edit(setBasic)} errors={errors} schools={schools} /> : null}
      {step === 2 ? <PreferencesFields value={prefs} onChange={edit(setPrefs)} errors={errors} /> : null}
      {step === 3 ? <SkillsFields value={skills} onChange={edit(setSkills)} errors={errors} /> : null}
      {step === 4 ? <FinishStep /> : null}

      <Sheet open={pendingLeave !== null} onClose={() => setPendingLeave(null)} title={m('discardTitle')} closeLabel={common('close')}>
        <Text style={{ color: colors.foreground }}>{m('discardBody')}</Text>
        <Button
          label={m('discardConfirm')}
          variant="destructive"
          onPress={() => {
            const leave = pendingLeave
            setPendingLeave(null)
            setDirty(false)
            leave?.()
          }}
          fullWidth
        />
        <Button label={m('discardCancel')} variant="secondary" onPress={() => setPendingLeave(null)} fullWidth />
      </Sheet>
    </Screen>
  )
}

/** 最后一步：投递前的材料（简历、联系方式）和学校认证，三项都可以以后再补 */
function FinishStep() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('onboarding')
  const m = useTranslations('mobile.onboarding')
  const done = useTranslations('mobile.common')
  const { colors } = useTheme()
  const completeness = useCompleteness()
  const c = completeness.data
  return (
    <View style={styles.finish}>
      <Text style={{ color: colors.mutedForeground, lineHeight: 22 }}>{t('applicationMaterialsHint')}</Text>
      <ListRow
        testID="onboarding-resume"
        icon={<FileText color={colors.brand} size={20} />}
        label={m('uploadResume')}
        value={c?.hasResume ? done('done') : undefined}
        onPress={() => router.push('/resumes')}
      />
      <ListRow
        icon={<Phone color={colors.brand} size={20} />}
        label={m('fillContact')}
        value={c?.hasContact ? done('done') : undefined}
        accessibilityHint={m('opensWeb')}
        onPress={() => void WebBrowser.openBrowserAsync(webUrl(`/${locale}/s/contact`))}
      />
      <ListRow
        testID="onboarding-school"
        icon={<BadgeCheck color={colors.brand} size={20} />}
        label={m('verifySchool')}
        value={c?.schoolVerified ? done('done') : undefined}
        onPress={() => router.push('/school-verification')}
      />
      <Text style={{ color: colors.mutedForeground, lineHeight: 22 }}>{m('experienceLater')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  progressWrap: { gap: 8 },
  track: { height: 6, overflow: 'hidden' },
  fill: { height: 6 },
  stepTitle: { fontSize: 24, fontWeight: '700' },
  finish: { gap: 8 },
})
