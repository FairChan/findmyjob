import { fireEvent, screen, waitFor } from '@testing-library/react-native'

import Onboarding from '../app/onboarding'
import SchoolVerification from '../app/school-verification'
import { emailMatchesSchool } from '@/features/school/api'
import { ApiError } from '@/lib/api-client'
import { apiCalls, callsTo, resetApi, route } from './helpers/api-mock'
import { completeness, ids, profile, schools } from './helpers/fixtures'
import { renderScreen } from './helpers/render'
import { mockRouter, preventRemove, resetRouter } from './helpers/router-mock'

jest.mock('@/lib/api-client', () => jest.requireActual('./helpers/api-mock').apiClientMock())
jest.mock('expo-router', () => jest.requireActual('./helpers/router-mock').expoRouterMock())
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))

beforeEach(() => {
  resetApi()
  resetRouter()
  route('GET /profile', profile)
  route('GET /schools', schools)
  route('GET /profile/completeness', completeness())
  route('PUT /profile/basic', {})
  route('PUT /profile/preferences', {})
  route('PUT /profile/skills', {})
})

describe('S05 onboarding stepper', () => {
  it('saves each step through the section endpoints and ends on the materials step', async () => {
    await renderScreen(<Onboarding />)
    expect(await screen.findByTestId('onboarding-step-1')).toHaveTextContent('基本信息')
    await fireEvent.press(screen.getByTestId('onboarding-next'))
    expect(await screen.findByTestId('onboarding-step-2')).toBeOnTheScreen()
    expect(callsTo('PUT', '/profile/basic')[0]?.body).toMatchObject({ fullName: '李同学', schoolId: ids.school, workAuth: 'STUDENT_PASS', cgpa: 3.5, nationality: 'CN' })

    await fireEvent.press(screen.getByTestId('onboarding-next'))
    expect(await screen.findByTestId('onboarding-step-3')).toBeOnTheScreen()
    expect(callsTo('PUT', '/profile/preferences')[0]?.body).toMatchObject({ intents: ['INTERNSHIP'], preferredStates: ['KUL'], availableFrom: null })

    await fireEvent.press(screen.getByTestId('onboarding-skip'))
    expect(await screen.findByTestId('onboarding-step-4')).toBeOnTheScreen()
    expect(callsTo('PUT', '/profile/skills')).toHaveLength(0)
    await fireEvent.press(screen.getByTestId('onboarding-resume'))
    expect(mockRouter.push).toHaveBeenCalledWith('/resumes')
  })

  it('validates locally before calling the API and guards unsaved edits on back', async () => {
    await renderScreen(<Onboarding />)
    const name = await screen.findByTestId('field-fullName')
    await fireEvent.changeText(name, '  ')
    expect(preventRemove.enabled).toBe(true)
    await fireEvent.press(screen.getByTestId('onboarding-next'))
    expect(await screen.findByText('此项为必填')).toBeOnTheScreen()
    expect(callsTo('PUT', '/profile/basic')).toHaveLength(0)
  })

  it('requires at least one job type on the preferences step', async () => {
    route('GET /profile', { ...profile, onboardingStep: 2, intents: [] })
    await renderScreen(<Onboarding />)
    expect(await screen.findByTestId('onboarding-step-2')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('onboarding-next'))
    expect(await screen.findByText('请至少选择一种求职类型')).toBeOnTheScreen()
    await fireEvent.press(screen.getByRole('checkbox', { name: '全职' }))
    await fireEvent.press(screen.getByTestId('onboarding-next'))
    await waitFor(() => expect(callsTo('PUT', '/profile/preferences')[0]?.body).toMatchObject({ intents: ['FULL_TIME'] }))
  })

  it('shows a retryable error when the profile cannot load', async () => {
    route('GET /profile', () => {
      throw new ApiError('NETWORK_ERROR', 0)
    })
    await renderScreen(<Onboarding />, { locale: 'en' })
    expect(await screen.findByTestId('error-state')).toHaveTextContent(/Network/i)
  })
})

describe('S06 school verification', () => {
  it('matches the school email domain exactly, like the server', () => {
    expect(emailMatchesSchool('A@Example.edu.my', ['example.edu.my'])).toBe(true)
    expect(emailMatchesSchool('a@cs.example.edu.my', ['example.edu.my'])).toBe(false)
    expect(emailMatchesSchool('example.edu.my', ['example.edu.my'])).toBe(false)
  })

  it('rejects a mismatched domain without calling the API, then sends and confirms the code', async () => {
    route('POST /school-verification/send', {})
    route('POST /school-verification/confirm', {})
    await renderScreen(<SchoolVerification />)
    const email = await screen.findByTestId('school-email')
    await fireEvent.changeText(email, 'li@gmail.com')
    await fireEvent.press(screen.getByTestId('school-send'))
    expect(await screen.findByTestId('school-error')).toHaveTextContent(/邮箱后缀与所选学校不符/)
    expect(callsTo('POST', '/school-verification/send')).toHaveLength(0)

    await fireEvent.changeText(email, 'li@example.edu.my')
    await fireEvent.press(screen.getByTestId('school-send'))
    const otp = await screen.findByTestId('school-otp')
    expect(callsTo('POST', '/school-verification/send')[0]?.body).toEqual({ schoolId: ids.school, schoolEmail: 'li@example.edu.my' })
    await fireEvent.changeText(otp, '12a3456')
    await fireEvent.press(screen.getByTestId('school-confirm'))
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled())
    expect(callsTo('POST', '/school-verification/confirm')[0]?.body).toEqual({ otp: '123456' })
  })

  it('maps a rejected code to the school-specific message', async () => {
    route('POST /school-verification/send', {})
    route('POST /school-verification/confirm', () => {
      throw new ApiError('VALIDATION_ERROR', 400)
    })
    await renderScreen(<SchoolVerification />, { locale: 'en' })
    await fireEvent.changeText(await screen.findByTestId('school-email'), 'li@example.edu.my')
    await fireEvent.press(screen.getByTestId('school-send'))
    await fireEvent.changeText(await screen.findByTestId('school-otp'), '000000')
    await fireEvent.press(screen.getByTestId('school-confirm'))
    expect(await screen.findByTestId('school-error')).toHaveTextContent(/The code is wrong or has expired/)
  })

  it('shows the verified state with a way to change email', async () => {
    route('GET /profile/completeness', completeness({ schoolVerified: true }))
    await renderScreen(<SchoolVerification />)
    expect(await screen.findByTestId('school-verified')).toBeOnTheScreen()
    expect(apiCalls.some((c) => c.method === 'POST')).toBe(false)
  })
})
