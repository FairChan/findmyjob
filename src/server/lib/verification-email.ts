// Registration verification email. Bilingual because the account's language is not known
// reliably at sign-up time; states the expiry so a late click is not a surprise.

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function verificationEmailContent(url: string): { subject: string; html: string; text: string } {
  const href = escapeAttribute(url)
  return {
    subject: '验证你的 FindMYJob 邮箱 / Verify your FindMYJob email',
    html: [
      '<p>你好！请点击下方链接完成 FindMYJob 注册。链接 1 小时内有效；过期后可在登录页重新发送。</p>',
      `<p><a href="${href}">验证邮箱 / Verify email</a></p>`,
      '<p>Hello! Click the link above to finish signing up for FindMYJob. It is valid for 1 hour; if it expires, you can resend it from the sign-in page.</p>',
      '<p>如果不是你本人注册，请忽略这封邮件。 / If you did not sign up, you can ignore this email.</p>',
    ].join('\n'),
    text: [
      '请打开以下链接完成 FindMYJob 注册（1 小时内有效）：',
      'Open this link to finish signing up for FindMYJob (valid for 1 hour):',
      url,
      '',
      '如果不是你本人注册，请忽略这封邮件。 / If you did not sign up, you can ignore this email.',
    ].join('\n'),
  }
}
