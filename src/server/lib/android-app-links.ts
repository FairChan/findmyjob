import 'server-only'

const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/
const FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/

type Statement = {
  relation: ['delegate_permission/common.handle_all_urls']
  target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] }
}

/**
 * ANDROID_APP_LINKS 的格式：`包名=指纹1|指纹2,包名2=指纹`，指纹是大写冒号分隔的 SHA-256
 * （Play App Signing 证书和上传证书都要写）。格式不对的项直接丢弃，绝不输出半截声明。
 */
export function androidAssetLinks(raw: string | undefined): Statement[] {
  if (!raw) return []
  const out: Statement[] = []
  for (const entry of raw.split(',')) {
    const [pkg, prints] = entry.split('=').map((s) => s?.trim() ?? '')
    if (!pkg || !PACKAGE_RE.test(pkg) || !prints) continue
    const fingerprints = prints.split('|').map((p) => p.trim().toUpperCase()).filter((p) => FINGERPRINT_RE.test(p))
    if (fingerprints.length === 0) continue
    out.push({
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints },
    })
  }
  return out
}
