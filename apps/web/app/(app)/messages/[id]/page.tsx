import { ChatView } from '@/components/chat-view'

type ChatPageProps = {
  params: Promise<{ id: string }>
}

export default async function ChatPage({ params }: ChatPageProps) {
  const { id } = await params
  return <ChatView conversationId={id} />
}
