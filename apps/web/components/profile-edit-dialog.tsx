'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { uploadImage, validateImageFile } from '@/lib/upload-image'
import { useUpdateProfile } from '@/lib/use-current-user'
import type { UpdateUserInput, UserProfile } from '@x/contracts'
import { ALLOWED_IMAGE_MIME_TYPES } from '@x/utils/media'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

/**
 * ROADMAP.md 1.6: `PATCH /users/me` (displayName/bio/location/websiteUrl/
 * avatarMediaId/bannerMediaId) existed since this section was first built
 * and was fully tested end to end at the API level — nothing in apps/web
 * ever called it for these fields, so a profile's identity was only ever
 * settable by hand against the API. `<ProfileHeader>` is the one caller,
 * shown only on the viewer's own profile.
 *
 * Remounted by `key` on every open (composer.tsx's `<AltTextDialog>`
 * established this pattern first) so the draft always re-seeds from the
 * current profile instead of carrying over a cancelled edit — no
 * `DialogTrigger` here either, opened by a plain button click the same way.
 */
export function ProfileEditDialog({
  profile,
  open,
  onOpenChange,
}: {
  profile: UserProfile
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [bio, setBio] = useState(profile.bio ?? '')
  const [location, setLocation] = useState(profile.location ?? '')
  const [websiteUrl, setWebsiteUrl] = useState(profile.websiteUrl ?? '')
  const [avatarPreview, setAvatarPreview] = useState(profile.avatarUrl)
  const [bannerPreview, setBannerPreview] = useState(profile.bannerUrl)
  const [avatarMediaId, setAvatarMediaId] = useState<string>()
  const [bannerMediaId, setBannerMediaId] = useState<string>()
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [isUploadingBanner, setIsUploadingBanner] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const updateProfile = useUpdateProfile()

  async function handleImagePick(
    file: File,
    setPreview: (url: string) => void,
    setMediaId: (id: string) => void,
    setUploading: (busy: boolean) => void,
  ) {
    const validationError = validateImageFile(file)
    if (validationError) {
      toast.error(validationError)
      return
    }
    setUploading(true)
    try {
      const mediaId = await uploadImage(file)
      setMediaId(mediaId)
      setPreview(URL.createObjectURL(file))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo subir la imagen.')
    } finally {
      setUploading(false)
    }
  }

  function save() {
    const input: UpdateUserInput = {
      displayName,
      bio,
      location,
    }
    // websiteUrl requires a valid URL at the schema level (packages/contracts)
    // — there's no way through this endpoint to clear a previously-set one
    // back to empty, so an emptied field is simply left unchanged rather
    // than sent as an invalid ''. A real, separate gap, not one this dialog
    // can paper over on its own.
    if (websiteUrl.trim().length > 0) input.websiteUrl = websiteUrl.trim()
    if (avatarMediaId !== undefined) input.avatarMediaId = avatarMediaId
    if (bannerMediaId !== undefined) input.bannerMediaId = bannerMediaId

    updateProfile.mutate(input, {
      onSuccess: () => {
        toast.success('Perfil actualizado.')
        onOpenChange(false)
        // ROADMAP.md 1.6: app/[username]/page.tsx is a real Server
        // Component — its `profile` prop came from a server-side fetch at
        // render time, not the `['users','me']` client query useUpdateProfile
        // already updated. router.refresh() re-runs that server fetch (same
        // pattern composer.tsx's onPosted already uses for a new reply to
        // show up), so the page actually reflects what was just saved
        // instead of only the client cache doing so silently.
        router.refresh()
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el perfil.')
      },
    })
  }

  const isBusy = isUploadingAvatar || isUploadingBanner || updateProfile.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>Editar perfil</DialogTitle>

        <div className="flex flex-col gap-4">
          <div className="relative h-32 rounded-md bg-muted">
            {bannerPreview && (
              <img src={bannerPreview} alt="" className="h-full w-full rounded-md object-cover" />
            )}
            <input
              ref={bannerInputRef}
              type="file"
              aria-label="Imagen de portada"
              accept={ALLOWED_IMAGE_MIME_TYPES.join(',')}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  void handleImagePick(
                    file,
                    setBannerPreview,
                    setBannerMediaId,
                    setIsUploadingBanner,
                  )
                }
                event.target.value = ''
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="absolute bottom-2 right-2"
              disabled={isUploadingBanner}
              onClick={() => bannerInputRef.current?.click()}
            >
              {isUploadingBanner ? 'Subiendo…' : 'Cambiar portada'}
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <Avatar className="h-20 w-20">
              <AvatarImage src={avatarPreview ?? undefined} alt="" />
              <AvatarFallback className="text-xl">
                {displayName.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <input
              ref={avatarInputRef}
              type="file"
              aria-label="Foto de perfil"
              accept={ALLOWED_IMAGE_MIME_TYPES.join(',')}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  void handleImagePick(
                    file,
                    setAvatarPreview,
                    setAvatarMediaId,
                    setIsUploadingAvatar,
                  )
                }
                event.target.value = ''
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={isUploadingAvatar}
              onClick={() => avatarInputRef.current?.click()}
            >
              {isUploadingAvatar ? 'Subiendo…' : 'Cambiar foto de perfil'}
            </Button>
          </div>

          {/* Explicit htmlFor/id, not nesting <Input>/<textarea> inside
              <label> — Biome's a11y linter can verify a native <textarea>
              nested in a label, but <Input> is an opaque custom component to
              it (it can't see the real <input> the props spread onto), so it
              flags nesting there as unverifiable even though it works. */}
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="profile-edit-display-name">Nombre</label>
            <Input
              id="profile-edit-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={50}
              required
            />
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="profile-edit-bio">Biografía</label>
            <textarea
              id="profile-edit-bio"
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              maxLength={160}
              rows={3}
              className="w-full resize-none rounded-md border border-border bg-transparent p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="profile-edit-location">Ubicación</label>
            <Input
              id="profile-edit-location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              maxLength={30}
            />
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="profile-edit-website">Sitio web</label>
            <Input
              id="profile-edit-website"
              type="url"
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              placeholder="https://…"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={isBusy || displayName.trim().length === 0}
            >
              {updateProfile.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
