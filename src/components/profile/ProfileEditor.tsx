'use client'
import { useState, useTransition, KeyboardEvent, DragEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { handleTagKeyDown } from '@/lib/tag-input'
import {
  saveBasicInfoAction,
  saveJobPreferencesAction,
  saveSkillsAction,
  saveExperienceAction,
} from '@/server/actions/profile'
import type { ProfileForOnboarding, Step1Data } from '@/server/services/student-profile'
import { MY_STATES, COMMON_INDUSTRIES } from '@/lib/malaysia'

interface Props {
  locale: string
  profile: ProfileForOnboarding | null
  schools: { id: string; nameZh: string; nameEn: string }[]
}

type LanguageEntry = { language: string; level: string }
type EducationEntry = {
  schoolName: string
  degreeLevel: string
  major: string
  startDate: string
  endDate: string
  gpa: string
  description: string
}
type ExperienceEntry = {
  kind: string
  title: string
  organization: string
  startDate: string
  endDate: string
  description: string
}

function useSectionSave() {
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  function save(fn: () => Promise<{ ok: boolean }>) {
    setStatus('idle')
    startTransition(async () => {
      const result = await fn()
      setStatus(result.ok ? 'success' : 'error')
    })
  }

  return { isPending, status, save }
}

function SectionStatus({
  status,
  successLabel,
  errorLabel,
}: {
  status: 'idle' | 'success' | 'error'
  successLabel: string
  errorLabel: string
}) {
  if (status === 'success') {
    return <span className="text-sm text-green-600" role="status">{successLabel}</span>
  }
  if (status === 'error') {
    return <span className="text-sm text-destructive" role="alert">{errorLabel}</span>
  }
  return null
}

function useDraggable<T>(initial: T[]) {
  const [items, setItems] = useState<T[]>(initial)
  const [dragSrcIdx, setDragSrcIdx] = useState<number | null>(null)

  function handleDragStart(_e: DragEvent, idx: number) {
    setDragSrcIdx(idx)
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
  }

  function handleDrop(e: DragEvent, targetIdx: number) {
    e.preventDefault()
    if (dragSrcIdx === null || dragSrcIdx === targetIdx) {
      setDragSrcIdx(null)
      return
    }
    const next = [...items]
    const [moved] = next.splice(dragSrcIdx, 1)
    next.splice(targetIdx, 0, moved)
    setItems(next)
    setDragSrcIdx(null)
  }

  function handleDragEnd() {
    setDragSrcIdx(null)
  }

  function moveUp(idx: number) {
    if (idx === 0) return
    const next = [...items]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    setItems(next)
  }

  function moveDown(idx: number) {
    if (idx === items.length - 1) return
    const next = [...items]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    setItems(next)
  }

  return { items, setItems, dragSrcIdx, handleDragStart, handleDragOver, handleDrop, handleDragEnd, moveUp, moveDown }
}

export default function ProfileEditor({ locale, profile, schools }: Props) {
  const t = useTranslations('profile')
  const tOb = useTranslations('onboarding')

  // ---- Section 1: Basic Info ----
  const [fullName, setFullName] = useState(profile?.fullName ?? '')
  const [schoolId, setSchoolId] = useState(profile?.schoolId ?? '')
  const [degreeLevel, setDegreeLevel] = useState(profile?.degreeLevel ?? '')
  const [major, setMajor] = useState(profile?.major ?? '')
  const [graduationYear, setGraduationYear] = useState(
    profile?.graduationYear ? String(profile.graduationYear) : '',
  )
  const [graduationMonth, setGraduationMonth] = useState(
    profile?.graduationMonth ? String(profile.graduationMonth) : '',
  )
  const [cgpa, setCgpa] = useState(profile?.cgpa ? String(profile.cgpa) : '')
  const [nationality, setNationality] = useState(profile?.nationality ?? '')
  const [workAuth, setWorkAuth] = useState(profile?.workAuth ?? '')

  const basic = useSectionSave()

  function saveBasicInfo() {
    basic.save(() =>
      saveBasicInfoAction({
        fullName: fullName.trim(),
        schoolId: schoolId || undefined,
        degreeLevel: degreeLevel || undefined,
        major: major.trim() || undefined,
        graduationYear: graduationYear ? parseInt(graduationYear, 10) : undefined,
        graduationMonth: graduationMonth ? parseInt(graduationMonth, 10) : undefined,
        cgpa: cgpa ? parseFloat(cgpa) : undefined,
        nationality: nationality.trim().toUpperCase() || undefined,
        workAuth: workAuth as Step1Data['workAuth'],
      }),
    )
  }

  // ---- Section 2: Job Preferences ----
  const [intents, setIntents] = useState<string[]>(profile?.intents ?? [])
  const [availableFrom, setAvailableFrom] = useState(
    profile?.availableFrom ? new Date(profile.availableFrom).toISOString().slice(0, 10) : '',
  )
  const [preferredStates, setPreferredStates] = useState<string[]>(profile?.preferredStates ?? [])
  const [preferredIndustries, setPreferredIndustries] = useState<string[]>(
    profile?.preferredIndustries ?? [],
  )
  const [salaryMin, setSalaryMin] = useState(
    profile?.expectedSalaryMin ? String(profile.expectedSalaryMin) : '',
  )
  const [salaryMax, setSalaryMax] = useState(
    profile?.expectedSalaryMax ? String(profile.expectedSalaryMax) : '',
  )

  const jobPref = useSectionSave()

  function saveJobPref() {
    jobPref.save(() =>
      saveJobPreferencesAction({
        intents: intents as ('INTERNSHIP' | 'FULL_TIME' | 'PART_TIME')[],
        availableFrom: availableFrom ? new Date(availableFrom).toISOString() : undefined,
        preferredStates,
        preferredIndustries,
        expectedSalaryMin: salaryMin ? parseInt(salaryMin, 10) : undefined,
        expectedSalaryMax: salaryMax ? parseInt(salaryMax, 10) : undefined,
      }),
    )
  }

  // ---- Section 3: Skills & Languages ----
  const [languages, setLanguages] = useState<LanguageEntry[]>(
    (profile?.languages ?? []).map((l) => ({ language: l.language, level: l.level })),
  )
  const [skills, setSkills] = useState<string[]>(profile?.skills ?? [])
  const [skillInput, setSkillInput] = useState('')
  const [headline, setHeadline] = useState(profile?.headline ?? '')
  const [summary, setSummary] = useState(profile?.summary ?? '')

  const skillsSec = useSectionSave()

  function handleSkillKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    handleTagKeyDown(e, skillInput, skills, 30, (tag) => setSkills([...skills, tag]), () => setSkillInput(''))
  }

  function saveSkills() {
    skillsSec.save(() =>
      saveSkillsAction({
        languages: languages
          .filter((l) => l.language && l.level)
          .map((l) => ({
            language: l.language,
            level: l.level as 'BASIC' | 'CONVERSATIONAL' | 'FLUENT' | 'NATIVE',
          })),
        skills,
        headline: headline.trim() || undefined,
        summary: summary.trim() || undefined,
      }),
    )
  }

  // ---- Section 4: Education & Experience ----
  const educationDnd = useDraggable<EducationEntry>(
    (profile?.educations ?? []).map((e) => ({
      schoolName: e.schoolName,
      degreeLevel: e.degreeLevel ?? '',
      major: e.major ?? '',
      startDate: e.startDate ? new Date(e.startDate).toISOString().slice(0, 10) : '',
      endDate: e.endDate ? new Date(e.endDate).toISOString().slice(0, 10) : '',
      gpa: e.gpa ?? '',
      description: e.description ?? '',
    })),
  )
  const experienceDnd = useDraggable<ExperienceEntry>(
    (profile?.experiences ?? []).map((e) => ({
      kind: e.kind,
      title: e.title,
      organization: e.organization ?? '',
      startDate: e.startDate ? new Date(e.startDate).toISOString().slice(0, 10) : '',
      endDate: e.endDate ? new Date(e.endDate).toISOString().slice(0, 10) : '',
      description: e.description ?? '',
    })),
  )

  const expSec = useSectionSave()

  function saveExperience() {
    expSec.save(() =>
      saveExperienceAction({
        educations: educationDnd.items
          .filter((e) => e.schoolName.trim())
          .map((e, i) => ({
            schoolName: e.schoolName.trim(),
            degreeLevel: e.degreeLevel || undefined,
            major: e.major.trim() || undefined,
            startDate: e.startDate ? new Date(e.startDate).toISOString() : undefined,
            endDate: e.endDate ? new Date(e.endDate).toISOString() : undefined,
            gpa: e.gpa.trim() || undefined,
            description: e.description.trim() || undefined,
            sortOrder: i,
          })),
        experiences: experienceDnd.items
          .filter((e) => e.title.trim())
          .map((e, i) => ({
            kind: e.kind as 'INTERNSHIP' | 'WORK' | 'PROJECT' | 'CAMPUS' | 'AWARD',
            title: e.title.trim(),
            organization: e.organization.trim() || undefined,
            startDate: e.startDate ? new Date(e.startDate).toISOString() : undefined,
            endDate: e.endDate ? new Date(e.endDate).toISOString() : undefined,
            description: e.description.trim() || undefined,
            sortOrder: i,
          })),
      }),
    )
  }

  // ---- Helpers ----
  function toggleArray<T>(arr: T[], value: T): T[] {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
  }

  const selectClass =
    'mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div className="space-y-8">
      {/* ---- Basic Info Section ---- */}
      <section aria-labelledby="section-basic">
        <div className="flex items-center justify-between mb-4">
          <h2 id="section-basic" className="text-lg font-semibold">{t('sectionBasicInfo')}</h2>
          <div className="flex items-center gap-3">
            <SectionStatus
              status={basic.status}
              successLabel={t('saveSuccess')}
              errorLabel={t('saveError')}
            />
            <Button
              type="button"
              size="sm"
              onClick={saveBasicInfo}
              disabled={basic.isPending || !workAuth}
            >
              {basic.isPending ? t('saving') : t('saveSection')}
            </Button>
          </div>
        </div>
        <div className="space-y-4 rounded-lg border p-4">
          <div>
            <Label htmlFor="pf-fullName">{tOb('fullNameLabel')} *</Label>
            <Input
              id="pf-fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={tOb('fullNamePlaceholder')}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="pf-school">{tOb('schoolLabel')}</Label>
            <select
              id="pf-school"
              value={schoolId}
              onChange={(e) => setSchoolId(e.target.value)}
              className={selectClass}
            >
              <option value="">{tOb('schoolPlaceholder')}</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {locale === 'zh' ? s.nameZh : s.nameEn}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="pf-degreeLevel">{tOb('degreeLevelLabel')}</Label>
              <select
                id="pf-degreeLevel"
                value={degreeLevel}
                onChange={(e) => setDegreeLevel(e.target.value)}
                className={selectClass}
              >
                <option value="">{tOb('degreeLevelPlaceholder')}</option>
                <option value="FOUNDATION">{tOb('degreeLevelFoundation')}</option>
                <option value="DIPLOMA">{tOb('degreeLevelDiploma')}</option>
                <option value="BACHELOR">{tOb('degreeLevelBachelor')}</option>
                <option value="MASTER">{tOb('degreeLevelMaster')}</option>
                <option value="PHD">{tOb('degreeLevelPhd')}</option>
              </select>
            </div>
            <div>
              <Label htmlFor="pf-major">{tOb('majorLabel')}</Label>
              <Input
                id="pf-major"
                value={major}
                onChange={(e) => setMajor(e.target.value)}
                placeholder={tOb('majorPlaceholder')}
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="pf-gradYear">{tOb('graduationYearLabel')}</Label>
              <Input
                id="pf-gradYear"
                type="number"
                min={2000}
                max={2040}
                value={graduationYear}
                onChange={(e) => setGraduationYear(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="pf-gradMonth">{tOb('graduationMonthLabel')}</Label>
              <Input
                id="pf-gradMonth"
                type="number"
                min={1}
                max={12}
                value={graduationMonth}
                onChange={(e) => setGraduationMonth(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="pf-cgpa">{tOb('cgpaLabel')}</Label>
              <Input
                id="pf-cgpa"
                type="number"
                step="0.01"
                min={0}
                max={4}
                value={cgpa}
                onChange={(e) => setCgpa(e.target.value)}
                placeholder="0.00"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="pf-nationality">{tOb('nationalityLabel')}</Label>
              <Input
                id="pf-nationality"
                maxLength={2}
                value={nationality}
                onChange={(e) => setNationality(e.target.value.toUpperCase())}
                placeholder={tOb('nationalityPlaceholder')}
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="pf-workAuth">{tOb('workAuthLabel')} *</Label>
            <select
              id="pf-workAuth"
              value={workAuth}
              onChange={(e) => setWorkAuth(e.target.value)}
              className={selectClass}
            >
              <option value="">{tOb('workAuthPlaceholder')}</option>
              <option value="MY_CITIZEN">{tOb('workAuthMyCitizen')}</option>
              <option value="MY_PR">{tOb('workAuthMyPr')}</option>
              <option value="STUDENT_PASS">{tOb('workAuthStudentPass')}</option>
              <option value="DEPENDANT_PASS">{tOb('workAuthDependantPass')}</option>
              <option value="NEEDS_WORK_PASS">{tOb('workAuthNeedsWorkPass')}</option>
              <option value="OTHER">{tOb('workAuthOther')}</option>
            </select>
          </div>
        </div>
      </section>

      {/* ---- Job Preferences Section ---- */}
      <section aria-labelledby="section-jobpref">
        <div className="flex items-center justify-between mb-4">
          <h2 id="section-jobpref" className="text-lg font-semibold">{t('sectionJobPreferences')}</h2>
          <div className="flex items-center gap-3">
            <SectionStatus
              status={jobPref.status}
              successLabel={t('saveSuccess')}
              errorLabel={t('saveError')}
            />
            <Button
              type="button"
              size="sm"
              onClick={saveJobPref}
              disabled={jobPref.isPending || intents.length === 0}
            >
              {jobPref.isPending ? t('saving') : t('saveSection')}
            </Button>
          </div>
        </div>
        <div className="space-y-4 rounded-lg border p-4">
          <div>
            <Label>{tOb('intentsLabel')} *</Label>
            <div className="mt-2 flex flex-col gap-2">
              {(['INTERNSHIP', 'FULL_TIME', 'PART_TIME'] as const).map((v) => (
                <label key={v} className="flex items-center gap-2 cursor-pointer min-h-[24px]">
                  <input
                    type="checkbox"
                    checked={intents.includes(v)}
                    onChange={() => setIntents(toggleArray(intents, v))}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">
                    {v === 'INTERNSHIP'
                      ? tOb('intentInternship')
                      : v === 'FULL_TIME'
                        ? tOb('intentFullTime')
                        : tOb('intentPartTime')}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="pf-availableFrom">{tOb('availableFromLabel')}</Label>
            <Input
              id="pf-availableFrom"
              type="date"
              value={availableFrom}
              onChange={(e) => setAvailableFrom(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>{tOb('preferredStatesLabel')}</Label>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {MY_STATES.map((s) => (
                <label key={s.code} className="flex items-center gap-2 cursor-pointer min-h-[24px]">
                  <input
                    type="checkbox"
                    checked={preferredStates.includes(s.code)}
                    onChange={() => setPreferredStates(toggleArray(preferredStates, s.code))}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">{locale === 'zh' ? s.nameZh : s.nameEn}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label>{tOb('preferredIndustriesLabel')}</Label>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {COMMON_INDUSTRIES.map((ind) => (
                <label key={ind.code} className="flex items-center gap-2 cursor-pointer min-h-[24px]">
                  <input
                    type="checkbox"
                    checked={preferredIndustries.includes(ind.code)}
                    onChange={() => setPreferredIndustries(toggleArray(preferredIndustries, ind.code))}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">{locale === 'zh' ? ind.nameZh : ind.nameEn}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label>{tOb('expectedSalaryLabel')}</Label>
            <div className="mt-1 flex gap-2">
              <Input
                type="number"
                min={0}
                value={salaryMin}
                onChange={(e) => setSalaryMin(e.target.value)}
                placeholder={tOb('salaryMinPlaceholder')}
              />
              <Input
                type="number"
                min={0}
                value={salaryMax}
                onChange={(e) => setSalaryMax(e.target.value)}
                placeholder={tOb('salaryMaxPlaceholder')}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ---- Skills & Languages Section ---- */}
      <section aria-labelledby="section-skills">
        <div className="flex items-center justify-between mb-4">
          <h2 id="section-skills" className="text-lg font-semibold">{t('sectionSkills')}</h2>
          <div className="flex items-center gap-3">
            <SectionStatus
              status={skillsSec.status}
              successLabel={t('saveSuccess')}
              errorLabel={t('saveError')}
            />
            <Button type="button" size="sm" onClick={saveSkills} disabled={skillsSec.isPending}>
              {skillsSec.isPending ? t('saving') : t('saveSection')}
            </Button>
          </div>
        </div>
        <div className="space-y-4 rounded-lg border p-4">
          <div>
            <Label>{tOb('languagesLabel')}</Label>
            <div className="mt-2 space-y-2">
              {languages.map((lang, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    value={lang.language}
                    onChange={(e) =>
                      setLanguages(languages.map((l, idx) => (idx === i ? { ...l, language: e.target.value } : l)))
                    }
                    placeholder={tOb('languagePlaceholder')}
                    className="flex-1"
                  />
                  <select
                    value={lang.level}
                    onChange={(e) =>
                      setLanguages(languages.map((l, idx) => (idx === i ? { ...l, level: e.target.value } : l)))
                    }
                    className="h-10 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="BASIC">{tOb('langLevelBasic')}</option>
                    <option value="CONVERSATIONAL">{tOb('langLevelConversational')}</option>
                    <option value="FLUENT">{tOb('langLevelFluent')}</option>
                    <option value="NATIVE">{tOb('langLevelNative')}</option>
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setLanguages(languages.filter((_, idx) => idx !== i))}
                    aria-label={tOb('removeLanguage')}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLanguages([...languages, { language: '', level: 'CONVERSATIONAL' }])}
              >
                + {tOb('addLanguage')}
              </Button>
            </div>
          </div>
          <div>
            <Label>{tOb('skillsLabel')}</Label>
            <div className="mt-1 flex flex-wrap gap-1 p-2 border rounded-md min-h-[42px]">
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                >
                  {skill}
                  <button
                    type="button"
                    onClick={() => setSkills(skills.filter((s) => s !== skill))}
                    className="ml-0.5 text-primary/70 hover:text-primary min-w-[24px] min-h-[24px] flex items-center justify-center"
                    aria-label={tOb('removeSkill', { skill })}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                data-testid="skill-input"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={handleSkillKeyDown}
                placeholder={skills.length === 0 ? tOb('skillsPlaceholder') : ''}
                className="flex-1 min-w-[120px] border-none outline-none bg-transparent text-sm"
                disabled={skills.length >= 30}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="pf-headline">{tOb('headlineLabel')}</Label>
            <Input
              id="pf-headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder={tOb('headlinePlaceholder')}
              maxLength={100}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="pf-summary">{tOb('summaryLabel')}</Label>
            <textarea
              id="pf-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={tOb('summaryPlaceholder')}
              maxLength={2000}
              rows={5}
              className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      </section>

      {/* ---- Education & Experience Section ---- */}
      <section aria-labelledby="section-experience">
        <div className="flex items-center justify-between mb-4">
          <h2 id="section-experience" className="text-lg font-semibold">{t('sectionExperience')}</h2>
          <div className="flex items-center gap-3">
            <SectionStatus
              status={expSec.status}
              successLabel={t('saveSuccess')}
              errorLabel={t('saveError')}
            />
            <Button type="button" size="sm" onClick={saveExperience} disabled={expSec.isPending}>
              {expSec.isPending ? t('saving') : t('saveSection')}
            </Button>
          </div>
        </div>
        <div className="space-y-6 rounded-lg border p-4">
          {/* Educations */}
          <div>
            <Label>{tOb('educationsLabel')}</Label>
            <div className="mt-2 space-y-3">
              {educationDnd.items.map((edu, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={(e) => educationDnd.handleDragStart(e, i)}
                  onDragOver={educationDnd.handleDragOver}
                  onDrop={(e) => educationDnd.handleDrop(e, i)}
                  onDragEnd={educationDnd.handleDragEnd}
                  className={`rounded-md border p-4 space-y-3 cursor-grab active:cursor-grabbing ${
                    educationDnd.dragSrcIdx === i ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-muted-foreground cursor-grab select-none"
                        aria-label={t('dragHandle')}
                        title={t('dragHandle')}
                      >
                        ⠿
                      </span>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => educationDnd.moveUp(i)}
                          disabled={i === 0}
                          aria-label={t('moveUp')}
                          className="h-6 w-6 p-0"
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => educationDnd.moveDown(i)}
                          disabled={i === educationDnd.items.length - 1}
                          aria-label={t('moveDown')}
                          className="h-6 w-6 p-0"
                        >
                          ↓
                        </Button>
                      </div>
                      <span className="text-sm font-medium">{edu.schoolName || `#${i + 1}`}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => educationDnd.setItems(educationDnd.items.filter((_, idx) => idx !== i))}
                    >
                      {tOb('removeEntry')}
                    </Button>
                  </div>
                  <div>
                    <Label className="text-xs">{tOb('schoolNameLabel')} *</Label>
                    <Input
                      value={edu.schoolName}
                      onChange={(e) =>
                        educationDnd.setItems(
                          educationDnd.items.map((item, idx) =>
                            idx === i ? { ...item, schoolName: e.target.value } : item,
                          ),
                        )
                      }
                      placeholder={tOb('schoolNamePlaceholder')}
                      className="mt-1"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">{tOb('degreeLevelLabel')}</Label>
                      <select
                        value={edu.degreeLevel}
                        onChange={(e) =>
                          educationDnd.setItems(
                            educationDnd.items.map((item, idx) =>
                              idx === i ? { ...item, degreeLevel: e.target.value } : item,
                            ),
                          )
                        }
                        className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value=""></option>
                        <option value="FOUNDATION">{tOb('degreeLevelFoundation')}</option>
                        <option value="DIPLOMA">{tOb('degreeLevelDiploma')}</option>
                        <option value="BACHELOR">{tOb('degreeLevelBachelor')}</option>
                        <option value="MASTER">{tOb('degreeLevelMaster')}</option>
                        <option value="PHD">{tOb('degreeLevelPhd')}</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">{tOb('majorLabel')}</Label>
                      <Input
                        value={edu.major}
                        onChange={(e) =>
                          educationDnd.setItems(
                            educationDnd.items.map((item, idx) =>
                              idx === i ? { ...item, major: e.target.value } : item,
                            ),
                          )
                        }
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">{tOb('startDateLabel')}</Label>
                      <Input
                        type="date"
                        value={edu.startDate}
                        onChange={(e) =>
                          educationDnd.setItems(
                            educationDnd.items.map((item, idx) =>
                              idx === i ? { ...item, startDate: e.target.value } : item,
                            ),
                          )
                        }
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{tOb('endDateLabel')}</Label>
                      <Input
                        type="date"
                        value={edu.endDate}
                        onChange={(e) =>
                          educationDnd.setItems(
                            educationDnd.items.map((item, idx) =>
                              idx === i ? { ...item, endDate: e.target.value } : item,
                            ),
                          )
                        }
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">{tOb('gpaLabel')}</Label>
                    <Input
                      value={edu.gpa}
                      onChange={(e) =>
                        educationDnd.setItems(
                          educationDnd.items.map((item, idx) =>
                            idx === i ? { ...item, gpa: e.target.value } : item,
                          ),
                        )
                      }
                      className="mt-1"
                      maxLength={20}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{tOb('descriptionLabel')}</Label>
                    <textarea
                      value={edu.description}
                      onChange={(e) =>
                        educationDnd.setItems(
                          educationDnd.items.map((item, idx) =>
                            idx === i ? { ...item, description: e.target.value } : item,
                          ),
                        )
                      }
                      rows={2}
                      maxLength={1000}
                      className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  educationDnd.setItems([
                    ...educationDnd.items,
                    { schoolName: '', degreeLevel: '', major: '', startDate: '', endDate: '', gpa: '', description: '' },
                  ])
                }
              >
                + {tOb('addEducation')}
              </Button>
            </div>
          </div>

          {/* Experiences */}
          <div>
            <Label>{tOb('experiencesLabel')}</Label>
            <div className="mt-2 space-y-3">
              {experienceDnd.items.map((exp, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={(e) => experienceDnd.handleDragStart(e, i)}
                  onDragOver={experienceDnd.handleDragOver}
                  onDrop={(e) => experienceDnd.handleDrop(e, i)}
                  onDragEnd={experienceDnd.handleDragEnd}
                  className={`rounded-md border p-4 space-y-3 cursor-grab active:cursor-grabbing ${
                    experienceDnd.dragSrcIdx === i ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-muted-foreground cursor-grab select-none"
                        aria-label={t('dragHandle')}
                        title={t('dragHandle')}
                      >
                        ⠿
                      </span>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => experienceDnd.moveUp(i)}
                          disabled={i === 0}
                          aria-label={t('moveUp')}
                          className="h-6 w-6 p-0"
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => experienceDnd.moveDown(i)}
                          disabled={i === experienceDnd.items.length - 1}
                          aria-label={t('moveDown')}
                          className="h-6 w-6 p-0"
                        >
                          ↓
                        </Button>
                      </div>
                      <span className="text-sm font-medium">{exp.title || `#${i + 1}`}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => experienceDnd.setItems(experienceDnd.items.filter((_, idx) => idx !== i))}
                    >
                      {tOb('removeEntry')}
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">{tOb('experienceKindLabel')}</Label>
                      <select
                        value={exp.kind}
                        onChange={(e) =>
                          experienceDnd.setItems(
                            experienceDnd.items.map((item, idx) =>
                              idx === i ? { ...item, kind: e.target.value } : item,
                            ),
                          )
                        }
                        className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="INTERNSHIP">{tOb('kindInternship')}</option>
                        <option value="WORK">{tOb('kindWork')}</option>
                        <option value="PROJECT">{tOb('kindProject')}</option>
                        <option value="CAMPUS">{tOb('kindCampus')}</option>
                        <option value="AWARD">{tOb('kindAward')}</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">{tOb('entryTitleLabel')} *</Label>
                      <Input
                        value={exp.title}
                        onChange={(e) =>
                          experienceDnd.setItems(
                            experienceDnd.items.map((item, idx) =>
                              idx === i ? { ...item, title: e.target.value } : item,
                            ),
                          )
                        }
                        placeholder={tOb('entryTitlePlaceholder')}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">{tOb('organizationLabel')}</Label>
                    <Input
                      value={exp.organization}
                      onChange={(e) =>
                        experienceDnd.setItems(
                          experienceDnd.items.map((item, idx) =>
                            idx === i ? { ...item, organization: e.target.value } : item,
                          ),
                        )
                      }
                      className="mt-1"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">{tOb('startDateLabel')}</Label>
                      <Input
                        type="date"
                        value={exp.startDate}
                        onChange={(e) =>
                          experienceDnd.setItems(
                            experienceDnd.items.map((item, idx) =>
                              idx === i ? { ...item, startDate: e.target.value } : item,
                            ),
                          )
                        }
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{tOb('endDateLabel')}</Label>
                      <Input
                        type="date"
                        value={exp.endDate}
                        onChange={(e) =>
                          experienceDnd.setItems(
                            experienceDnd.items.map((item, idx) =>
                              idx === i ? { ...item, endDate: e.target.value } : item,
                            ),
                          )
                        }
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">{tOb('descriptionLabel')}</Label>
                    <textarea
                      value={exp.description}
                      onChange={(e) =>
                        experienceDnd.setItems(
                          experienceDnd.items.map((item, idx) =>
                            idx === i ? { ...item, description: e.target.value } : item,
                          ),
                        )
                      }
                      rows={2}
                      maxLength={1000}
                      className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  experienceDnd.setItems([
                    ...experienceDnd.items,
                    { kind: 'INTERNSHIP', title: '', organization: '', startDate: '', endDate: '', description: '' },
                  ])
                }
              >
                + {tOb('addExperience')}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
