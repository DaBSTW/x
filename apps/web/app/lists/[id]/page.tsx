import { ListPage } from '@/components/list-page'

type ListDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function ListDetailPage({ params }: ListDetailPageProps) {
  const { id } = await params
  return (
    <div className="mx-auto min-h-svh max-w-2xl border-x border-border">
      <ListPage listId={id} />
    </div>
  )
}
