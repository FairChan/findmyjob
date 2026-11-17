import type { MobileJobOpen } from '@shared/mobile-api'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { Check, ShieldAlert } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, Card, EmptyState, OfflineBanner, Screen, SectionTitle, TextField, TopBar, useToast } from '@/components/ui'
import { useApply } from '@/features/applications/api'
import { webUrl } from '@/features/auth/actions'
import { useOpenedJob } from '@/features/jobs/api'
import { companyName } from '@/features/jobs/components'
import { useErrorMessage } from '@/i18n/error-message'
import { useOnline } from '@/lib/online'
import { useTheme } from '@/theme/use-theme'

/**
 * S11 投递确认：简历和投递阻碍都来自用户刚才点开详情时的 open 结果（jobOpen 缓存），
 * 这里绝不为了拿数据再调 open——没有缓存（比如被系统回收后重进）就让用户回职位页再点一次。
 */
export default function ApplyScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>()
  const router = useRouter()
  const opened = useOpenedJob(jobId)
  const t = useTranslations('mobile.apply')
  const data = opened.data

  if (!data?.detail) {
    return (
      <Screen>
        <TopBar title={t('title')} />
        <EmptyState
          title={t('needDetailTitle')}
          body={t('needDetailBody')}
          action={<Button label={t('backToJob')} variant="secondary" onPress={() => router.replace(`/jobs/${jobId}`)} />}
        />
      </Screen>
    )
  }
  return <ApplyForm data={data} />
}

