import type { MobileProfile, MobileSchoolList } from '@shared/mobile-api'
import { X } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, ChipGroup, SelectField, TextField } from '@/components/ui'
import { COMMON_INDUSTRIES, MY_STATES, localized } from '@/lib/reference-data'
import { useTheme } from '@/theme/use-theme'
import { basicFromProfile, preferencesFromProfile, skillsFromProfile } from './api'
import {
  DEGREE_LEVELS,
  JOB_TYPES,
  LANGUAGE_LEVELS,
  WORK_AUTH,
  basicInputSchema,
  emptyToNull,
  parseOptionalNumber,
  preferencesInputSchema,
  skillsInputSchema,
  type BasicInput,
  type DegreeLevel,
  type JobType,
  type LanguageLevel,
  type PreferencesInput,
  type SkillsInput,
  type WorkAuth,
} from './schemas'

// 表单状态里数字字段先存字符串（用户可能正在输入"3."），提交时才转换和校验。
export type FieldErrors = Partial<Record<string, string>>

type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors }

function firstErrors(issues: { path: PropertyKey[] }[], message: (field: string) => string): FieldErrors {
  const out: FieldErrors = {}
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '')
    if (field && !out[field]) out[field] = message(field)
  }
  return out
}

const WORK_AUTH_KEY: Record<WorkAuth, string> = {
  MY_CITIZEN: 'workAuthMyCitizen',
  MY_PR: 'workAuthMyPr',
  STUDENT_PASS: 'workAuthStudentPass',
  DEPENDANT_PASS: 'workAuthDependantPass',
  NEEDS_WORK_PASS: 'workAuthNeedsWorkPass',
  OTHER: 'workAuthOther',
}
const DEGREE_KEY: Record<DegreeLevel, string> = {
  FOUNDATION: 'degreeLevelFoundation',
  DIPLOMA: 'degreeLevelDiploma',
  BACHELOR: 'degreeLevelBachelor',
  MASTER: 'degreeLevelMaster',
  PHD: 'degreeLevelPhd',
}
const INTENT_KEY: Record<JobType, string> = { INTERNSHIP: 'intentInternship', FULL_TIME: 'intentFullTime', PART_TIME: 'intentPartTime' }
const LANG_LEVEL_KEY: Record<LanguageLevel, string> = {
  BASIC: 'langLevelBasic',
  CONVERSATIONAL: 'langLevelConversational',
  FLUENT: 'langLevelFluent',
  NATIVE: 'langLevelNative',
}

/** 档案里各枚举的显示文案，复用 Web 建档页的 onboarding.* 文案 */
export function useProfileLabels() {
  const t = useTranslations('onboarding')
  return {
    workAuth: (v: string | null) => (v && v in WORK_AUTH_KEY ? t(WORK_AUTH_KEY[v as WorkAuth] as 'workAuthOther') : null),
    degree: (v: string | null) => (v && v in DEGREE_KEY ? t(DEGREE_KEY[v as DegreeLevel] as 'degreeLevelPhd') : null),
    intent: (v: string) => (v in INTENT_KEY ? t(INTENT_KEY[v as JobType] as 'intentInternship') : v),
    langLevel: (v: string) => (v in LANG_LEVEL_KEY ? t(LANG_LEVEL_KEY[v as LanguageLevel] as 'langLevelBasic') : v),
  }
}

// ---------- 基本信息 ----------

export type BasicState = {
  fullName: string
  schoolId: string | null
  degreeLevel: DegreeLevel | null
  major: string
  graduationYear: string
  graduationMonth: string
  cgpa: string
  nationality: string
  workAuth: WorkAuth
}

export function basicStateFrom(p: MobileProfile | undefined, fallbackName = ''): BasicState {
  const b = basicFromProfile(p, fallbackName)
  return {
    fullName: b.fullName,
    schoolId: b.schoolId,
    degreeLevel: b.degreeLevel,
    major: b.major ?? '',
    graduationYear: b.graduationYear?.toString() ?? '',
    graduationMonth: b.graduationMonth?.toString() ?? '',
    cgpa: b.cgpa?.toString() ?? '',
    nationality: b.nationality ?? '',
    workAuth: b.workAuth,
  }
}

