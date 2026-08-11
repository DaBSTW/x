import { PostCard } from '@/components/post-card'
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
 * ⚪ The focused post isn't visually distinguished from its ancestors/replies
 * (real X renders it larger) — <PostCard> has no such variant yet, and this
 * ships the plain, honest version instead of inventing one under time
 * pressure. Same for the connecting lines SPECS.md's <ThreadView> mentions:
 * this is the information architecture (ancestors → focused post → replies)
 * without that visual layer yet.
 */
export default async function PostPage({ params }: PostPageProps) {
  const { id } = await params
  const thread = await fetchThread(id)
  if (!thread) notFound()

  return (
    <div className="mx-auto min-h-svh max-w-2xl border-x border-border">
      {thread.ancestors.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
      <PostCard post={thread.post} />
      <ThreadReplyComposer postId={thread.post.id} />
      {thread.replies.length > 0 && (
        <div className="border-t-4 border-border">
          {thread.replies.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  )
}
