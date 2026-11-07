import { z } from 'zod'

export const purposeSchema = z.enum(['RESUME', 'VERIFICATION', 'PAYMENT_PROOF', 'LOGO'])

export const idSchema = z.string().cuid()

export type UploadPurpose = z.infer<typeof purposeSchema>

// C0 control chars (U+0000–U+001F), DEL (U+007F), C1 control chars (U+0080–U+009F),
// bidi override/isolate/mark chars (U+200E, U+200F, U+061C, U+202A–U+202E, U+2066–U+2069)
const STRIP_RE =
  /[\u0000-\u001f\u007f\u0080-\u009f‎‏؜‪-‮⁦-⁩]/g

const fileNameSchema = z.string().trim().min(1).max(255)

/** Strip control / bidi chars then validate with zod. */
export function validateFileName(raw: string): { ok: true; name: string } | { ok: false } {
  const stripped = raw.replace(STRIP_RE, '')
  const result = fileNameSchema.safeParse(stripped)
  if (!result.success) return { ok: false }
  return { ok: true, name: result.data }
}
