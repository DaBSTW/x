import { ProfileHeader } from '@/components/profile-header'
import { ProfileTabs } from '@/components/profile-tabs'
import { serverApiClient } from '@/lib/server-api-client'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

type ProfilePageProps = {
  params: Promise<{ username: string }>
}

async function fetchProfile(username: string) {
  const { data, error } = await serverApiClient.GET('/users/{username}', {
    params: { path: { username } },
  })
  if (error) return null
  return data.data
}

/** Open Graph / Twitter Card per profile (ROADMAP.md 1.6, SPECS.md §7.2) — Next dedupes this fetch against the one in the page body below. */
export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { username } = await params
  const profile = await fetchProfile(username)
  if (!profile) return { title: 'Perfil no encontrado — X' }

  const title = `${profile.displayName} (@${profile.username}) — X`
  const description = profile.bio ?? `Publicaciones de @${profile.username} en X.`
  const images = profile.avatarUrl ? [{ url: profile.avatarUrl }] : undefined

  return {
    title,
    description,
    openGraph: { title, description, type: 'profile', images },
    twitter: {
      card: 'summary',
      title,
      description,
      images: profile.avatarUrl ? [profile.avatarUrl] : undefined,
    },
  }
}

/** SSR profile page — public, unauthenticated, crawlable (ROADMAP.md 1.6). */
export default async function ProfilePage({ params }: ProfilePageProps) {
  const { username } = await params
  const profile = await fetchProfile(username)
  if (!profile) notFound()

  return (
    <div className="mx-auto flex min-h-svh max-w-2xl flex-col border-x border-border">
      <ProfileHeader profile={profile} />
      <ProfileTabs username={profile.username} />
    </div>
  )
}
