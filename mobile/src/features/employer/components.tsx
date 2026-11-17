import type { MobileTalentCard, MobileTalentDetail } from '@shared/mobile-api'
import { Lock, LockOpen } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'
import { useFormatter, useLocale, useTranslations } from 'use-intl'

import { Card, Chip, SectionTitle } from '@/components/ui'
import { useProfileLabels } from '@/features/profile/forms'
import { useTheme } from '@/theme/use-theme'

/**
 * 候选人卡片：字段原样来自服务端 talent-card 序列化器（未解锁时名字已打码、自由文本已 redact），
 * App 不补、不猜任何字段。
 */
export function TalentSummary({ card }: { card: MobileTalentCard }) {
  const locale = useLocale()
  const labels = useProfileLabels()
  const t = useTranslations('mobile.employer')
  const { colors } = useTheme()
  const school = card.school ? (locale === 'en' ? card.school.nameEn : card.school.nameZh) : null
  const line = [school, card.major, labels.degree(card.degreeLevel), card.graduationYear ? t('gradYear', { year: card.graduationYear }) : null].filter(Boolean).join(' · ')
  return (
    <View style={styles.summary}>
      <View style={styles.row}>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {card.name}
        </Text>
        {card.unlocked ? <LockOpen color={colors.brand} size={16} /> : <Lock color={colors.mutedForeground} size={16} />}
        <Text style={{ color: card.unlocked ? colors.brand : colors.mutedForeground, fontSize: 13 }}>{card.unlocked ? t('unlocked') : t('locked')}</Text>
      </View>
      {line ? <Text style={{ color: colors.mutedForeground }}>{line}</Text> : null}
      {card.headline ? <Text style={{ color: colors.foreground, lineHeight: 21 }}>{card.headline}</Text> : null}
      <Text style={{ color: colors.mutedForeground }}>
        {[card.cgpa ? `CGPA ${card.cgpa}` : null, labels.workAuth(card.workAuth), t('completeness', { percent: card.completeness })].filter(Boolean).join(' · ')}
      </Text>
      {card.skills.length ? (
        <View style={styles.chips}>
          {card.skills.slice(0, 6).map((s) => (
            <Chip key={s} label={s} />
          ))}
        </View>
      ) : null}
    </View>
  )
}

export function TalentCard({ card, onPress, testID }: { card: MobileTalentCard; onPress: () => void; testID?: string }) {
  const t = useTranslations('mobile.employer')
  const locale = useLocale()
  const school = card.school ? (locale === 'en' ? card.school.nameEn : card.school.nameZh) : null
  return (
    <View testID={testID}>
      <Card onPress={onPress} accessibilityLabel={[card.name, card.unlocked ? t('unlocked') : t('locked'), school, card.major, t('completeness', { percent: card.completeness })].filter(Boolean).join('，')}>
        <TalentSummary card={card} />
      </Card>
    </View>
  )
}

/**
 * 详情各节：简介、教育、经历；联系方式只在服务端给了（解锁后经 contact-access 读出）时才显示。
 * 不显示服务端没给的东西，也不提示"猜测"内容。
 */
export function TalentDetailSections({ detail }: { detail: MobileTalentDetail }) {
  const td = useTranslations('talentDetail')
  const labels = useProfileLabels()
  const format = useFormatter()
  const { colors } = useTheme()
  const range = (a: string | null, b: string | null) =>
    [a, b].map((d) => (d ? format.dateTime(new Date(d), { year: 'numeric', month: 'short' }) : '…')).join(' – ')
  const kind = (k: string) => {
    const key = { INTERNSHIP: 'expKindInternship', WORK: 'expKindWork', PROJECT: 'expKindProject', CAMPUS: 'expKindCampus', AWARD: 'expKindAward' }[k]
    return key ? td(key as 'expKindWork') : k
  }
  const c = detail.contact
  const contactRows: [string, string | null][] = c
    ? [
        [td('contactPhone'), c.phone],
        [td('contactEmail'), c.email],
        [td('contactWhatsapp'), c.whatsapp],
        [td('contactWechat'), c.wechat],
        [td('contactLinkedin'), c.linkedinUrl],
      ]
    : []
  return (
    <>
      {detail.summary ? (
        <>
          <SectionTitle>{td('sectionSummary')}</SectionTitle>
          <Text style={[styles.body, { color: colors.foreground }]}>{detail.summary}</Text>
        </>
      ) : null}
      {detail.educations.length ? <SectionTitle>{td('sectionEducation')}</SectionTitle> : null}
      {detail.educations.map((e) => (
        <Card key={e.id}>
          <Text style={[styles.itemTitle, { color: colors.foreground }]}>{e.schoolName}</Text>
          <Text style={{ color: colors.mutedForeground }}>{[e.major, labels.degree(e.degreeLevel), range(e.startDate, e.endDate)].filter(Boolean).join(' · ')}</Text>
          {e.description ? <Text style={[styles.body, { color: colors.foreground }]}>{e.description}</Text> : null}
        </Card>
      ))}
      {detail.experiences.length ? <SectionTitle>{td('sectionExperience')}</SectionTitle> : null}
      {detail.experiences.map((e) => (
        <Card key={e.id}>
          <Text style={[styles.itemTitle, { color: colors.foreground }]}>{e.title}</Text>
          <Text style={{ color: colors.mutedForeground }}>{[kind(e.kind), e.organization, range(e.startDate, e.endDate)].filter(Boolean).join(' · ')}</Text>
          {e.description ? <Text style={[styles.body, { color: colors.foreground }]}>{e.description}</Text> : null}
        </Card>
      ))}
      {c ? (
        <>
          <SectionTitle>{td('sectionContact')}</SectionTitle>
          <Card>
            {contactRows
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <View key={k} style={styles.contactRow} accessible accessibilityLabel={`${k}: ${v}`}>
                  <Text style={[styles.contactKey, { color: colors.mutedForeground }]}>{k}</Text>
                  <Text selectable style={[styles.contactValue, { color: colors.foreground }]}>
                    {v}
                  </Text>
                </View>
              ))}
          </Card>
        </>
      ) : null}
    </>
  )
}

export function useApplicationStatusLabel() {
  const t = useTranslations('applicants.status')
  return (s: string) => t(s as 'APPLIED')
}

const styles = StyleSheet.create({
  summary: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  body: { fontSize: 16, lineHeight: 24 },
  itemTitle: { fontSize: 16, fontWeight: '600' },
  contactRow: { flexDirection: 'row', gap: 12, paddingVertical: 4, minHeight: 32 },
  contactKey: { width: 90, fontSize: 15 },
  contactValue: { flex: 1, fontSize: 15 },
})
