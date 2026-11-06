import { randomBytes } from 'node:crypto'

// E2E 注册的测试学生用的密码：每次运行随机生成，不写死在源码里（M4-T15 第 1 条同样的要求）。
// 满足 8–128 位的密码规则；一个 worker 进程内是同一个值，同一用例里注册和登录能对上
export const E2E_PASSWORD = `E2e-${randomBytes(12).toString('base64url')}-9a`
