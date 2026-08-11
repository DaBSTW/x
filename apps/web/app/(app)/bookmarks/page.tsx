import { BookmarksFeed } from '@/components/bookmarks-feed'

export default function BookmarksPage() {
  return (
    <div className="flex flex-col">
      <h1 className="border-b border-border p-4 text-xl font-bold">Guardados</h1>
      <BookmarksFeed />
    </div>
  )
}
