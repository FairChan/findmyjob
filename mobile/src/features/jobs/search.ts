import { useEffect, useState } from 'react'

const CJK = /[㐀-鿿豈-﫿]/
const TRAILING_LATIN = /[a-z']+$/i

/**
 * Android 的 TextInput 没有 compositionstart/end 事件（对应 Web 的 isImeComposing）。
 * 部分中文输入法会把正在组字的拼音直接写进输入框（如"前端gongc"），这时不该触发搜索：
 * 已经有汉字、末尾又是一串拉丁字母，就当作还在组字，等用户选完字或按搜索键。
 * 纯英文关键词（"react native"）不受影响。
 */
export function looksLikeImeComposing(text: string): boolean {
  return CJK.test(text) && TRAILING_LATIN.test(text)
}

/**
 * 输入停顿 ms 毫秒后才把值交给搜索；组字中不交。
 * 第二个返回值 flush 给"按下搜索键"用：输入法提交动作之后文字已经上屏，立即生效。
 */
export function useSettledSearch(text: string, ms = 500): [string, (now: string) => void] {
  const [settled, setSettled] = useState(text)
  useEffect(() => {
    if (looksLikeImeComposing(text)) return
    const timer = setTimeout(() => setSettled(text), ms)
    return () => clearTimeout(timer)
  }, [text, ms])
  return [settled, setSettled]
}
