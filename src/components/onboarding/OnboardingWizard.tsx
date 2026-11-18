'use client'
import { Select } from '@/components/ui/select'
import { useState, useTransition, KeyboardEvent, type ComponentProps } from 'react'
import Stepper, { Step } from '@/components/ui/stepper/Stepper'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { handleTagKeyDown } from '@/lib/tag-input'
import {
  saveStep1Action,
  saveStep2Action,
  saveStep3Action,
  saveStep4Action,
  saveStep1DraftAction,
  saveStep2DraftAction,
  saveStep3DraftAction,
  saveStep4DraftAction,
  completeOnboardingAction,
} from '@/server/actions/onboarding'
import { updateOwnContactAction } from '@/server/actions/contact'
import { getOwnResumesAction } from '@/server/actions/resume'
import type { ContactData } from '@/server/services/contact-access'
import { ContactFields, normalizeContact } from '@/components/contact/ContactFields'
import { ResumeManager } from '@/app/[locale]/s/resume/resume-client'
import type { ProfileForOnboarding, Step1Data } from '@/server/services/student-profile'
import { MY_STATES, COMMON_INDUSTRIES } from '@/lib/malaysia'

const TOTAL_STEPS = 5

const NO_SCHOOL = '__none__'

interface Props {
  locale: string
  initialStep: number
  profile: ProfileForOnboarding
  schools: { id: string; nameZh: string; nameEn: string }[]
  contact: ContactData
  resumes: ComponentProps<typeof ResumeManager>['resumes']
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

export default function OnboardingWizard({ locale, initialStep, profile, schools, contact: initialContact, resumes: initialResumes }: Props) {
  const t = useTranslations('onboarding')
  const tContact = useTranslations('contact')
  const tResume = useTranslations('resume')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(Math.min(initialStep, TOTAL_STEPS))
  const [contact, setContact] = useState(initialContact)
  const [resumeBusy, setResumeBusy] = useState(false)
  const [resumes, setResumes] = useState(initialResumes)

  async function refreshResumes() {
    const result = await getOwnResumesAction()
    if (!result.ok) throw new Error('Resume list unavailable')
    setResumes(result.data.resumes)
  }

  // ---- Step 1 state ----
  const [fullName, setFullName] = useState(profile.fullName ?? '')
  // '' = not chosen yet (shows the placeholder); NO_SCHOOL = explicitly "not in the list".
  const [schoolId, setSchoolId] = useState(profile.schoolId ?? '')
  const [degreeLevel, setDegreeLevel] = useState(profile.degreeLevel ?? '')
  const [major, setMajor] = useState(profile.major ?? '')
  const [graduationYear, setGraduationYear] = useState(
    profile.graduationYear ? String(profile.graduationYear) : '',
  )
  const [graduationMonth, setGraduationMonth] = useState(
    profile.graduationMonth ? String(profile.graduationMonth) : '',
  )
  const [cgpa, setCgpa] = useState(profile.cgpa ? String(profile.cgpa) : '')
  const [nationality, setNationality] = useState(profile.nationality ?? '')
  const [workAuth, setWorkAuth] = useState(profile.workAuth ?? '')

  // ---- Step 2 state ----
  const [intents, setIntents] = useState<string[]>(profile.intents ?? [])
  const [availableFrom, setAvailableFrom] = useState(
    profile.availableFrom ? new Date(profile.availableFrom).toISOString().slice(0, 10) : '',
  )
  const [preferredStates, setPreferredStates] = useState<string[]>(profile.preferredStates ?? [])
  const [preferredIndustries, setPreferredIndustries] = useState<string[]>(
    profile.preferredIndustries ?? [],
  )
  const [salaryMin, setSalaryMin] = useState(
    profile.expectedSalaryMin ? String(profile.expectedSalaryMin) : '',
  )
  const [salaryMax, setSalaryMax] = useState(
    profile.expectedSalaryMax ? String(profile.expectedSalaryMax) : '',
  )

  // ---- Step 3 state ----
  const [languages, setLanguages] = useState<LanguageEntry[]>(
    profile.languages.map((l) => ({ language: l.language, level: l.level })),
  )
  const [skills, setSkills] = useState<string[]>(profile.skills ?? [])
  const [skillInput, setSkillInput] = useState('')
  const [headline, setHeadline] = useState(profile.headline ?? '')
  const [summary, setSummary] = useState(profile.summary ?? '')

  // ---- Step 4 state ----
  const [educations, setEducations] = useState<EducationEntry[]>(
    profile.educations.map((e) => ({
      schoolName: e.schoolName,
      degreeLevel: e.degreeLevel ?? '',
      major: e.major ?? '',
      startDate: e.startDate ? new Date(e.startDate).toISOString().slice(0, 10) : '',
      endDate: e.endDate ? new Date(e.endDate).toISOString().slice(0, 10) : '',
      gpa: e.gpa ?? '',
      description: e.description ?? '',
    })),
  )
  const [experiences, setExperiences] = useState<ExperienceEntry[]>(
    profile.experiences.map((e) => ({
      kind: e.kind,
      title: e.title,
      organization: e.organization ?? '',
      startDate: e.startDate ? new Date(e.startDate).toISOString().slice(0, 10) : '',
      endDate: e.endDate ? new Date(e.endDate).toISOString().slice(0, 10) : '',
      description: e.description ?? '',
    })),
  )

  // ---- Helpers ----

  function toggleArray<T>(arr: T[], value: T): T[] {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
  }

  function handleSkillKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    handleTagKeyDown(e, skillInput, skills, 30, (tag) => setSkills([...skills, tag]), () => setSkillInput(''))
  }

