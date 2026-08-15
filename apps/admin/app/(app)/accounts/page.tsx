import { AccountSearch } from '@/components/account-search'

export default function AccountsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="border-b border-border pb-4 text-xl font-bold">Búsqueda de cuentas</h1>
      <AccountSearch />
    </div>
  )
}
