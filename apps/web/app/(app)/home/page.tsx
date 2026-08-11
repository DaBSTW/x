import { Composer } from '@/components/composer'
import { Timeline } from '@/components/timeline'

export default function HomePage() {
  return (
    <div className="flex flex-col">
      <Composer />
      <Timeline />
    </div>
  )
}
