'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCreateList } from '@/lib/use-lists'
import { zodResolver } from '@hookform/resolvers/zod'
import { type CreateListInput, createListSchema } from '@x/contracts'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

/** POST /lists (ROADMAP.md 2.8) — collapsed behind a toggle so the /lists page isn't dominated by an always-open form. */
export function CreateListForm() {
  const [isOpen, setIsOpen] = useState(false)
  const createList = useCreateList()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateListInput>({
    resolver: zodResolver(createListSchema),
    defaultValues: { isPrivate: false },
  })

  if (!isOpen) {
    return (
      <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
        Nueva lista
      </Button>
    )
  }

  const onSubmit = handleSubmit((values) => {
    createList.mutate(
      {
        name: values.name,
        isPrivate: values.isPrivate,
        // exactOptionalPropertyTypes: an empty description field submits as
        // '', which the mutation should treat the same as "not provided"
        // (posts.service.ts's create() ?? nulls it either way) — this must
        // be a real conditional key, not `description: values.description
        // || undefined`, which would still add the key.
        ...(values.description && { description: values.description }),
      },
      {
        onSuccess: () => {
          toast.success('Lista creada.')
          reset()
          setIsOpen(false)
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : 'No se pudo crear la lista.')
        },
      },
    )
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="list-name" className="text-sm font-medium">
          Nombre
        </label>
        <Input id="list-name" maxLength={25} {...register('name')} />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="list-description" className="text-sm font-medium">
          Descripción (opcional)
        </label>
        <Input id="list-description" maxLength={100} {...register('description')} />
        {errors.description && (
          <p className="text-sm text-destructive">{errors.description.message}</p>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" {...register('isPrivate')} />
        Privada
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={createList.isPending}>
          {createList.isPending ? 'Creando…' : 'Crear lista'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
