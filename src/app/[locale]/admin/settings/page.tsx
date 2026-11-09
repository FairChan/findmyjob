import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { getAllSettings } from '@/server/services/admin-settings'
import { SettingsForm } from './settings-form'
import { BankTransferForm } from './bank-transfer-form'
import { bankTransferSettingsSchema, EMPTY_BANK_TRANSFER } from '@/server/lib/billing-settings'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminSettings')
  const settings = await getAllSettings(ctx)
  const bank = bankTransferSettingsSchema.safeParse(settings.find(setting => setting.key === 'billing.bankTransfer')?.currentValue)
  const scalarSettings = settings.filter(setting => !['billing.bankTransfer', 'billing.foundingOffer'].includes(setting.key))

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>
      <BankTransferForm initialValue={bank.success ? bank.data : EMPTY_BANK_TRANSFER} />
      <SettingsForm settings={scalarSettings} />
    </div>
  )
}
