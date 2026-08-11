import { CreateListForm } from '@/components/create-list-form'
import { MyLists } from '@/components/my-lists'

export default function ListsPage() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h1 className="text-xl font-bold">Listas</h1>
        <CreateListForm />
      </div>
      <MyLists />
    </div>
  )
}
