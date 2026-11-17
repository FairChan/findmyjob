import * as WebBrowser from 'expo-web-browser'
import { FileText, Upload } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'
import { useFormatter, useLocale, useTranslations } from 'use-intl'

import { Button, Card, Chip, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen, TopBar, useToast } from '@/components/ui'
import { webUrl } from '@/features/auth/actions'
import { pickPdf, uploadErrorKey, useResumes, useUploadResume } from '@/features/resume/api'
import { useErrorMessage } from '@/i18n/error-message'
import { ApiError } from '@/lib/api-client'
import { useOnline } from '@/lib/online'
import { useTheme } from '@/theme/use-theme'

/**
 * S18 简历：列表 + 上传 PDF（系统文件选择器，不申请存储权限）。
 * 设为主简历、删除和解析草稿确认暂时没有 App 端点，引导到网页版简历页（见 MA2 报告）。
 */
export default function Resumes() {
  const t = useTranslations('resume')
  const m = useTranslations('mobile.resume')
  const common = useTranslations('mobile.common')
  const toast = useToast()
  const online = useOnline()
  const locale = useLocale()
  const format = useFormatter()
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()
  const resumes = useResumes()
  const upload = useUploadResume()

  async function pickAndUpload() {
    const file = await pickPdf().catch(() => null)
    if (!file) return
    try {
      await upload.mutateAsync(file)
      toast(m('uploaded'))
    } catch (err) {
      const key = uploadErrorKey(err)
      toast(key ? t(key as 'errorUploadFailed') : errorMessage(err), 'error')
    }
  }

  // 列表端点未上线（404）时不当成错误：照样可以上传，管理去网页版
  const listMissing = resumes.error instanceof ApiError && resumes.error.code === 'NOT_FOUND'

  let body
  if (resumes.isPending) body = <ListSkeleton rows={2} />
  else if (listMissing) body = <Text style={[styles.note, { color: colors.mutedForeground }]}>{m('listUnavailable')}</Text>
  else if (resumes.isError) body = <ErrorState message={errorMessage(resumes.error)} onRetry={() => void resumes.refetch()} />
  else if (!resumes.data?.items.length) body = <EmptyState title={t('empty')} body={t('privacy')} />
  else
    body = (
      <View style={styles.list}>
        {resumes.data.items.map((r) => (
          <Card key={r.id}>
            <View style={styles.row} accessible accessibilityLabel={[r.fileName, r.isPrimary ? t('primary') : null].filter(Boolean).join('，')}>
              <FileText color={colors.brand} size={22} />
              <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={2}>
                {r.fileName}
              </Text>
              {r.isPrimary ? <Chip label={t('primary')} /> : null}
            </View>
            <Text style={{ color: colors.mutedForeground }}>
              {[t('uploadedAt', { date: format.dateTime(new Date(r.createdAt), { dateStyle: 'medium' }) }), r.pageCount ? t('pages', { count: r.pageCount }) : null].filter(Boolean).join(' · ')}
            </Text>
          </Card>
        ))}
      </View>
    )

  const footer = (
    <>
      {upload.isPending ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.mutedForeground, textAlign: 'center' }}>
          {t('uploading')}
        </Text>
      ) : null}
      {!online ? <Text style={{ color: colors.mutedForeground }}>{common('offlineAction')}</Text> : null}
      <Button testID="resume-upload" label={t('uploadButton')} icon={<Upload color={colors.brandForeground} size={18} />} onPress={pickAndUpload} loading={upload.isPending} disabled={!online} fullWidth />
    </>
  )

  return (
    <Screen footer={footer} onRefresh={() => void resumes.refetch()} refreshing={resumes.isRefetching}>
      <TopBar title={t('title')} />
      <OfflineBanner />
      <Text style={[styles.note, { color: colors.mutedForeground }]}>{t('uploadHint')}</Text>
      {body}
      <Button label={m('manageOnWeb')} variant="ghost" accessibilityHint={m('opensWeb')} onPress={() => void WebBrowser.openBrowserAsync(webUrl(`/${locale}/s/resume`))} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  note: { fontSize: 15, lineHeight: 22 },
  list: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '500' },
})
