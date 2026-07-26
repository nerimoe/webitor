import { lazy } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { DocumentViewProvider } from '../documentFormats/types'
import { DocumentViewSwitcher } from './DocumentViewSwitcher'

const EmptyView = lazy(async () => ({ default: () => null }))
const capabilities = { find: false, history: false, textEditing: false, textZoom: false }

function provider(id: string, labelKey: string, priority: number): DocumentViewProvider {
  return {
    id,
    labelKey,
    priority,
    component: EmptyView,
    capabilities,
    matches: () => true
  }
}

describe('DocumentViewSwitcher', () => {
  it('treats matching providers as peer modes and keeps splitting as a separate action', () => {
    const text = provider('text-editor', 'textEditorView', 100)
    const preview = provider('markdown-preview', 'markdownPreviewView', 50)
    const image = provider('image-view', 'imageView', 25)
    const onSelect = vi.fn()
    const onSplit = vi.fn()

    render(<Tooltip.Provider><DocumentViewSwitcher
        views={[text, preview, image]}
        activeViewId={text.id}
        splitCandidates={[preview]}
        onSelect={onSelect}
        onSplit={onSplit}
      /></Tooltip.Provider>)

    expect(screen.getByRole('tab', { name: 'Text editor' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Markdown preview' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Image viewer' })).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(screen.getByRole('tab', { name: 'Markdown preview' }))
    expect(onSelect).toHaveBeenCalledWith('markdown-preview')
    expect(onSplit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Show side by side' }))
    expect(onSplit).toHaveBeenCalledWith('markdown-preview')
  })
})