  function buildStep1Payload() {
    return {
      fullName: fullName.trim(),
      schoolId: schoolId && schoolId !== NO_SCHOOL ? schoolId : undefined,
      degreeLevel: degreeLevel || undefined,
      major: major.trim() || undefined,
      graduationYear: graduationYear ? parseInt(graduationYear, 10) : undefined,
      graduationMonth: graduationMonth ? parseInt(graduationMonth, 10) : undefined,
      cgpa: cgpa ? parseFloat(cgpa) : undefined,
      nationality: nationality.trim().toUpperCase() || undefined,
      workAuth: workAuth as Step1Data['workAuth'],
    }
  }

  function buildStep2Payload() {
    return {
      intents: intents as ('INTERNSHIP' | 'FULL_TIME' | 'PART_TIME')[],
      availableFrom: availableFrom ? new Date(availableFrom).toISOString() : undefined,
      preferredStates,
      preferredIndustries,
      expectedSalaryMin: salaryMin ? parseInt(salaryMin, 10) : undefined,
      expectedSalaryMax: salaryMax ? parseInt(salaryMax, 10) : undefined,
    }
  }

  function buildStep3Payload() {
    return {
      languages: languages
        .filter((l) => l.language && l.level)
        .map((l) => ({ language: l.language, level: l.level as 'BASIC' | 'CONVERSATIONAL' | 'FLUENT' | 'NATIVE' })),
      // A skill typed but not confirmed with Enter is still what the student meant to save.
      skills: skillInput.trim() && !skills.includes(skillInput.trim()) && skills.length < 30
        ? [...skills, skillInput.trim()]
        : skills,
      headline: headline.trim() || undefined,
      summary: summary.trim() || undefined,
    }
  }

  function buildStep4Payload() {
    return {
      educations: educations
        .filter((e) => e.schoolName.trim())
        .map((e) => ({
          schoolName: e.schoolName.trim(),
          degreeLevel: e.degreeLevel || undefined,
          major: e.major.trim() || undefined,
          startDate: e.startDate ? new Date(e.startDate).toISOString() : undefined,
          endDate: e.endDate ? new Date(e.endDate).toISOString() : undefined,
          gpa: e.gpa.trim() || undefined,
          description: e.description.trim() || undefined,
        })),
      experiences: experiences
        .filter((e) => e.title.trim())
        .map((e) => ({
          kind: e.kind as 'INTERNSHIP' | 'WORK' | 'PROJECT' | 'CAMPUS' | 'AWARD',
          title: e.title.trim(),
          organization: e.organization.trim() || undefined,
          startDate: e.startDate ? new Date(e.startDate).toISOString() : undefined,
          endDate: e.endDate ? new Date(e.endDate).toISOString() : undefined,
          description: e.description.trim() || undefined,
        })),
    }
  }

