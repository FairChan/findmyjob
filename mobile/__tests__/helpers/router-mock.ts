// expo-router 的测试替身：记录跳转，参数由测试设置
export const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  dismissAll: jest.fn(),
}
export const routeParams: { current: Record<string, string> } = { current: {} }
export const preventRemove = { enabled: false }

export function resetRouter() {
  Object.values(mockRouter).forEach((f) => f.mockClear())
  routeParams.current = {}
  preventRemove.enabled = false
}

export function expoRouterMock() {
  return {
    useRouter: () => mockRouter,
    router: mockRouter,
    useLocalSearchParams: () => routeParams.current,
    useNavigation: () => ({ dispatch: jest.fn(), setOptions: jest.fn() }),
    usePreventRemove: (enabled: boolean) => {
      preventRemove.enabled = enabled
    },
    // 测试里页面挂载即"聚焦"：和真实导航一样执行回调，卸载时执行清理
    useFocusEffect: (cb: () => void | (() => void)) => (jest.requireActual('react') as typeof import('react')).useEffect(cb, [cb]),
    Redirect: () => null,
    Link: ({ children }: { children: unknown }) => children,
  }
}
