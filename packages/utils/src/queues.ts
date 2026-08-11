// Shared between apps/api (producer) and apps/workers (consumer) — the queue
// name and job payload shape are the contract between two separate
// processes, so they can't live in either one alone.

export const FANOUT_QUEUE_NAME = 'timeline-fanout'

export type FanoutJobData = {
  postId: string
  authorId: string
}
