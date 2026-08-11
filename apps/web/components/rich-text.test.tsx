import { render, screen } from '@testing-library/react'
import { parseEntities } from '@x/utils/text'
import { describe, expect, it } from 'vitest'
import { RichText } from './rich-text.js'

// Entities come from the same parseEntities() the backend runs (SPECS.md §7.2:
// "parseo por offsets de entities"), rather than hand-counted offsets —
// hand-counting code-point offsets is exactly the kind of off-by-one mistake
// this avoids, and it exercises RichText against realistic entity data.
function withParsedEntities(text: string) {
  return <RichText text={text} entities={parseEntities(text)} />
}

describe('RichText', () => {
  it('renders plain text with no entities', () => {
    render(<RichText text="hola mundo" entities={[]} />)
    expect(screen.getByText('hola mundo')).toBeInTheDocument()
  })

  it('links a mention to the profile route', () => {
    render(withParsedEntities('hola @ana!'))

    const link = screen.getByRole('link', { name: '@ana' })
    expect(link).toHaveAttribute('href', '/ana')
  })

  it('links a hashtag to a search query', () => {
    render(withParsedEntities('#x trending'))

    const link = screen.getByRole('link', { name: '#x' })
    expect(link).toHaveAttribute('href', '/search?q=%23x')
  })

  it('links a cashtag to a search query', () => {
    render(withParsedEntities('$ABC up'))

    const link = screen.getByRole('link', { name: '$ABC' })
    expect(link).toHaveAttribute('href', '/search?q=%24ABC')
  })

  it('renders a URL as an external, non-following link', () => {
    const url = 'https://example.com/path'
    render(withParsedEntities(`ver ${url}`))

    const link = screen.getByRole('link', { name: url })
    expect(link).toHaveAttribute('href', url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('preserves the surrounding text around an entity, without duplicating it', () => {
    const { container } = render(withParsedEntities('hola @ana, ¿qué tal?'))
    expect(container).toHaveTextContent('hola @ana, ¿qué tal?')
  })

  it('renders every entity found, in text order, regardless of a multi-entity mix', () => {
    const { container } = render(withParsedEntities('#x hola @bob, mira https://example.com'))

    expect(container).toHaveTextContent('#x hola @bob, mira https://example.com')
    expect(screen.getByRole('link', { name: '#x' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '@bob' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://example.com' })).toBeInTheDocument()
  })
})