  async function saveCurrentStep(draft = false): Promise<boolean> {
    setError(null)
    let result: { ok: boolean; code?: string } | null = null

    if (currentStep === 1) {
      if (!fullName.trim() || !workAuth) {
        setError(t('errorRequired'))
        return false
      }
      result = draft
        ? await saveStep1DraftAction(buildStep1Payload())
        : await saveStep1Action(buildStep1Payload())
    } else if (currentStep === 2) {
      if (intents.length === 0) {
        setError(t('errorAtLeastOneIntent'))
        return false
      }
      result = draft
        ? await saveStep2DraftAction(buildStep2Payload())
        : await saveStep2Action(buildStep2Payload())
    } else if (currentStep === 3) {
      result = draft
        ? await saveStep3DraftAction(buildStep3Payload())
        : await saveStep3Action(buildStep3Payload())
    } else if (currentStep === 4) {
      result = draft
        ? await saveStep4DraftAction(buildStep4Payload())
        : await saveStep4Action(buildStep4Payload())
    } else if (currentStep === 5) {
      const normalized = normalizeContact(contact)
      if (!draft && !Object.values(normalized).some(Boolean)) {
        setError(t('contactRequired'))
        return false
      }
      result = await updateOwnContactAction(normalized)
      if (!result.ok) {
        setError(result.code === 'VALIDATION_ERROR' ? tContact('errorValidation') : t('saveError'))
        return false
      }
      if (!draft) result = await completeOnboardingAction()
    }

    if (result && !result.ok) {
      setError(result.code === 'RESUME_REQUIRED' ? t('resumeRequired')
        : result.code === 'CONTACT_REQUIRED' ? t('contactRequired') : t('saveError'))
      return false
    }
    return true
  }

  function handleNext() {
    startTransition(async () => {
      const ok = await saveCurrentStep(false)
      if (!ok) return
      if (currentStep < TOTAL_STEPS) {
        setCurrentStep(currentStep + 1)
      } else {
        router.push('/s')
      }
    })
  }

  function handlePrevious() {
    setError(null)
    setCurrentStep(currentStep - 1)
  }

  function handleSaveAndExit() {
    startTransition(async () => {
      if (!await saveCurrentStep(true)) return
      router.push('/s')
    })
  }

  // ---- Language helpers ----
  function addLanguage() {
    setLanguages([...languages, { language: '', level: 'CONVERSATIONAL' }])
  }