export function useParseBasic() {
  const t = useTranslations('onboarding')
  return (s: BasicState): ParseResult<BasicInput> => {
    const r = basicInputSchema.safeParse({
      fullName: s.fullName,
      schoolId: s.schoolId,
      degreeLevel: s.degreeLevel,
      major: emptyToNull(s.major),
      graduationYear: parseOptionalNumber(s.graduationYear),
      graduationMonth: parseOptionalNumber(s.graduationMonth),
      cgpa: parseOptionalNumber(s.cgpa),
      nationality: emptyToNull(s.nationality)?.toUpperCase() ?? null,
      workAuth: s.workAuth,
    })
    if (r.success) return { ok: true, value: r.data }
    return { ok: false, errors: firstErrors(r.error.issues, (f) => (f === 'cgpa' ? t('errorCgpaRange') : t('errorRequired'))) }
  }
}

export function BasicFields({ value, onChange, errors, schools }: {
  value: BasicState
  onChange: (next: BasicState) => void
  errors: FieldErrors
  schools: MobileSchoolList['items']
}) {
  const t = useTranslations('onboarding')
  const locale = useLocale()
  const labels = useProfileLabels()
  const set = <K extends keyof BasicState>(k: K, v: BasicState[K]) => onChange({ ...value, [k]: v })
  return (
    <View style={styles.fields}>
      <TextField testID="field-fullName" label={t('fullNameLabel')} placeholder={t('fullNamePlaceholder')} value={value.fullName} onChangeText={(v) => set('fullName', v)} error={errors.fullName} autoComplete="name" />
      <SelectField
        testID="field-school"
        label={t('schoolLabel')}
        placeholder={t('schoolNone')}
        allowClear
        value={value.schoolId}
        options={schools.map((s) => ({ value: s.id, label: locale === 'en' ? s.nameEn : s.nameZh }))}
        onChange={(v) => set('schoolId', v)}
        error={errors.schoolId}
      />
      <SelectField
        label={t('degreeLevelLabel')}
        placeholder={t('degreeLevelPlaceholder')}
        allowClear
        value={value.degreeLevel}
        options={DEGREE_LEVELS.map((d) => ({ value: d, label: labels.degree(d) ?? d }))}
        onChange={(v) => set('degreeLevel', v)}
      />
      <TextField label={t('majorLabel')} placeholder={t('majorPlaceholder')} value={value.major} onChangeText={(v) => set('major', v)} error={errors.major} />
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField label={t('graduationYearLabel')} value={value.graduationYear} onChangeText={(v) => set('graduationYear', v)} keyboardType="number-pad" maxLength={4} error={errors.graduationYear} />
        </View>
        <View style={styles.flex}>
          <TextField label={t('graduationMonthLabel')} value={value.graduationMonth} onChangeText={(v) => set('graduationMonth', v)} keyboardType="number-pad" maxLength={2} error={errors.graduationMonth} />
        </View>
      </View>
      <TextField label={t('cgpaLabel')} value={value.cgpa} onChangeText={(v) => set('cgpa', v)} keyboardType="decimal-pad" maxLength={4} error={errors.cgpa} />
      <TextField label={t('nationalityLabel')} placeholder={t('nationalityPlaceholder')} value={value.nationality} onChangeText={(v) => set('nationality', v)} autoCapitalize="characters" maxLength={2} error={errors.nationality} />
      <SelectField
        testID="field-workAuth"
        label={t('workAuthLabel')}
        placeholder={t('workAuthPlaceholder')}
        value={value.workAuth}
        options={WORK_AUTH.map((w) => ({ value: w, label: labels.workAuth(w) ?? w }))}
        onChange={(v) => v && set('workAuth', v)}
        error={errors.workAuth}
      />
    </View>
  )
}

// ---------- 求职意向 ----------

