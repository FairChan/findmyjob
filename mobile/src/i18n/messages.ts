// 中英文案直接取 Web 的 messages/*.json，两端同一份。
// App 专用的新文案放在 mobile.* 命名空间（MA2-T03），同样写进这两个文件。
import en from '@messages/en.json'
import zh from '@messages/zh.json'

export const LOCALES = ['zh', 'en'] as const
export type AppLocale = (typeof LOCALES)[number]

export const MESSAGES: Record<AppLocale, typeof zh> = { zh, en: en as typeof zh }

export function resolveLocale(tag: string | null | undefined): AppLocale {
  return tag?.toLowerCase().startsWith('en') ? 'en' : 'zh'
}
