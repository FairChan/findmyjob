import { render, screen } from '@testing-library/react-native'

import Index from '../app/index'
import { AppIntlProvider } from '@/i18n/provider'

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.1.0', extra: { variant: 'staging' } } },
}))

describe('Index', () => {
  it.each([
    ['zh', '找到我的 对口 工作'],
    ['en', 'Finding my right Job'],
  ] as const)('shows wordmark, brand line (%s) and build info', async (locale, line) => {
    await render(
      <AppIntlProvider locale={locale}>
        <Index />
      </AppIntlProvider>,
    )
    expect(screen.getByRole('header')).toHaveTextContent('FindMYJob')
    expect(screen.getByTestId('brand-line')).toHaveTextContent(line)
    expect(screen.getByTestId('build-info')).toHaveTextContent('staging · 0.1.0')
  })
})