export type PreferencesState = Omit<PreferencesInput, 'expectedSalaryMin' | 'expectedSalaryMax'> & { salaryMin: string; salaryMax: string }

export function preferencesStateFrom(p: MobileProfile | undefined): PreferencesState {
  const { expectedSalaryMin, expectedSalaryMax, ...rest } = preferencesFromProfile(p)
  return { ...rest, salaryMin: expectedSalaryMin?.toString() ?? '', salaryMax: expectedSalaryMax?.toString() ?? '' }
}

export function useParsePreferences() {
  const t = useTranslations('onboarding')
  return (s: PreferencesState): ParseResult<PreferencesInput> => {
    const { salaryMin, salaryMax, ...rest } = s
    const r = preferencesInputSchema.safeParse({ ...rest, expectedSalaryMin: parseOptionalNumber(salaryMin), expectedSalaryMax: parseOptionalNumber(salaryMax) })
    if (r.success) return { ok: true, value: r.data }
    return { ok: false, errors: firstErrors(r.error.issues, (f) => (f === 'intents' ? t('errorAtLeastOneIntent') : t('errorRequired'))) }
  }
}

function toggle<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

export function PreferencesFields({ value, onChange, errors }: { value: PreferencesState; onChange: (next: PreferencesState) => void; errors: FieldErrors }) {
  const t = useTranslations('onboarding')
  const locale = useLocale()
  const { colors } = useTheme()
  const labels = useProfileLabels()
  return (
    <View style={styles.fields}>
      <ChipGroup
        testIDPrefix="intent"
        label={t('intentsLabel')}
        options={JOB_TYPES.map((j) => ({ value: j, label: labels.intent(j) }))}
        selected={value.intents}
        onToggle={(v) => onChange({ ...value, intents: toggle(value.intents, v) })}
      />
      {errors.intents ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.destructive }}>
          {errors.intents}
        </Text>
      ) : null}
      <ChipGroup
        label={t('preferredStatesLabel')}
        options={MY_STATES.map((s) => ({ value: s.code, label: localized(s, locale) }))}
        selected={value.preferredStates}
        onToggle={(v) => onChange({ ...value, preferredStates: toggle(value.preferredStates, v) })}
      />
      <ChipGroup
        label={t('preferredIndustriesLabel')}
        options={COMMON_INDUSTRIES.map((s) => ({ value: s.code, label: localized(s, locale) }))}
        selected={value.preferredIndustries}
        onToggle={(v) => onChange({ ...value, preferredIndustries: toggle(value.preferredIndustries, v) })}
      />
      <Text style={[styles.groupLabel, { color: colors.foreground }]}>{t('expectedSalaryLabel')}</Text>
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField label={t('salaryMinPlaceholder')} value={value.salaryMin} onChangeText={(v) => onChange({ ...value, salaryMin: v })} keyboardType="number-pad" error={errors.expectedSalaryMin} />
        </View>
        <View style={styles.flex}>
          <TextField label={t('salaryMaxPlaceholder')} value={value.salaryMax} onChangeText={(v) => onChange({ ...value, salaryMax: v })} keyboardType="number-pad" error={errors.expectedSalaryMax} />
        </View>
      </View>
    </View>
  )
}

// ---------- 语言与技能 ----------

export type SkillsState = { languages: SkillsInput['languages']; skills: string[]; headline: string; summary: string }

export function skillsStateFrom(p: MobileProfile | undefined): SkillsState {
  const s = skillsFromProfile(p)
  return { languages: s.languages, skills: s.skills, headline: s.headline ?? '', summary: s.summary ?? '' }
}

export function useParseSkills() {
  const t = useTranslations('onboarding')
  return (s: SkillsState): ParseResult<SkillsInput> => {
    const r = skillsInputSchema.safeParse({
      languages: s.languages.filter((l) => l.language.trim()),
      skills: s.skills,
      headline: emptyToNull(s.headline),
      summary: emptyToNull(s.summary),
    })
    if (r.success) return { ok: true, value: r.data }
    return { ok: false, errors: firstErrors(r.error.issues, () => t('errorRequired')) }
  }
}

