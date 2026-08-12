import { TrendsList } from '@/components/trends-list'

export default function ExplorePage() {
  return (
    <div className="flex flex-col">
      <h1 className="border-b border-border p-4 text-xl font-bold">Explorar</h1>
      <div className="p-4">
        <TrendsList />
      </div>
    </div>
  )
}
