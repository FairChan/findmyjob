import { route } from '@/server/route'
import { AppError } from '@/server/errors'
import Stripe from 'stripe'
import { env } from '@/env'
import { handleStripeWebhook } from '@/server/services/stripe-payments'

export const runtime = 'nodejs'

export const POST = route({ auth: 'public', skipOriginCheck: true }, async req => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new AppError('Payment processing is unavailable', 'PAYMENT_UNAVAILABLE', 503)
  }
  const signature = req.headers.get('stripe-signature')
  if (!signature) throw new AppError('Invalid payment signature', 'PAYMENT_REJECTED', 400)
  let event: Stripe.Event
  try {
    // Do not give the wrapper an input schema: parsing before HMAC changes bytes.
    const raw = await req.text()
    event = Stripe.webhooks.constructEvent(raw, signature, env.STRIPE_WEBHOOK_SECRET)
  } catch {
    throw new AppError('Invalid payment signature', 'PAYMENT_REJECTED', 400)
  }
  try {
    await handleStripeWebhook(event)
  } catch (error) {
    // Provider/DB messages may contain payment details. Never pass them to the wrapper.
    if (error instanceof AppError && error.code === 'PAYMENT_REJECTED' && error.httpStatus === 400) {
      throw new AppError('Payment event rejected', 'PAYMENT_REJECTED', 400)
    }
    throw new AppError('Payment processing is unavailable', 'PAYMENT_UNAVAILABLE', 503)
  }
  return Response.json({ ok: true })
})
