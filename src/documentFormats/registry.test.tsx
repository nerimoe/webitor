import { lazy } from 'react'
import { describe, expect, it } from 'vitest'
import { registerDocumentFormat, registerDocumentView, resolveDocumentViews } from './registry'

const EmptyView = lazy(async () => ({ default: () => null }))
const noCapabilities = { find: false, history: false, textEditing: false, textZoom: false }

describe('document format registry', () => {
  it('matches both text editing and preview views for Markdown', () => {
    const resolved = resolveDocumentViews({ name: 'README.md', contentKind: 'text' })
    expect(resolved.format.id).toBe('markdown')
    expect(resolved.views.map((view) => view.id)).toEqual(['text-editor', 'markdown-preview'])
  })

  it('lets a custom format contribute multiple views without changing the editor shell', () => {
    const unregisterFormat = registerDocumentFormat({
      id: 'abcd', dataKind: 'text', label: () => 'ABCD', matches: ({ name }) => name.toLowerCase().endsWith('.abcd')
    })
    const unregisterForm = registerDocumentView({
      id: 'abcd-form', labelKey: 'abcdForm', priority: 200, component: EmptyView, capabilities: noCapabilities, matches: (format) => format.id === 'abcd'
    })
    const unregisterPreview = registerDocumentView({
      id: 'abcd-preview', labelKey: 'abcdPreview', priority: 150, component: EmptyView, capabilities: noCapabilities, matches: (format) => format.id === 'abcd'
    })
    try {
      const resolved = resolveDocumentViews({ name: 'example.abcd', contentKind: 'text' })
      expect(resolved.format.id).toBe('abcd')
      expect(resolved.views.map((view) => view.id)).toEqual(['abcd-form', 'abcd-preview', 'text-editor'])
      expect(resolved.views[0].id).toBe('abcd-form')
    } finally {
      unregisterPreview()
      unregisterForm()
      unregisterFormat()
    }
  })
})
