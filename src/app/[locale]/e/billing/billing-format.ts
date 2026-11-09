export function formatMoney(amountSen: number): string {
  return 'MYR ' + (amountSen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function orderStatusKey(status: string) {
  switch (status) {
    case 'PENDING': return 'pending'
    case 'AWAITING_CONFIRMATION': return 'awaiting'
    case 'PAID': return 'paid'
    case 'CANCELLED': return 'cancelledStatus'
    case 'REFUNDED': return 'refunded'
    default: return 'unknownStatus'
  }
}
