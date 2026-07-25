import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownPreview } from './MarkdownPreview'

describe('MarkdownPreview', () => {
  it('renders GFM while ignoring raw HTML', () => {
    const { container } = render(<MarkdownPreview value={'# Title\n\n- [x] done\n\n<script>alert(1)</script>'} />)
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(container.querySelector('script')).toBeNull()
  })
})
