import { fireEvent, render, screen } from '@testing-library/react-native'
import { Text } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Button, Card, Chip, EmptyState, TextField, ToastProvider, useToast } from '@/components/ui'

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }
const wrap = (ui: React.ReactElement) => render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>)

describe('Button', () => {
  it('meets the 48dp touch target and fires onPress', async () => {
    const onPress = jest.fn()
    await wrap(<Button label="投递" onPress={onPress} />)
    const btn = screen.getByRole('button', { name: '投递' })
    expect(btn).toHaveStyle({ minHeight: 48 })
    fireEvent.press(btn)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('is disabled and busy while loading', async () => {
    const onPress = jest.fn()
    await wrap(<Button label="提交" loading onPress={onPress} />)
    const btn = screen.getByRole('button', { name: '提交' })
    expect(btn).toBeDisabled()
    expect(btn).toBeBusy()
    fireEvent.press(btn)
    expect(onPress).not.toHaveBeenCalled()
  })
})

describe('Chip and Card', () => {
  it('exposes the checked state of a selectable chip', async () => {
    await wrap(<Chip label="实习" selected onPress={() => {}} />)
    expect(screen.getByRole('checkbox', { name: '实习' })).toBeChecked()
  })

  it('a pressable card is one accessible button', async () => {
    const onPress = jest.fn()
    await wrap(
      <Card onPress={onPress} accessibilityLabel="前端实习生，吉隆坡">
        <Text>前端实习生</Text>
      </Card>,
    )
    fireEvent.press(screen.getByRole('button', { name: '前端实习生，吉隆坡' }))
    expect(onPress).toHaveBeenCalled()
  })
})

describe('TextField', () => {
  it('labels the input and announces errors', async () => {
    await wrap(<TextField label="邮箱" error="邮箱格式不对" />)
    const input = screen.getByLabelText('邮箱')
    expect(input).toHaveStyle({ minHeight: 48, fontSize: 16 })
    expect(screen.getByText('邮箱格式不对')).toBeOnTheScreen()
  })
})

describe('EmptyState', () => {
  it('renders title and body', async () => {
    await wrap(<EmptyState title="还没有投递" body="去职位页看看吧" />)
    expect(screen.getByText('还没有投递')).toBeOnTheScreen()
    expect(screen.getByText('去职位页看看吧')).toBeOnTheScreen()
  })
})

describe('Toast', () => {
  function Trigger() {
    const toast = useToast()
    return <Button label="go" onPress={() => toast('已保存')} />
  }
  it('shows a live-region message', async () => {
    await wrap(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    )
    await fireEvent.press(screen.getByRole('button', { name: 'go' }))
    expect(screen.getByRole('alert')).toHaveTextContent('已保存')
  })
})
