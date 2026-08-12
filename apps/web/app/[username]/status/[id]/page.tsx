import { PostCard } from '@/components/post-card'
import { ThreadReplies } from '@/components/thread-replies'
import { ThreadReplyComposer } from '@/components/thread-reply-composer'
import { serverApiClient } from '@/lib/server-api-client'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

type PostPageProps = {
  params: Promise<{ username: string; id: string }>
}

async function fetchThread(id: string) {
  const { data, error } = await serverApiClient.GET('/posts/{id}/thread', {
    params: { path: { id } },
  })
  if (error) return null
  return data.data
}

/** Open Graph / Twitter Card for the focused post (ROADMAP.md 1.6/2.1, SPECS.md §7.2) — Next dedupes this fetch against the one in the page body below. */
export async function generateMetadata({ params }: PostPageProps): Promise<Metadata> {
  const { id } = await params
  const thread = await fetchThread(id)
  if (!thread) return { title: 'Post no encontrado — X' }

  const post = thread.post
  const title = `${post.author.displayName} en X: "${post.text ?? ''}"`
  const description = post.text ?? `Un post de @${post.author.username} en X.`
  const imageUrl = post.media[0]?.url
  const images = imageUrl ? [{ url: imageUrl }] : undefined

  return {
    title,
    description,
    openGraph: { title, description, type: 'article', images },
    twitter: {
      card: imageUrl ? 'summary_large_image' : 'summary',
      title,
      description,
      images: imageUrl ? [imageUrl] : undefined,
    },
  }
}

/**
 * SSR thread page (ROADMAP.md 2.1) — the URL's `username` is cosmetic
 * (SEO-friendly), the id is canonical: a post whose author since renamed
 * still resolves here rather than 404ing, real X's own convention.
 *
 * Ancestors → focused post → replies, with a connecting line down the
 * ancestor chain into the focused post (the one relationship in a thread
 * that's an unambiguous straight line — replies can branch to many
 * unrelated people, so they don't get one) and the focused post rendered in
 * <PostCard>'s 'focused' variant (bigger avatar/text, a full timestamp +
 * view count instead of the feed's relative one).
 */
export default async function PostPage({ params }: PostPageProps) {
  const { id } = await params
  const thread = await fetchThread(id)
  if (!thread) notFound()

  // Remounts <ThreadReplies> (resetting whatever it loaded beyond this first
  // page) whenever the server-rendered first page itself genuinely changes —
  // e.g. after ThreadReplyComposer's router.refresh() lands a brand new
  // reply — without needing an effect to re-sync props into state.
  const repliesKey = `${thread.post.id}:${thread.replies.map((post) => post.id).join(',')}`

  return (
    <div className="mx-auto min-h-svh max-w-2xl border-x border-border">
      {thread.ancestors.map((post) => (
        <PostCard key={post.id} post={post} showConnectorBelow />
      ))}
      <PostCard post={thread.post} variant="focused" />
      <ThreadReplyComposer postId={thread.post.id} />
      <ThreadReplies
        key={repliesKey}
        postId={thread.post.id}
        initialReplies={thread.replies}
        initialCursor={thread.meta.nextCursor}
      />
    </div>
  )
}
