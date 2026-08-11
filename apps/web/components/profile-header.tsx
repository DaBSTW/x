'use client'

import { FollowButton } from '@/components/follow-button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { formatCompactNumber, formatJoinDate } from '@/lib/format'
import { useCurrentUser } from '@/lib/use-current-user'
import type { UserProfile } from '@x/contracts'

type ProfileHeaderProps = {
  profile: UserProfile
}

/** Banner, avatar, bio, counters, follow toggle — the profile page's SSR shell (SPECS.md §7.2, ROADMAP.md 1.6). */
export function ProfileHeader({ profile }: ProfileHeaderProps) {
  const { data: me } = useCurrentUser()
  const isOwnProfile = me?.id === profile.id

  return (
    <div className="border-b border-border">
      <div className="h-32 bg-muted sm:h-48">
        {profile.bannerUrl && (
          <img src={profile.bannerUrl} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="-mt-12 flex items-end justify-between">
          <Avatar className="h-24 w-24 border-4 border-background">
            <AvatarImage src={profile.avatarUrl ?? undefined} alt="" />
            <AvatarFallback className="text-2xl">
              {profile.displayName.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {!isOwnProfile && <FollowButton userId={profile.id} />}
        </div>
        <div>
          <div className="flex items-center gap-1 text-xl font-bold">
            {profile.displayName}
            {profile.isVerified && <span aria-label="cuenta verificada">✓</span>}
          </div>
          <p className="text-muted-foreground">@{profile.username}</p>
        </div>
        {profile.bio && <p className="whitespace-pre-wrap text-sm">{profile.bio}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {profile.location && <span>{profile.location}</span>}
          {profile.websiteUrl && (
            <a
              href={profile.websiteUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-primary hover:underline"
            >
              {profile.websiteUrl}
            </a>
          )}
          <span>Se unió en {formatJoinDate(profile.createdAt)}</span>
        </div>
        <div className="flex gap-4 text-sm">
          <span>
            <strong>{formatCompactNumber(profile.counters.following)}</strong>{' '}
            <span className="text-muted-foreground">Siguiendo</span>
          </span>
          <span>
            <strong>{formatCompactNumber(profile.counters.followers)}</strong>{' '}
            <span className="text-muted-foreground">Seguidores</span>
          </span>
        </div>
      </div>
    </div>
  )
}
