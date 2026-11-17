import { render, screen } from '@testing-library/react-native'

import Index from '../app/index'

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.1.0', extra: { variant: 'staging' } } },
}))

describe('Index', () => {
  it('shows wordmark and build info', async () => {
    await render(<Index />)
    expect(screen.getByRole('header')).toHaveTextContent('FindMYJob')
    expect(screen.getByTestId('build-info')).toHaveTextContent('staging · 0.1.0')
  })
})
