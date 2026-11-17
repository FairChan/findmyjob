import { FileText, Upload } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useFormatter, useTranslations } from 'use-intl'

import { Button, Card, Chip, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen, Sheet, TopBar, useToast } from '@/components/ui'
import { pickPdf, uploadErrorKey, useResumeAction, useResumes, useUploadResume } from '@/features/resume/api'
import { useErrorMessage } from '@/i18n/error-message'
import { useOnline } from '@/lib/online'
import { useTheme } from '@/theme/use-theme'

/**
 * S18 简历：列表、上传 PDF（系统文件选择器，不申请存储权限）、设为主简历、删除（二次确认）。
 * 解析草稿逐项确认（/resume-drafts）还没有 App 端点，不在这一页。
 */
export default function Resumes() {
  const t = useTranslations('resume')
  const m = useTranslations('mobile.resume')
  const common = useTranslations('mobile.common')
  const toast = useToast()
  const online = useOnline()
  const format = useFormatter()
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()
  const resumes = useResumes()
  const upload = useUploadResume()
  const action = useResumeAction()
  const [deleting, setDeleting] = useState<{ id: string; fileName: string } | null>(null)

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

  function run(id: string, kind: 'primary' | 'delete') {
    action.mutate(
      { id, action: kind },
      {
        onSuccess: () => toast(kind === 'primary' ? t('setPrimarySuccess') : t('deleteSuccess')),
        onError: (err) => toast(errorMessage(err), 'error'),
      },
    )
  }

  const busyId = action.isPending ? action.variables?.id : undefined

  let body
  if (resumes.isPending) body = <ListSkeleton rows={2} />
  else if (resumes.isError) body = <ErrorState message={errorMessage(resumes.error)} onRetry={() => void resumes.refetch()} />
  else if (!resumes.data.items.length) body = <EmptyState title={t('empty')} body={t('privacy')} />
  else
    body = (
      <View style={styles.list}>
        {resumes.data.items.map((r) => (
          <View key={r.id} testID={`resume-${r.id}`}>
            <Card>
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
              <View style={styles.actions}>
                {!r.isPrimary ? (
                  <Button
                    testID={`resume-primary-${r.id}`}
                    label={t('setPrimary')}
                    variant="secondary"
                    accessibilityLabel={`${t('setPrimary')} ${r.fileName}`}
                    disabled={!online || action.isPending}
                    loading={busyId === r.id && action.variables?.action === 'primary'}
                    onPress={() => run(r.id, 'primary')}
                  />
                ) : null}
                <Button
                  testID={`resume-delete-${r.id}`}
                  label={t('delete')}
                  variant="ghost"
                  accessibilityLabel={`${t('delete')} ${r.fileName}`}
                  disabled={!online || action.isPending}
                  loading={busyId === r.id && action.variables?.action === 'delete'}
                  onPress={() => setDeleting({ id: r.id, fileName: r.fileName })}
                />
              </View>
            </Card>
          </View>
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
      <Sheet open={deleting !== null} onClose={() => setDeleting(null)} title={t('deleteConfirm')} closeLabel={common('close')}>
        <Text style={[styles.note, { color: colors.foreground }]}>{deleting?.fileName}</Text>
        <Button
          testID="resume-delete-confirm"
          label={t('delete')}
          variant="destructive"
          fullWidth
          onPress={() => {
            const target = deleting
            setDeleting(null)
            if (target) run(target.id, 'delete')
          }}
        />
        <Button label={common('cancel')} variant="secondary" fullWidth onPress={() => setDeleting(null)} />
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  note: { fontSize: 15, lineHeight: 22 },
  list: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
})
