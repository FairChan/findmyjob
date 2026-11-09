'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { EntitlementLimitNotice } from '@/components/billing/entitlement-limit-notice'
import type { TeamMember } from '@/server/services/team'
import {
  inviteMemberAction,
  removeMemberAction,
  changeRoleAction,
} from '@/server/actions/team'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Props {
  canPurchase?: boolean
  members: TeamMember[]
  currentUserId: string
  currentRole: 'OWNER' | 'ADMIN' | 'RECRUITER'
  t: {
    invite: string
    emailLabel: string
    emailPlaceholder: string
    roleLabel: string
    roleAdmin: string
    roleRecruiter: string
    inviteSubmit: string
    inviteSent: string
    memberName: string
    memberEmail: string
    memberRole: string
    roleOwner: string
    removeButton: string
    changeRoleButton: string
    confirmRemove: string
    cancelButton: string
    errorForbidden: string
    errorLimitReached: string
    errorAlreadyMember: string
    errorUnknown: string
  }
}

export default function TeamPageClient({ members: initialMembers, currentUserId, currentRole, t, canPurchase = false }: Props) {
  const router = useRouter()
  const [members, setMembers] = useState(initialMembers)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'RECRUITER'>('RECRUITER')
  const [inviteError, setInviteError] = useState('')
  const [seatLimitReached, setSeatLimitReached] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  const canManage = currentRole === 'OWNER' || currentRole === 'ADMIN'
  const canChangeRole = currentRole === 'OWNER'

  function mapError(code: string): string {
    if (code === 'FORBIDDEN') return t.errorForbidden
    return t.errorUnknown
  }

  function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail) return
    setInviteError('')
    setSeatLimitReached(false)
    setInviteSuccess(false)
    startTransition(async () => {
      const res = await inviteMemberAction({ email: inviteEmail, role: inviteRole })
      if (res.ok) {
        setInviteSuccess(true)
        setInviteEmail('')
        router.refresh()
      } else {
        if (res.code === 'SEAT_LIMIT_EXCEEDED') setSeatLimitReached(true)
        else setInviteError(mapError(res.code))
      }
    })
  }

  function handleRemove(memberId: string) {
    setConfirmRemoveId(memberId)
  }

  function handleRemoveConfirmed() {
    const memberId = confirmRemoveId
    setConfirmRemoveId(null)
    if (!memberId) return
    startTransition(async () => {
      const res = await removeMemberAction({ memberId })
      if (res.ok) {
        setMembers(prev => prev.filter(m => m.id !== memberId))
        router.refresh()
      }
    })
  }

  function handleChangeRole(memberId: string, role: 'ADMIN' | 'RECRUITER') {
    startTransition(async () => {
      const res = await changeRoleAction({ memberId, role })
      if (res.ok) {
        setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role } : m))
      }
    })
  }

  function roleLabel(role: string) {
    if (role === 'OWNER') return t.roleOwner
    if (role === 'ADMIN') return t.roleAdmin
    return t.roleRecruiter
  }

  return (
    <div>
      <Dialog open={confirmRemoveId !== null} onOpenChange={open => { if (!open) setConfirmRemoveId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.confirmRemove}</DialogTitle>
            <DialogDescription>{t.confirmRemove}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemoveId(null)}>{t.cancelButton}</Button>
            <Button variant="destructive" onClick={handleRemoveConfirmed}>{t.removeButton}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Member list */}
      <div className="mb-8 overflow-x-auto rounded-lg border">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">{t.memberName}</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">{t.memberEmail}</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">{t.memberRole}</th>
              {canManage && <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {members.map(member => (
              <tr key={member.id}>
                <td className="px-4 py-3 text-sm">{member.name}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{member.email}</td>
                <td className="px-4 py-3 text-sm">
                  {canChangeRole && member.role !== 'OWNER' ? (
                    <select
                      value={member.role}
                      onChange={e => handleChangeRole(member.id, e.target.value as 'ADMIN' | 'RECRUITER')}
                      disabled={isPending}
                      aria-label={t.changeRoleButton}
                      className="rounded border border-border bg-background px-2 py-1 text-sm"
                    >
                      <option value="ADMIN">{t.roleAdmin}</option>
                      <option value="RECRUITER">{t.roleRecruiter}</option>
                    </select>
                  ) : (
                    <span>{roleLabel(member.role)}</span>
                  )}
                </td>
                {canManage && (
                  <td className="px-4 py-3 text-right text-sm">
                    {member.role !== 'OWNER' && member.userId !== currentUserId && (
                      <button
                        onClick={() => handleRemove(member.id)}
                        disabled={isPending}
                        className="text-destructive hover:underline disabled:opacity-50"
                      >
                        {t.removeButton}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Invite form (OWNER/ADMIN only) */}
      {canManage && (
        <div className="rounded-lg border p-4">
          <h2 className="mb-4 text-lg font-semibold">{t.invite}</h2>
          <form onSubmit={handleInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium">{t.emailLabel}</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder={t.emailPlaceholder}
                required
                maxLength={255}
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="invite-role" className="mb-1 block text-sm font-medium">{t.roleLabel}</label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as 'ADMIN' | 'RECRUITER')}
                className="rounded border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="RECRUITER">{t.roleRecruiter}</option>
                <option value="ADMIN">{t.roleAdmin}</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-brand px-4 py-2 text-sm text-white hover:bg-brand-hover disabled:opacity-50"
            >
              {t.inviteSubmit}
            </button>
          </form>
          {inviteSuccess && (
            <p className="mt-2 text-sm text-green-600">{t.inviteSent}</p>
          )}
          {inviteError && (
            <p role="alert" className="mt-2 text-sm text-destructive">{inviteError}</p>
          )}
          {seatLimitReached && <EntitlementLimitNotice resource="seats" canPurchase={canPurchase && currentRole === 'OWNER'} />}
        </div>
      )}
    </div>
  )
}
