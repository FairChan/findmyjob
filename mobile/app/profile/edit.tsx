import type { MobileProfile } from '@shared/mobile-api'
import { useLocalSearchParams, useNavigation, usePreventRemove, useRouter } from 'expo-router'
import { useState } from 'react'
import { Text } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, ErrorState, ListSkeleton, OfflineBanner, Screen, Sheet, TopBar, useToast } from '@/components/ui'
import { useProfile, useSaveProfileSection, useSchools, type ProfileSection } from '@/features/profile/api'
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
  type FieldErrors,
} from '@/features/profile/forms'
import { useErrorMessage } from '@/i18n/error-message'
import { useOnline } from '@/lib/online'
import { useTheme } from '@/theme/use-theme'

/** S17 单区编辑：基本信息 / 求职意向 / 语言与技能；保存即整节替换（与 Web 档案页同一组 service） */
export default function EditProfileSection() {
  const { section: raw } = useLocalSearchParams<{ section?: string }>()
  const section: ProfileSection = raw === 'preferences' || raw === 'skills' ? raw : 'basic'
  const profile = useProfile()
  const schools = useSchools()
  const errorMessage = useErrorMessage()
  const m = useTranslations('mobile.profile')

  if (profile.isPending || (section === 'basic' && schools.isPending))
    return (
      <Screen>
        <TopBar title={m('title')} />
        <ListSkeleton rows={3} />
      </Screen>
    )
  if (profile.isError || (section === 'basic' && schools.isError))
    return (
      <Screen>
        <TopBar title={m('title')} />
        <ErrorState message={errorMessage(profile.error ?? schools.error)} onRetry={() => void Promise.all([profile.refetch(), schools.refetch()])} />
      </Screen>
    )
  return <Editor section={section} profile={profile.data} schools={schools.data?.items ?? []} />
}

function Editor({ section, profile, schools }: { section: ProfileSection; profile: MobileProfile; schools: { id: string; nameZh: string; nameEn: string; emailDomains: string[] }[] }) {
  const router = useRouter()
  const navigation = useNavigation()
  const toast = useToast()
  const online = useOnline()
  const t = useTranslations('onboarding')
  const p = useTranslations('profile')
  const m = useTranslations('mobile.profile')
  const ob = useTranslations('mobile.onboarding')
  const common = useTranslations('mobile.common')
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()
  const save = useSaveProfileSection(section)
  const parseBasic = useParseBasic()
  const parsePrefs = useParsePreferences()
  const parseSkills = useParseSkills()

  const [basic, setBasic] = useState(() => basicStateFrom(profile))
  const [prefs, setPrefs] = useState(() => preferencesStateFrom(profile))
  const [skills, setSkills] = useState(() => skillsStateFrom(profile))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [dirty, setDirty] = useState(false)
  const [pendingLeave, setPendingLeave] = useState<null | (() => void)>(null)
  usePreventRemove(dirty, ({ data }) => setPendingLeave(() => () => navigation.dispatch(data.action)))

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v)
    setDirty(true)
  }

  async function submit() {
    const r = section === 'basic' ? parseBasic(basic) : section === 'preferences' ? parsePrefs(prefs) : parseSkills(skills)
    if (!r.ok) return setErrors(r.errors)
    setErrors({})
    try {
      await save.mutateAsync(r.value as never)
      setDirty(false)
      toast(p('saveSuccess'))
      // 等 dirty=false 生效后再返回，免得被未保存拦截
      setTimeout(() => router.back(), 0)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const title = { basic: t('step1Title'), preferences: t('step2Title'), skills: m('skillsSection') }[section]
  return (
    <Screen footer={<Button testID="profile-save" label={common('save')} onPress={submit} loading={save.isPending} disabled={!online} fullWidth />}>
      <TopBar title={title} />
      <OfflineBanner />
      {section === 'basic' ? <BasicFields value={basic} onChange={edit(setBasic)} errors={errors} schools={schools} /> : null}
      {section === 'basic' && profile.schoolId && basic.schoolId !== profile.schoolId ? (
        <Text style={{ color: colors.destructive, lineHeight: 21 }}>{m('schoolChangeWarning')}</Text>
      ) : null}
      {section === 'preferences' ? <PreferencesFields value={prefs} onChange={edit(setPrefs)} errors={errors} /> : null}
      {section === 'skills' ? <SkillsFields value={skills} onChange={edit(setSkills)} errors={errors} /> : null}
      <Sheet open={pendingLeave !== null} onClose={() => setPendingLeave(null)} title={ob('discardTitle')} closeLabel={common('close')}>
        <Text style={{ color: colors.foreground }}>{ob('discardBody')}</Text>
        <Button
          label={ob('discardConfirm')}
          variant="destructive"
          fullWidth
          onPress={() => {
            const leave = pendingLeave
            setPendingLeave(null)
            setDirty(false)
            leave?.()
          }}
        />
        <Button label={ob('discardCancel')} variant="secondary" fullWidth onPress={() => setPendingLeave(null)} />
      </Sheet>
    </Screen>
  )
}
