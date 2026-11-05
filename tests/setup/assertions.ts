import { beforeEach, expect } from 'vitest'

// 每条测试至少要执行一个断言，否则直接失败。M1-T11 复审发现过 `if (!x) return` 这种一条断言都没跑就「通过」的测试。
// 确实不需要断言的测试，在测试里写 `expect.assertions(0)`，并用注释说明原因。
beforeEach(() => {
  expect.hasAssertions()
})
