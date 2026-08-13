import type { Notification } from '@x/contracts'

/**
 * ROADMAP.md 1.7: `group_key` (`like:{postId}`, `repost:{postId}`, `follow`
 * — `null` for reply/quote/mention/system, individually relevant on
 * purpose) has always traveled in `GET /notifications`'s response with no
 * client ever reading it. A run of consecutive, same-`groupKey`
 * notifications within `GROUP_WINDOW_MS` of the newest one in the run
 * collapses into a single group; anything else (a different `groupKey`, a
 * `null` one, or the same `groupKey` but too far apart in time) stays its
 * own single notification, unchanged.
 */
export type NotificationGroup = {
  groupKey: string
  kind: Notification['kind']
  /** Newest first, same order as the page this group was built from. */
  notifications: Notification[]
  /** De-duped, newest-actor-first. */
  actors: NonNullable<Notification['actor']>[]
  postId: string | null
  /** Read only once every member is — an unread notification hiding inside an otherwise-read group would be invisible to "mark as read" bookkeeping otherwise. */
  isRead: boolean
  /** The newest member's timestamp — anchors the group's own relative-time display. */
  createdAt: string
}

export type NotificationDisplayItem =
  | { kind: 'single'; notification: Notification }
  | { kind: 'group'; group: NotificationGroup }

// "ventana de 1h" — ROADMAP.md 1.7's own wording for this bullet.
const GROUP_WINDOW_MS = 60 * 60 * 1000

/**
 * `notifications` is expected newest-first, exactly the order `GET
 * /notifications` (cursor-paginated by descending Snowflake id) already
 * returns — grouping only ever merges *adjacent* entries, never entries
 * that happen to share a `groupKey` but are separated by other
 * notifications or too much time, so a like from months ago never
 * silently joins today's.
 */
export function groupNotifications(notifications: Notification[]): NotificationDisplayItem[] {
  const items: NotificationDisplayItem[] = []
  let run: Notification[] = []

  function flushRun(): void {
    if (run.length === 0) return
    if (run.length === 1) {
      items.push({ kind: 'single', notification: run[0] as Notification })
    } else {
      items.push({ kind: 'group', group: buildGroup(run) })
    }
    run = []
  }

  for (const notification of notifications) {
    const anchor = run[0]
    const continuesRun =
      anchor !== undefined &&
      notification.groupKey !== null &&
      notification.groupKey === anchor.groupKey &&
      withinWindow(anchor.createdAt, notification.createdAt)
    if (continuesRun) {
      run.push(notification)
    } else {
      flushRun()
      run = [notification]
    }
  }
  flushRun()

  return items
}

function withinWindow(anchorCreatedAt: string, candidateCreatedAt: string): boolean {
  const anchorMs = new Date(anchorCreatedAt).getTime()
  const candidateMs = new Date(candidateCreatedAt).getTime()
  return Math.abs(anchorMs - candidateMs) <= GROUP_WINDOW_MS
}

function buildGroup(run: Notification[]): NotificationGroup {
  const first = run[0] as Notification
  const actors: NonNullable<Notification['actor']>[] = []
  const seenActorIds = new Set<string>()
  for (const notification of run) {
    if (notification.actor && !seenActorIds.has(notification.actor.id)) {
      seenActorIds.add(notification.actor.id)
      actors.push(notification.actor)
    }
  }
  return {
    // A run only ever forms around a non-null, shared groupKey (continuesRun's own check above).
    groupKey: first.groupKey as string,
    kind: first.kind,
    notifications: run,
    actors,
    postId: first.postId,
    isRead: run.every((notification) => notification.isRead),
    createdAt: first.createdAt,
  }
}
