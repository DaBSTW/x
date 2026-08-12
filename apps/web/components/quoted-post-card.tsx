import { MediaGrid } from '@/components/media-grid'
import { RichText } from '@/components/rich-text'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { formatRelativeTime } from '@/lib/format'
import type { Post } from '@x/contracts'
import Link from 'next/link'

type QuotedPostCardProps = {
  // postSchema's own embedded shape (one level deep, no further quotedPost
  // or viewer state — see packages/contracts/src/post.ts) rather than the
  // full `Post` type, so this component can never be handed a post whose
  // own quotedPost it might try to render recursively.
  post: NonNullable<Post['quotedPost']>
}

/**
 * ROADMAP.md 2.1 "Citas": read-only preview of the post a quote embeds.
 * Deliberately not `<PostCard>` nested inside itself — no like/repost/reply
 * actions here (a quote's embed is a preview, not another interactive post),
 * and only the header links navigate (matching `<PostCard>`'s own header),
 * so `<RichText>`'s per-entity links in the body stay independently
 * clickable instead of nesting inside a card-wide `<a>`.
 */
export function QuotedPostCard({ post }: QuotedPostCardProps) {
  const profileHref = `/${post.author.username}`
  const postHref = `${profileHref}/status/${post.id}`

  return (
    <article
      className="mt-2 rounded-2xl border border-border p-3"
      aria-label={`Post citado de ${post.author.displayName}`}
    >
      <div className="flex flex-wrap items-center gap-x-1 text-sm">
        <Link href={profileHref} className="flex items-center gap-1.5 hover:underline">
          <Avatar className="h-5 w-5">
            <AvatarImage src={post.author.avatarUrl ?? undefined} alt="" />
            <AvatarFallback className="text-[10px]">
              {post.author.displayName.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="font-semibold">{post.author.displayName}</span>
        </Link>
        {post.author.isVerified && <span aria-label="cuenta verificada">✓</span>}
        <span className="text-muted-foreground">@{post.author.username}</span>
        <span className="text-muted-foreground" aria-hidden="true">
          ·
        </span>
        <Link href={postHref} className="hover:underline">
          <time dateTime={post.createdAt} className="text-muted-foreground">
            {formatRelativeTime(post.createdAt)}
          </time>
        </Link>
      </div>
      {post.text !== null && (
        <p className="mt-0.5 whitespace-pre-wrap text-sm">
          <RichText text={post.text} entities={post.entities} />
        </p>
      )}
      {post.media.length > 0 && (
        <div className="mt-1">
          <MediaGrid media={post.media} />
        </div>
      )}
    </article>
  )
}
