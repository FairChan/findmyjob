import { render } from '@testing-library/react-native'
import * as ScreenCapture from 'expo-screen-capture'
import { Text } from 'react-native'

import { useSecureScreen } from '@/lib/secure-screen'

jest.mock('expo-router', () => jest.requireActual('./helpers/router-mock').expoRouterMock())
jest.mock('expo-screen-capture', () => ({ preventScreenCaptureAsync: jest.fn(async () => {}), allowScreenCaptureAsync: jest.fn(async () => {}) }))

function Secure({ id }: { id: string }) {
  useSecureScreen(`candidate-${id}`)
  return <Text>secret</Text>
}

describe('useSecureScreen (FLAG_SECURE)', () => {
  it('blocks screen capture while focused and releases its own key when leaving', async () => {
    const { unmount } = await render(<Secure id="a" />)
    expect(ScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith('candidate-a')
    expect(ScreenCapture.allowScreenCaptureAsync).not.toHaveBeenCalled()
    await unmount()
    expect(ScreenCapture.allowScreenCaptureAsync).toHaveBeenCalledWith('candidate-a')
  })

  it('keeps working when the native module is unavailable', async () => {
    ;(ScreenCapture.preventScreenCaptureAsync as jest.Mock).mockRejectedValueOnce(new Error('unavailable'))
    await expect(render(<Secure id="b" />)).resolves.toBeTruthy()
  })
})
