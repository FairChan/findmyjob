const KL_OFFSET_MS = 8 * 60 * 60 * 1000

/** Malaysia has a fixed UTC+8 offset and no daylight-saving transition. */
export function klMonthBounds(now: Date): { start: Date; end: Date } {
  const local = new Date(now.getTime() + KL_OFFSET_MS)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth()
  return {
    start: new Date(Date.UTC(year, month, 1) - KL_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - KL_OFFSET_MS),
  }
}