export function SkillsFields({ value, onChange, errors }: { value: SkillsState; onChange: (next: SkillsState) => void; errors: FieldErrors }) {
  const t = useTranslations('onboarding')
  const m = useTranslations('mobile.profile')
  const { colors, minTouchTarget, radius } = useTheme()
  const labels = useProfileLabels()
  const [draft, setDraft] = useState('')

  // 回车（IME 已上屏后的提交动作）或点"添加"才加技能：组字中的拼音不会被当成技能
  function addSkill() {
    const s = draft.trim()
    if (!s || value.skills.includes(s) || value.skills.length >= 30) return
    onChange({ ...value, skills: [...value.skills, s] })
    setDraft('')
  }
  function setLanguage(i: number, patch: Partial<SkillsState['languages'][number]>) {
    onChange({ ...value, languages: value.languages.map((l, j) => (j === i ? { ...l, ...patch } : l)) })
  }

  return (
    <View style={styles.fields}>
      <Text style={[styles.groupLabel, { color: colors.foreground }]}>{t('languagesLabel')}</Text>
      {value.languages.map((l, i) => (
        <View key={i} style={[styles.langRow, { borderColor: colors.border, borderRadius: radius.button }]}>
          <TextField label={t('languagePlaceholder')} value={l.language} onChangeText={(v) => setLanguage(i, { language: v })} maxLength={20} autoCapitalize="none" />
          <SelectField
            label={t('languageLevelLabel')}
            value={l.level}
            options={LANGUAGE_LEVELS.map((lv) => ({ value: lv, label: labels.langLevel(lv) }))}
            onChange={(v) => v && setLanguage(i, { level: v })}
          />
          <Button label={t('removeLanguage')} variant="ghost" onPress={() => onChange({ ...value, languages: value.languages.filter((_, j) => j !== i) })} />
        </View>
      ))}
      {errors.languages ? <Text style={{ color: colors.destructive }}>{errors.languages}</Text> : null}
      <Button
        testID="add-language"
        label={t('addLanguage')}
        variant="secondary"
        disabled={value.languages.length >= 20}
        onPress={() => onChange({ ...value, languages: [...value.languages, { language: '', level: 'CONVERSATIONAL' }] })}
      />

      <TextField
        testID="field-skill"
        label={t('skillsLabel')}
        placeholder={m('skillPlaceholder')}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={addSkill}
        submitBehavior="submit"
        returnKeyType="done"
        maxLength={50}
        error={errors.skills}
      />
      <Button testID="add-skill" label={m('addSkill')} variant="secondary" onPress={addSkill} disabled={!draft.trim()} />
      <View style={styles.tags}>
        {value.skills.map((s) => (
          <Pressable
            key={s}
            accessibilityRole="button"
            accessibilityLabel={t('removeSkill', { skill: s })}
            onPress={() => onChange({ ...value, skills: value.skills.filter((x) => x !== s) })}
            style={[styles.tag, { minHeight: minTouchTarget, backgroundColor: colors.brandMuted, borderRadius: radius.pill }]}
          >
            <Text style={{ color: colors.brandMutedForeground }}>{s}</Text>
            <X size={16} color={colors.brandMutedForeground} />
          </Pressable>
        ))}
      </View>

      <TextField label={t('headlineLabel')} placeholder={t('headlinePlaceholder')} value={value.headline} onChangeText={(v) => onChange({ ...value, headline: v })} maxLength={100} />
      <TextField
        label={t('summaryLabel')}
        placeholder={t('summaryPlaceholder')}
        value={value.summary}
        onChangeText={(v) => onChange({ ...value, summary: v })}
        maxLength={2000}
        multiline
        textAlignVertical="top"
        style={styles.multiline}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  fields: { gap: 16 },
  row: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  groupLabel: { fontSize: 15, fontWeight: '500' },
  langRow: { borderWidth: StyleSheet.hairlineWidth * 2, padding: 12, gap: 8 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14 },
  multiline: { minHeight: 120, paddingTop: 12 },
})
