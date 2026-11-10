import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { getOwnContact } from '@/server/services/contact-access'
import ContactForm from '@/components/contact/ContactForm'

export default async function ContactPage() {
  const t = await getTranslations('contact')
  const { userId } = await requireStudent(await headers())
  const contact = await getOwnContact({ userId })

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">{t('title')}</h1>
      <p className="mb-8 text-sm text-muted-foreground">{t('subtitle')}</p>
      <ContactForm initial={contact} />
    </div>
  )
}
