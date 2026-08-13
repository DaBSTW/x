'use client'

import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/format'
import { useRevokeSession, useSessions } from '@/lib/use-sessions'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

export function SessionsList() {
  const { data: sessions, isLoading } = useSessions()
  const revokeSession = useRevokeSession()
  const t = useTranslations('SessionsList')

  if (isLoading || !sessions) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>
  }

  function onRevoke(id: string) {
    revokeSession.mutate(id, {
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : t('revokeError'))
      },
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ROADMAP.md 2.10's ICU catalog bullet — a genuine plural, not a
          contrived one: "0 sessions"/"1 session"/"N sessions" each need
          their own grammatical form in both catalogs (SessionsList.count),
          which a flat key-value string couldn't express correctly. */}
      <p className="text-sm text-muted-foreground">{t('count', { count: sessions.length })}</p>
      <ul aria-label={t('ariaLabel')} className="flex flex-col gap-3">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center justify-between gap-4 text-sm">
            <div className="flex flex-col">
              <span>{session.userAgent ?? t('unknownDevice')}</span>
              <span className="text-muted-foreground">
                {session.ipAddress ?? t('unknownIp')} · {formatRelativeTime(session.createdAt)}
              </span>
            </div>
            {session.isCurrent ? (
              <span className="text-xs text-muted-foreground">{t('currentSession')}</span>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onRevoke(session.id)}
                disabled={revokeSession.isPending}
              >
                {t('revoke')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