  function updateLanguage(i: number, field: 'language' | 'level', value: string) {
    setLanguages(languages.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  }

  function removeLanguage(i: number) {
    setLanguages(languages.filter((_, idx) => idx !== i))
  }

  // ---- Education helpers ----
  function addEducation() {
    setEducations([
      ...educations,
      { schoolName: '', degreeLevel: '', major: '', startDate: '', endDate: '', gpa: '', description: '' },
    ])
  }

  function updateEducation(i: number, field: keyof EducationEntry, value: string) {
    setEducations(educations.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)))
  }

  function removeEducation(i: number) {
    setEducations(educations.filter((_, idx) => idx !== i))
  }

  // ---- Experience helpers ----
  function addExperience() {
    setExperiences([
      ...experiences,
      { kind: 'INTERNSHIP', title: '', organization: '', startDate: '', endDate: '', description: '' },
    ])
  }

  function updateExperience(i: number, field: keyof ExperienceEntry, value: string) {
    setExperiences(experiences.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)))
  }

  function removeExperience(i: number) {
    setExperiences(experiences.filter((_, idx) => idx !== i))
  }

  const stepTitles = [t('step1Title'), t('step2Title'), t('step3Title'), t('step4Title'), t('step5Title')]

  return (
    <div className="bg-background">
      <div className="page-shell max-w-2xl py-8 md:py-12">
        {/* Progress header */}
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">
            {t('stepProgress', { current: currentStep, total: TOTAL_STEPS })}
          </p>
          <h1 className="mt-1 text-title">{stepTitles[currentStep - 1]}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('applicationMaterialsHint')}</p>
        </div>

        {/* Error message */}
        {error && (
          <div role="alert" className="mb-4 rounded-control bg-destructive-muted p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Stepper
          step={currentStep}
          linear
          disableStepIndicators
          showFooter={false}
          theme="light"
          frame={false}
          width="100%"
          accentColor="hsl(210 100% 40%)"
          contentClassName="px-1 pb-1 pt-6"
        >
        {/* Step 1 */}
        <Step title={stepTitles[0]}>
          <div className="space-y-5">
            <div>
              <Label htmlFor="fullName">{t('fullNameLabel')} *</Label>
              <Input
                id="fullName"
                name="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t('fullNamePlaceholder')}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="school">{t('schoolLabel')}</Label>
              <Select
                id="school"
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-control border border-input bg-background px-3 py-2 text-sm ring-offset-background outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <option value="">{t('schoolPlaceholder')}</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {locale === 'zh' ? s.nameZh : s.nameEn}
                  </option>
                ))}
                <option value={NO_SCHOOL}>{t('schoolNone')}</option>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="degreeLevel">{t('degreeLevelLabel')}</Label>
                <Select
                  id="degreeLevel"
                  value={degreeLevel}
                  onChange={(e) => setDegreeLevel(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-control border border-input bg-background px-3 py-2 text-sm ring-offset-background outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <option value="">{t('degreeLevelPlaceholder')}</option>
                  <option value="FOUNDATION">{t('degreeLevelFoundation')}</option>
                  <option value="DIPLOMA">{t('degreeLevelDiploma')}</option>
                  <option value="BACHELOR">{t('degreeLevelBachelor')}</option>
                  <option value="MASTER">{t('degreeLevelMaster')}</option>
                  <option value="PHD">{t('degreeLevelPhd')}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="major">{t('majorLabel')}</Label>
                <Input
                  id="major"
                  value={major}
                  onChange={(e) => setMajor(e.target.value)}
                  placeholder={t('majorPlaceholder')}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="graduationYear">{t('graduationYearLabel')}</Label>
                <Input
                  id="graduationYear"
                  type="number"
                  min={2000}
                  max={2040}
                  value={graduationYear}
                  onChange={(e) => setGraduationYear(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="graduationMonth">{t('graduationMonthLabel')}</Label>
                <Input
                  id="graduationMonth"
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
                <Label htmlFor="cgpa">{t('cgpaLabel')}</Label>
                <Input
                  id="cgpa"
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
                <Label htmlFor="nationality">{t('nationalityLabel')}</Label>
                <Input
                  id="nationality"
                  maxLength={2}
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value.toUpperCase())}
                  placeholder={t('nationalityPlaceholder')}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="workAuth">{t('workAuthLabel')} *</Label>
              <Select
                id="workAuth"
                value={workAuth}
                onChange={(e) => setWorkAuth(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-control border border-input bg-background px-3 py-2 text-sm ring-offset-background outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <option value="">{t('workAuthPlaceholder')}</option>
                <option value="MY_CITIZEN">{t('workAuthMyCitizen')}</option>
                <option value="MY_PR">{t('workAuthMyPr')}</option>
                <option value="STUDENT_PASS">{t('workAuthStudentPass')}</option>
                <option value="DEPENDANT_PASS">{t('workAuthDependantPass')}</option>
                <option value="NEEDS_WORK_PASS">{t('workAuthNeedsWorkPass')}</option>
                <option value="OTHER">{t('workAuthOther')}</option>
              </Select>
            </div>
          </div>
        </Step>

        {/* Step 2 */}
        <Step title={stepTitles[1]}>
          <div className="space-y-5">
            <div>
              <Label>{t('intentsLabel')} *</Label>
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
                        ? t('intentInternship')
                        : v === 'FULL_TIME'
                          ? t('intentFullTime')
                          : t('intentPartTime')}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="availableFrom">{t('availableFromLabel')}</Label>
              <Input
                id="availableFrom"
                type="date"
                value={availableFrom}
                onChange={(e) => setAvailableFrom(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <Label>{t('preferredStatesLabel')}</Label>
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
              <Label>{t('preferredIndustriesLabel')}</Label>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {COMMON_INDUSTRIES.map((ind) => (
                  <label key={ind.code} className="flex items-center gap-2 cursor-pointer min-h-[24px]">
                    <input
                      type="checkbox"
                      checked={preferredIndustries.includes(ind.code)}
                      onChange={() =>
                        setPreferredIndustries(toggleArray(preferredIndustries, ind.code))
                      }
                      className="h-4 w-4"
                    />
                    <span className="text-sm">{locale === 'zh' ? ind.nameZh : ind.nameEn}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label>{t('expectedSalaryLabel')}</Label>
              <div className="mt-1 flex gap-2">
                <Input
                  type="number"
                  min={0}
                  value={salaryMin}
                  onChange={(e) => setSalaryMin(e.target.value)}
                  placeholder={t('salaryMinPlaceholder')}
                />
                <Input
                  type="number"
                  min={0}
                  value={salaryMax}
                  onChange={(e) => setSalaryMax(e.target.value)}
                  placeholder={t('salaryMaxPlaceholder')}
                />
              </div>
            </div>
          </div>
        </Step>

        {/* Step 3 */}
        <Step title={stepTitles[2]}>
          <div className="space-y-5">
            <div>
              <Label>{t('languagesLabel')}</Label>
              <div className="mt-2 space-y-2">
                {languages.map((lang, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input
                      value={lang.language}
                      onChange={(e) => updateLanguage(i, 'language', e.target.value)}
                      placeholder={t('languagePlaceholder')}
                      className="flex-1"
                    />
                    <Select
                      value={lang.level}
                      onChange={(e) => updateLanguage(i, 'level', e.target.value)}
                      className="h-10 rounded-control border border-input bg-background px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                    >
                      <option value="BASIC">{t('langLevelBasic')}</option>
                      <option value="CONVERSATIONAL">{t('langLevelConversational')}</option>
                      <option value="FLUENT">{t('langLevelFluent')}</option>
                      <option value="NATIVE">{t('langLevelNative')}</option>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLanguage(i)}
                      aria-label={t('removeLanguage')}
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addLanguage}>
                  + {t('addLanguage')}
                </Button>
              </div>
            </div>

            <div>
              <Label>{t('skillsLabel')}</Label>
              <div className="mt-1 flex flex-wrap gap-1 p-2 border rounded-control min-h-[42px]">
                {skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => setSkills(skills.filter((s) => s !== skill))}
                      className="ml-0.5 text-primary/70 hover:text-primary"
                      aria-label={t('removeSkill', { skill })}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={handleSkillKeyDown}
                  onBlur={() => {
                    const tag = skillInput.trim()
                    if (tag && !skills.includes(tag) && skills.length < 30) setSkills([...skills, tag])
                    setSkillInput('')
                  }}
                  placeholder={skills.length === 0 ? t('skillsPlaceholder') : ''}
                  className="flex-1 min-w-[120px] border-none outline-none bg-transparent text-sm"
                  disabled={skills.length >= 30}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="headline">{t('headlineLabel')}</Label>
              <Input
                id="headline"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder={t('headlinePlaceholder')}
                maxLength={100}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="summary">{t('summaryLabel')}</Label>
              <textarea
                id="summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder={t('summaryPlaceholder')}
                maxLength={2000}
                rows={5}
                className="mt-1 flex w-full rounded-control border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              />
            </div>
          </div>
        </Step>

        {/* Step 4 */}
        <Step title={stepTitles[3]}>
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">{t('skipStep4Hint')}</p>

            {/* Educations */}
            <div>
              <Label>{t('educationsLabel')}</Label>
              <div className="mt-2 space-y-4">
                {educations.map((edu, i) => (
                  <div key={i} className="rounded-control border p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">
                        {edu.schoolName || `#${i + 1}`}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeEducation(i)}
                      >
                        {t('removeEntry')}
                      </Button>
                    </div>
                    <div>
                      <Label className="text-xs">{t('schoolNameLabel')} *</Label>
                      <Input
                        value={edu.schoolName}
                        onChange={(e) => updateEducation(i, 'schoolName', e.target.value)}
                        placeholder={t('schoolNamePlaceholder')}
                        className="mt-1"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">{t('degreeLevelLabel')}</Label>
                        <Select
                          value={edu.degreeLevel}
                          onChange={(e) => updateEducation(i, 'degreeLevel', e.target.value)}
                          className="mt-1 flex h-10 w-full rounded-control border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                        >
                          <option value=""></option>
                          <option value="FOUNDATION">{t('degreeLevelFoundation')}</option>
                          <option value="DIPLOMA">{t('degreeLevelDiploma')}</option>
                          <option value="BACHELOR">{t('degreeLevelBachelor')}</option>
                          <option value="MASTER">{t('degreeLevelMaster')}</option>
                          <option value="PHD">{t('degreeLevelPhd')}</option>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">{t('majorLabel')}</Label>
                        <Input
                          value={edu.major}
                          onChange={(e) => updateEducation(i, 'major', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">{t('startDateLabel')}</Label>
                        <Input
                          type="date"
                          value={edu.startDate}
                          onChange={(e) => updateEducation(i, 'startDate', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">{t('endDateLabel')}</Label>
                        <Input
                          type="date"
                          value={edu.endDate}
                          onChange={(e) => updateEducation(i, 'endDate', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">{t('gpaLabel')}</Label>
                      <Input
                        value={edu.gpa}
                        onChange={(e) => updateEducation(i, 'gpa', e.target.value)}
                        className="mt-1"
                        maxLength={20}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{t('descriptionLabel')}</Label>
                      <textarea
                        value={edu.description}
                        onChange={(e) => updateEducation(i, 'description', e.target.value)}
                        rows={2}
                        maxLength={1000}
                        className="mt-1 flex w-full rounded-control border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                      />
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addEducation}>
                  + {t('addEducation')}
                </Button>
              </div>
            </div>

            {/* Experiences */}
            <div>
              <Label>{t('experiencesLabel')}</Label>
              <div className="mt-2 space-y-4">
                {experiences.map((exp, i) => (
                  <div key={i} className="rounded-control border p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">{exp.title || `#${i + 1}`}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeExperience(i)}
                      >
                        {t('removeEntry')}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">{t('experienceKindLabel')}</Label>
                        <Select
                          value={exp.kind}
                          onChange={(e) => updateExperience(i, 'kind', e.target.value)}
                          className="mt-1 flex h-10 w-full rounded-control border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                        >
                          <option value="INTERNSHIP">{t('kindInternship')}</option>
                          <option value="WORK">{t('kindWork')}</option>
                          <option value="PROJECT">{t('kindProject')}</option>
                          <option value="CAMPUS">{t('kindCampus')}</option>
                          <option value="AWARD">{t('kindAward')}</option>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">{t('entryTitleLabel')} *</Label>
                        <Input
                          value={exp.title}
                          onChange={(e) => updateExperience(i, 'title', e.target.value)}
                          placeholder={t('entryTitlePlaceholder')}
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">{t('organizationLabel')}</Label>
                      <Input
                        value={exp.organization}
                        onChange={(e) => updateExperience(i, 'organization', e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">{t('startDateLabel')}</Label>
                        <Input
                          type="date"
                          value={exp.startDate}
                          onChange={(e) => updateExperience(i, 'startDate', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">{t('endDateLabel')}</Label>
                        <Input
                          type="date"
                          value={exp.endDate}
                          onChange={(e) => updateExperience(i, 'endDate', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">{t('descriptionLabel')}</Label>
                      <textarea
                        value={exp.description}
                        onChange={(e) => updateExperience(i, 'description', e.target.value)}
                        rows={2}
                        maxLength={1000}
                        className="mt-1 flex w-full rounded-control border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                      />
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addExperience}>
                  + {t('addExperience')}
                </Button>
              </div>
            </div>
          </div>
        </Step>
        <Step title={stepTitles[4]}>
          <div className="space-y-8">
            <section aria-labelledby="onboarding-contact-title" className="space-y-4">
              <h2 id="onboarding-contact-title" className="font-semibold">{t('contactSectionTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('contactRequired')}</p>
              <div className="rounded-control bg-brand-muted p-4 text-sm text-brand-muted-foreground">
                {tContact('privacyNotice')}
              </div>
              <ContactFields value={contact} onChange={setContact} disabled={isPending} />
            </section>
            <section aria-labelledby="onboarding-resume-title" className="space-y-4 border-t pt-6">
              <h2 id="onboarding-resume-title" className="font-semibold">{tResume('title')}</h2>
              <ResumeManager resumes={resumes} locale={locale} onBusyChange={setResumeBusy} onRefresh={refreshResumes} disabled={isPending} />
            </section>
          </div>
        </Step>
        </Stepper>

        {/* Navigation */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={handleSaveAndExit}
            disabled={isPending || resumeBusy}
          >
            {isPending ? t('saving') : t('saveAndExit')}
          </Button>

          <div className="flex gap-3">
            {currentStep > 1 && (
              <Button
                type="button"
                variant="outline"
                onClick={handlePrevious}
                disabled={isPending || resumeBusy}
              >
                {t('previous')}
              </Button>
            )}
            <Button type="button" variant="brand" onClick={handleNext} disabled={isPending || resumeBusy}>
              {isPending
                ? t('saving')
                : currentStep < TOTAL_STEPS
                  ? t('next')
                  : t('finish')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
