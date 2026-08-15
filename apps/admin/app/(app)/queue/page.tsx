import { ReviewQueueList } from '@/components/review-queue-list'

export default function QueuePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="border-b border-border pb-4 text-xl font-bold">Cola de revisión</h1>
      <ReviewQueueList />
    </div>
  )
}
