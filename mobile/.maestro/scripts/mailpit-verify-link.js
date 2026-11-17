// 从本机 Mailpit（ergo 环境，模拟器里经 10.0.2.2 访问）取最新一封发给 NEW_EMAIL 的验证邮件，
// 把邮件里的验证链接交给流程打开。只用于 dev 环境的合成账号。
var base = MAILPIT_URL || 'http://10.0.2.2:8025'
var list = json(http.get(base + '/api/v1/search?query=' + encodeURIComponent('to:' + NEW_EMAIL)).body)
if (!list.messages || list.messages.length === 0) throw new Error('no verification email for ' + NEW_EMAIL)
var msg = json(http.get(base + '/api/v1/message/' + list.messages[0].ID).body)
var m = /https?:\/\/[^\s"'<>]+verify-email[^\s"'<>]*/.exec(msg.Text || msg.HTML || '')
if (!m) throw new Error('verification link not found')
output.verifyUrl = m[0].replace(/&amp;/g, '&')
