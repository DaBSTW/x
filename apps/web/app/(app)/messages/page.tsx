import { ConversationList } from '@/components/conversation-list'
import { NewConversationForm } from '@/components/new-conversation-form'

export default function MessagesPage() {
  return (
    <div className="flex flex-col">
      <h1 className="border-b border-border p-4 text-xl font-bold">Mensajes</h1>
      <NewConversationForm />
      <ConversationList />
    </div>
  )
}