function ApplyForm({ data }: { data: MobileJobOpen }) {
  const router = useRouter()
  const toast = useToast()
  const online = useOnline()
  const locale = useLocale()
  const t = useTranslations('mobile.apply')
  const common = useTranslations('mobile.common')
  const pub = useTranslations('publicJobs')
  const errorMessage = useErrorMessage()
  const { colors, radius, minTouchTarget } = useTheme()
  const apply = useApply(data.job.id)
  const primary = data.resumes.find((r) => r.isPrimary) ?? data.resumes[0]
  const [resumeId, setResumeId] = useState<string | null>(primary?.id ?? null)
  const [coverNote, setCoverNote] = useState('')

  if (data.application) {
    return (
      <Screen>
        <TopBar title={t('title')} />
        <EmptyState
          title={pub('appliedBadge')}
          action={<Button label={t('viewApplication')} onPress={() => router.replace(`/applications/${data.application!.id}`)} />}
        />
      </Screen>
    )
  }

  const blocker = data.applyBlocker
  const blocked = blocker !== null || !resumeId

  async function submit() {
    try {
      const { applicationId } = await apply.mutateAsync({ resumeId, coverNote: coverNote.trim() || null })
      toast(t('success'))
      // justApplied=1：详情页据此在第一次投递后提示开启通知（MA3-T03）
      router.replace(`/applications/${applicationId}?justApplied=1`)
    } catch {
      // 错误码（完成度不足、缺联系方式、重复投递等）已映射成文案，显示在按钮上方
    }
  }

  const footer = (
    <>
      {apply.isError ? (
        <Text testID="apply-error" accessibilityRole="alert" style={{ color: colors.destructive }}>
          {errorMessage(apply.error)}
        </Text>
      ) : null}
      {!online ? <Text style={{ color: colors.mutedForeground }}>{common('offlineAction')}</Text> : null}
      <Button testID="apply-submit" label={t('submit')} onPress={submit} loading={apply.isPending} disabled={blocked || !online} fullWidth />
    </>
  )

  return (
    <Screen footer={footer}>
      <TopBar title={t('title')} />
      <OfflineBanner />
      <View>
        <Text style={[styles.jobTitle, { color: colors.foreground }]}>{data.job.title}</Text>
        <Text style={{ color: colors.mutedForeground }}>{companyName(data.job.company, locale)}</Text>
      </View>

      {blocker ? <Blockers blocker={blocker} /> : null}

      {data.resumes.length > 0 ? (
        <>
          <SectionTitle>{t('chooseResume')}</SectionTitle>
          <View accessibilityRole="radiogroup" style={styles.resumes}>
            {data.resumes.map((r) => {
              const selected = r.id === resumeId
              return (
                <Pressable
                  key={r.id}
                  testID={`apply-resume-${r.id}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={r.isPrimary ? `${r.fileName}（${t('primaryResume')}）` : r.fileName}
                  onPress={() => setResumeId(r.id)}
                  style={[styles.resume, { minHeight: minTouchTarget, borderRadius: radius.button, borderColor: selected ? colors.brand : colors.border }]}
                >
                  <Text style={[styles.flex, { color: colors.foreground }]} numberOfLines={1}>
                    {r.fileName}
                    {r.isPrimary ? ` · ${t('primaryResume')}` : ''}
                  </Text>
                  {selected ? <Check color={colors.brand} size={20} /> : null}
                </Pressable>
              )
            })}
          </View>
        </>
      ) : null}

      <TextField
        testID="apply-cover-note"
        label={pub('applyDialogCoverNote')}
        placeholder={pub('applyDialogCoverNotePlaceholder')}
        value={coverNote}
        onChangeText={setCoverNote}
        maxLength={500}
        multiline
        textAlignVertical="top"
        style={styles.multiline}
      />

      <Card style={{ backgroundColor: colors.muted, borderColor: colors.muted }}>
        <View style={styles.row}>
          <ShieldAlert color={colors.destructive} size={20} />
          <Text testID="apply-safety" style={[styles.flex, { color: colors.foreground, lineHeight: 21 }]}>
            {t('safety')}
          </Text>
        </View>
        <Button label={t('safetyMore')} variant="ghost" onPress={() => router.push('/help')} />
      </Card>
    </Screen>
  )
}

/** 投递阻碍：列出缺什么，每项给跳转（联系方式目前只能在网页版填，见 MA2 报告） */
function Blockers({ blocker }: { blocker: NonNullable<MobileJobOpen['applyBlocker']> }) {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('mobile.apply')
  const pub = useTranslations('publicJobs')
  const { colors } = useTheme()
  const text = {
    contactAndResume: pub('applyBlockedContactAndResume'),
    contact: pub('applyBlockedContact'),
    resume: pub('applyBlockedResume'),
    profile: pub('applyBlockedProfile'),
  }[blocker]
  const needContact = blocker === 'contact' || blocker === 'contactAndResume'
  const needResume = blocker === 'resume' || blocker === 'contactAndResume'
  return (
    <Card style={{ borderColor: colors.destructive }}>
      <Text accessibilityRole="header" style={[styles.blockTitle, { color: colors.foreground }]}>
        {t('readinessMissing')}
      </Text>
      <Text testID="apply-blocker" style={{ color: colors.foreground, lineHeight: 21 }}>
        {text}
      </Text>
      {needResume ? <Button testID="apply-fix-resume" label={t('fixResume')} variant="secondary" onPress={() => router.push('/resumes')} /> : null}
      {needContact ? (
        <Button
          testID="apply-fix-contact"
          label={t('fixContact')}
          variant="secondary"
          accessibilityHint={t('opensWeb')}
          onPress={() => void WebBrowser.openBrowserAsync(webUrl(`/${locale}/s/contact`))}
        />
      ) : null}
      {blocker === 'profile' ? <Button testID="apply-fix-profile" label={t('fixProfile')} variant="secondary" onPress={() => router.push('/onboarding')} /> : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  jobTitle: { fontSize: 20, fontWeight: '600' },
  resumes: { gap: 8 },
  resume: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 2, paddingHorizontal: 14 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  multiline: { minHeight: 100, paddingTop: 12 },
  blockTitle: { fontSize: 17, fontWeight: '600' },
})
