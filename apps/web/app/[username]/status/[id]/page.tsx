import { PostCard } from '@/components/post-card'
import { serverApiClient } from '@/lib/server-api-client'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

type PostPageProps = {
  params: Promise<{ username: string; id: string }>
}

async function fetchPost(id: string) {
  const { data, error } = await serverApiClient.GET('/posts/{id}', { params: { path: { id } } })
  if (error) return null
  return data.data
}

/** Open Graph / Twitter Card per post (ROADMAP.md 1.6, SPECS.md §7.2) — Next dedupes this fetch against the one in the page body below. */
export async function generateMetadata({ params }: PostPageProps): Promise<Metadata> {
  const { id } = await params
  const post = await fetchPost(id)
  if (!post) return { title: 'Post no encontrado — X' }

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
 * SSR post detail page — the URL's `username` is cosmetic (SEO-friendly),
 * the id is canonical: a post whose author since renamed still resolves
 * here rather than 404ing, real X's own convention.
 */
export default async function PostPage({ params }: PostPageProps) {
  const { id } = await params
  const post = await fetchPost(id)
  if (!post) notFound()

  return (
    <div className="mx-auto min-h-svh max-w-2xl border-x border-border">
      <PostCard post={post} />
    </div>
  )
}
