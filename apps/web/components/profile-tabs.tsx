'use client'

import { ProfilePostList } from '@/components/profile-post-list'
import { cn } from '@/lib/cn'
import type { ProfilePostsFilter } from '@/lib/use-profile-posts'
import { useState } from 'react'

const TABS: Array<{ filter: ProfilePostsFilter; label: string }> = [
  { filter: 'posts', label: 'Posts' },
  { filter: 'replies', label: 'Respuestas' },
  { filter: 'media', label: 'Media' },
  { filter: 'likes', label: 'Me gusta' },
]

/** Posts / Respuestas / Media / Me gusta (SPECS.md §7.2, ROADMAP.md 1.6). */
export function ProfileTabs({ username }: { username: string }) {
  const [activeFilter, setActiveFilter] = useState<ProfilePostsFilter>('posts')

  return (
    <div>
      <div role="tablist" className="flex border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.filter}
            type="button"
            role="tab"
            aria-selected={activeFilter === tab.filter}
            onClick={() => setActiveFilter(tab.filter)}
            className={cn(
              'flex-1 border-b-2 px-4 py-3 text-center text-sm font-medium transition-colors hover:bg-muted',
              activeFilter === tab.filter
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <ProfilePostList username={username} filter={activeFilter} />
    </div>
  )
}
