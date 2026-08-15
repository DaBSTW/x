'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatActionLabel } from '@/lib/format'
import { useApplyModerationAction } from '@/lib/use-moderation-queue'
import type { ModerationActionType, ModerationTargetType } from '@x/contracts'
import { useState } from 'react'
import { toast } from 'sonner'

// SPECS.md §12.2's graduated-action table split the same way
// moderation.service.ts's own POST_ACTIONS/USER_ACTIONS partition it —
// content-level actions only make sense against a post, account-level ones
// only against a user, and applyModerationAction rejects the mismatch with
// a 400 either way. Offering only the valid half here isn't just a nicer
// UI: without it, a moderator using this exact form from account-search.tsx
// (always targetType 'user') would see every content-level action too,
// and only find out it doesn't apply after a round trip.
const ACTIONS_BY_TARGET_TYPE: Record<ModerationTargetType, ModerationActionType[]> = {
  post: ['label', 'reduce_reach', 'hide', 'delete'],
  user: ['read_only', 'suspend', 'ban'],
}

// SPECS.md §12.2's own range for "Modo lectura" — moderation.service.ts
// rejects anything outside this as a ValidationError; mirrored here so the
// form catches the same mistake before a round trip, not instead of the
// server check.
const READ_ONLY_MIN_HOURS = 12
const READ_ONLY_MAX_HOURS = 7 * 24

type ApplyActionFormProps = {
  targetType: ModerationTargetType
  targetId: string
  reportId?: string
  onApplied?: () => void
}

/** POST /moderation/actions — shared by the review queue (with a reportId) and account search (without one, acting on a user directly). */
export function ApplyActionForm({
  targetType,
  targetId,
  reportId,
  onApplied,
}: ApplyActionFormProps) {
  const availableActions = ACTIONS_BY_TARGET_TYPE[targetType]
  const [action, setAction] = useState<ModerationActionType>(availableActions[0] ?? 'label')
  const [reason, setReason] = useState('')
  const [policy, setPolicy] = useState('')
  const [durationHours, setDurationHours] = useState(24)
  const applyAction = useApplyModerationAction()

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    applyAction.mutate(
      {
        targetType,
        targetId,
        action,
        reason,
        policy,
        ...(reportId && { reportId }),
        ...(action === 'read_only' && { durationHours }),
      },
      {
        onSuccess: () => {
          toast.success(`${formatActionLabel(action)} aplicada.`)
          setReason('')
          setPolicy('')
          onApplied?.()
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : 'No se pudo aplicar la acción.')
        },
      },
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={`action-${targetId}`} className="text-sm font-medium">
          Acción
        </label>
        <Select
          id={`action-${targetId}`}
          value={action}
          onChange={(event) => setAction(event.target.value as ModerationActionType)}
        >
          {availableActions.map((type) => (
            <option key={type} value={type}>
              {formatActionLabel(type)}
            </option>
          ))}
        </Select>
      </div>

      {action === 'read_only' && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`duration-${targetId}`} className="text-sm font-medium">
            Duración (horas, {READ_ONLY_MIN_HOURS}–{READ_ONLY_MAX_HOURS})
          </label>
          <Input
            id={`duration-${targetId}`}
            type="number"
            min={READ_ONLY_MIN_HOURS}
            max={READ_ONLY_MAX_HOURS}
            value={durationHours}
            onChange={(event) => setDurationHours(Number(event.target.value))}
          />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={`policy-${targetId}`} className="text-sm font-medium">
          Política aplicada
        </label>
        <Input
          id={`policy-${targetId}`}
          placeholder="p. ej. harassment, spam"
          value={policy}
          onChange={(event) => setPolicy(event.target.value)}
          required
          maxLength={100}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`reason-${targetId}`} className="text-sm font-medium">
          Motivo
        </label>
        <Textarea
          id={`reason-${targetId}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          maxLength={500}
        />
      </div>

      <Button type="submit" variant="destructive" disabled={applyAction.isPending}>
        {applyAction.isPending ? 'Aplicando…' : 'Aplicar acción'}
      </Button>
    </form>
  )
}
