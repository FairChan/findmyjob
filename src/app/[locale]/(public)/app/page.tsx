import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/ui/page-header'
import { BrandLine } from '@/components/layout/brand-line'
import { Link } from '@/i18n/navigation'

interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'appDownload' })
  return { title: t('title'), description: t('lead') }
}

// 安装包地址只接受 https，校验值只接受 64 位十六进制；不合法就当作还没发布
function apkRelease(): { url: string; sha256: string } | null {
  const url = process.env.ANDROID_APK_URL?.trim() ?? ''
  const sha256 = process.env.ANDROID_APK_SHA256?.trim().toLowerCase() ?? ''
  if (!/^https:\/\/\S+\.apk$/i.test(url) || !/^[0-9a-f]{64}$/.test(sha256)) return null
  return { url, sha256 }
}

/**
 * Android App 下载与账号删除说明（MA5-H01）。App 的"需要更新"页链到这里；
 * Google Play 要求的"网页上的账号删除说明"也用这一页的 #delete-account。
 */
export default async function AppDownloadPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'appDownload' })
  const apk = apkRelease()
  return (
    <div className="page-shell space-y-12 pb-20 pt-10 md:pt-14">
      <PageHeader eyebrow={<BrandLine word="right" />} title={t('title')} lead={t('lead')} />

      <section aria-labelledby="download" className="space-y-4">
        <h2 id="download" className="text-title">{t('downloadTitle')}</h2>
        <ul className="space-y-3 text-body">
          <li>{t('playStore')}</li>
          <li>
            {apk ? (
              <>
                <a className="font-medium text-brand underline-offset-4 hover:underline" href={apk.url} rel="noopener">
                  {t('apkDownload')}
                </a>
                <p className="mt-2 text-sm text-muted-foreground">{t('apkChecksum')}</p>
                <code className="mt-1 block break-all rounded-control bg-muted p-3 text-xs">{apk.sha256}</code>
              </>
            ) : (
              t('apkSoon')
            )}
          </li>
        </ul>
        <p className="text-sm text-muted-foreground">{t('requirements')}</p>
        <p className="text-sm text-muted-foreground">{t('apkWarning')}</p>
      </section>

      <section aria-labelledby="delete-account" id="delete-account" className="space-y-4">
        <h2 id="delete-account-title" className="text-title">{t('deleteTitle')}</h2>
        <ol className="list-decimal space-y-2 pl-6 text-body">
          <li>{t('deleteInApp')}</li>
          <li>
            {t('deleteOnWeb')}{' '}
            <Link className="font-medium text-brand underline-offset-4 hover:underline" href="/s/privacy" prefetch={false}>
              {t('deleteOnWebLink')}
            </Link>
          </li>
        </ol>
        <p className="text-body text-muted-foreground">{t('deleteWhat')}</p>
        <p className="text-body text-muted-foreground">
          {t('deleteMore')}{' '}
          <Link className="font-medium text-brand underline-offset-4 hover:underline" href="/legal/privacy">
            {t('privacyLink')}
          </Link>
        </p>
      </section>
    </div>
  )
}
