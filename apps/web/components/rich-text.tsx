import type { PostEntity } from '@x/contracts'
import Link from 'next/link'

type RichTextProps = {
  text: string
  entities: PostEntity[]
}

/**
 * Renders post text with mentions/hashtags/URLs/cashtags linked, built from
 * `entities` offsets — never `dangerouslySetInnerHTML` (CODESTYLE.md §11,
 * SPECS.md §7.2). Offsets are code points, not UTF-16 units, so slicing goes
 * through an array of code points, matching @x/utils/text's own counting.
 */
export function RichText({ text, entities }: RichTextProps) {
  const codePoints = Array.from(text)
  const sorted = [...entities].sort((a, b) => a.start - b.start)

  const nodes: React.ReactNode[] = []
  let cursor = 0

  sorted.forEach((entity, index) => {
    if (entity.start > cursor) {
      nodes.push(codePoints.slice(cursor, entity.start).join(''))
    }
    nodes.push(renderEntity(entity, `${entity.kind}-${entity.start}-${index}`))
    cursor = entity.end
  })
  if (cursor < codePoints.length) {
    nodes.push(codePoints.slice(cursor).join(''))
  }

  return <>{nodes}</>
}

function renderEntity(entity: PostEntity, key: string): React.ReactNode {
  const linkClassName = 'text-primary hover:underline'
  switch (entity.kind) {
    case 'mention':
      return (
        <Link key={key} href={`/${entity.value}`} className={linkClassName}>
          @{entity.value}
        </Link>
      )
    case 'hashtag':
      return (
        <Link
          key={key}
          href={`/search?q=${encodeURIComponent(`#${entity.value}`)}`}
          className={linkClassName}
        >
          #{entity.value}
        </Link>
      )
    case 'cashtag':
      return (
        <Link
          key={key}
          href={`/search?q=${encodeURIComponent(`$${entity.value}`)}`}
          className={linkClassName}
        >
          ${entity.value}
        </Link>
      )
    case 'url':
      return (
        <a
          key={key}
          href={entity.value}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={linkClassName}
        >
          {entity.value}
        </a>
      )
  }
}
