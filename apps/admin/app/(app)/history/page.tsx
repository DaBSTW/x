import { ActionHistoryList } from '@/components/action-history-list'

export default function HistoryPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="border-b border-border pb-4 text-xl font-bold">Historial de acciones</h1>
      <ActionHistoryList />
    </div>
  )
}
