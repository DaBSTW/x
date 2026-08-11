'use client'

import { MediaGrid } from '@/components/media-grid'
import { RichText } from '@/components/rich-text'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/cn'
import { formatCompactNumber, formatRelativeTime } from '@/lib/format'
import { useBookmark, useLike, useRepost } from '@/lib/use-post-mutations'
import type { Post } from '@x/contracts'
import Link from 'next/link'
import { memo } from 'react'
import { toast } from 'sonner'

type PostCardProps = {
  post: Post
}

/**
 * SPECS.md §7.2: React.memo, stable height to avoid CLS — the avatar and
 * action row have fixed dimensions regardless of loading state, so only the
 * post's own (naturally variable) text height differs between posts.
 */
function PostCardComponent({ post }: PostCardProps) {
  const like = useLike()
  const repost = useRepost()
  const bookmark = useBookmark()

  // Absent (not hydrated) reads as "not yet known" everywhere except here:
  // a button needs a concrete direction to toggle, and false is the only
  // sane default (packages/contracts/src/post.ts documents why it's absent).
  const viewer = post.viewer ?? { liked: false, reposted: false, bookmarked: false }

  return (
    <article
      className="flex gap-3 border-b border-border p-4"
      aria-label={`Post de ${post.author.displayName}`}
    >
      <Link href={`/${post.author.username}`} aria-label={post.author.displayName}>
        <Avatar>
          <AvatarImage src={post.author.avatarUrl ?? undefined} alt="" />
          <AvatarFallback>{post.author.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-1 text-sm">
          <Link href={`/${post.author.username}`} className="font-semibold hover:underline">
            {post.author.displayName}
          </Link>
          {post.author.isVerified && <span aria-label="cuenta verificada">✓</span>}
          <span className="text-muted-foreground">@{post.author.username}</span>
          <span className="text-muted-foreground" aria-hidden="true">
            ·
          </span>
          <Link href={`/${post.author.username}/status/${post.id}`} className="hover:underline">
            <time dateTime={post.createdAt} className="text-muted-foreground">
              {formatRelativeTime(post.createdAt)}
            </time>
          </Link>
        </div>
        {post.text !== null && (
          <p className="whitespace-pre-wrap text-sm">
            <RichText text={post.text} entities={post.entities} />
          </p>
        )}
        {post.media.length > 0 && (
          <div className="mt-1">
            <MediaGrid media={post.media} />
          </div>
        )}
        <div className="mt-1 flex max-w-md items-center justify-between">
          <ActionButton
            label="Responder"
            icon="reply"
            active={false}
            count={post.counters.replies}
            onClick={() => toast('Las respuestas llegan en una fase futura.')}
          />
          <ActionButton
            label={viewer.reposted ? 'Deshacer repost' : 'Repostear'}
            icon="repost"
            active={viewer.reposted}
            count={post.counters.reposts}
            pending={repost.isPending}
            onClick={() => repost.mutate({ postId: post.id, active: viewer.reposted })}
          />
          <ActionButton
            label={viewer.liked ? 'Quitar me gusta' : 'Me gusta'}
            icon="like"
            active={viewer.liked}
            count={post.counters.likes}
            pending={like.isPending}
            onClick={() => like.mutate({ postId: post.id, active: viewer.liked })}
          />
          <ActionButton
            label={viewer.bookmarked ? 'Quitar de guardados' : 'Guardar'}
            icon="bookmark"
            active={viewer.bookmarked}
            pending={bookmark.isPending}
            onClick={() => bookmark.mutate({ postId: post.id, active: viewer.bookmarked })}
          />
        </div>
      </div>
    </article>
  )
}

export const PostCard = memo(PostCardComponent)

type ActionIconKind = 'reply' | 'repost' | 'like' | 'bookmark'

type ActionButtonProps = {
  label: string
  icon: ActionIconKind
  active: boolean
  count?: number
  pending?: boolean
  onClick: () => void
}

const ACTIVE_COLOR: Record<ActionIconKind, string> = {
  reply: '',
  repost: 'text-green-600 dark:text-green-500',
  like: 'text-destructive',
  bookmark: 'text-primary',
}

function ActionButton({ label, icon, active, count, pending, onClick }: ActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={pending}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full p-2 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50',
        active && ACTIVE_COLOR[icon],
      )}
    >
      <ActionIcon kind={icon} filled={active} />
      {count !== undefined && count > 0 && <span>{formatCompactNumber(count)}</span>}
    </button>
  )
}

const ICON_PATHS: Record<ActionIconKind, string> = {
  reply:
    'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
  repost: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  like: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
}

function ActionIcon({ kind, filled }: { kind: ActionIconKind; filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[kind]} />
    </svg>
  )
}
