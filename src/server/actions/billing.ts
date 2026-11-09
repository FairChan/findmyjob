'use server'

import { action } from '@/server/action'
import { startStripeCheckout, startStripeCheckoutSchema } from '@/server/services/stripe-payments'
import {
  quoteOrder, quoteOrderSchema, createOrder, createOrderSchema,
  attachBankProof, attachBankProofSchema, cancelPendingOrder, cancelPendingOrderSchema,
  confirmBankOrder, confirmBankOrderSchema,
} from '@/server/services/billing'

export const quoteOrderAction = action(
  { auth: { type: 'company', minRole: 'OWNER' }, input: quoteOrderSchema },
  async ctx => quoteOrder({ userId: ctx.userId!, companyId: ctx.companyId!, role: ctx.companyRole! }, ctx.input),
)

export const startStripeCheckoutAction = action(
  { auth: { type: 'company', minRole: 'OWNER' }, input: startStripeCheckoutSchema },
  async ctx => startStripeCheckout({ userId: ctx.userId!, companyId: ctx.companyId!, role: ctx.companyRole! }, ctx.input),
)

export const createOrderAction = action(
  { auth: { type: 'company', minRole: 'OWNER' }, input: createOrderSchema },
  async ctx => createOrder({ userId: ctx.userId!, companyId: ctx.companyId!, role: ctx.companyRole! }, ctx.input),
)

export const attachBankProofAction = action(
  { auth: { type: 'company', minRole: 'OWNER' }, input: attachBankProofSchema },
  async ctx => attachBankProof({ userId: ctx.userId!, companyId: ctx.companyId!, role: ctx.companyRole! }, ctx.input),
)

export const cancelPendingOrderAction = action(
  { auth: { type: 'company', minRole: 'OWNER' }, input: cancelPendingOrderSchema },
  async ctx => cancelPendingOrder({ userId: ctx.userId!, companyId: ctx.companyId!, role: ctx.companyRole! }, ctx.input),
)

export const confirmBankOrderAction = action(
  { auth: 'admin-fresh', input: confirmBankOrderSchema },
  async ctx => confirmBankOrder({ userId: ctx.userId! }, ctx.input),
)
