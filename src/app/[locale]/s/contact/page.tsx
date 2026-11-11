import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { getOwnContact } from '@/server/services/contact-access'
import ContactForm from '@/components/contact/ContactForm'
import { WorkspacePage } from '@/components/layout/workspace-page'

export default async function ContactPage() {
  const t = await getTranslations('contact')
  const { userId } = await requireStudent(await headers())
  const contact = await getOwnContact({ userId })

  return (
    <WorkspacePage title={t('title')} lead={t('subtitle')}>
      <ContactForm initial={contact} />
    </WorkspacePage>
  )
}
