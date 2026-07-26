import { describe, expect, it } from 'vitest'
import { initialPersistedState } from '../store/useWorkspace'
import { parsePersistedState } from './persistedState'

describe('persisted workspace schema', () => {
  it('migrates legacy layout fields at the persistence boundary', () => {
    const legacy = structuredClone(initialPersistedState()) as unknown as Record<string, unknown>
    const layout = legacy.layout as Record<string, unknown>
    delete legacy.schemaVersion
    delete layout.editorFontSize
    delete layout.sidebarCollapsed
    delete layout.activeMobileGroup

    const restored = parsePersistedState(legacy)
    expect(restored.schemaVersion).toBe(5)
    expect(restored.layout.editorFontSize).toBe(16)
    expect(restored.layout.sidebarCollapsed).toBe(false)
    expect(restored.layout.activeMobileGroup).toBe('primary')
  })

  it('rejects a file node without matching content', () => {
    const invalid = initialPersistedState()
    invalid.nodes.file = { id: 'file', parentId: null, name: 'note.txt', kind: 'file', order: 0, source: 'new' }
    expect(() => parsePersistedState(invalid)).toThrow('has no content')
  })

  it('rejects duplicate sibling names before hydration', () => {
    const invalid = initialPersistedState()
    invalid.nodes.one = { id: 'one', parentId: null, name: 'Note.txt', kind: 'file', order: 0, source: 'new' }
    invalid.nodes.two = { id: 'two', parentId: null, name: 'note.TXT', kind: 'file', order: 1, source: 'new' }
    invalid.contents.one = { fileId: 'one', text: 'one', contentKind: 'text', version: 1, status: 'cached' }
    invalid.contents.two = { fileId: 'two', text: 'two', contentKind: 'text', version: 1, status: 'cached' }
    expect(() => parsePersistedState(invalid)).toThrow('Duplicate sibling name')
  })

  it('turns an interrupted saving state into the cached state on restore', () => {
    const interrupted = initialPersistedState()
    interrupted.nodes.file = { id: 'file', parentId: null, name: 'note.txt', kind: 'file', order: 0, source: 'new' }
    interrupted.contents.file = { fileId: 'file', text: 'saved text', contentKind: 'text', version: 2, status: 'saving' }
    expect(parsePersistedState(interrupted).contents.file.status).toBe('local-only')
  })

  it('keeps both files when migrating legacy duplicate names', () => {
    const legacy = initialPersistedState() as unknown as Omit<ReturnType<typeof initialPersistedState>, 'schemaVersion'> & { schemaVersion?: never }
    delete legacy.schemaVersion
    legacy.nodes.one = { id: 'one', parentId: null, name: 'note.txt', kind: 'file', order: 0, source: 'new' }
    legacy.nodes.two = { id: 'two', parentId: null, name: 'NOTE.txt', kind: 'file', order: 1, source: 'new' }
    legacy.contents.one = { fileId: 'one', text: 'one', version: 1, status: 'cached' }
    legacy.contents.two = { fileId: 'two', text: 'two', version: 1, status: 'cached' }

    const restored = parsePersistedState(legacy)
    expect(Object.values(restored.nodes).map((node) => node.name)).toEqual(['note.txt', 'NOTE 2.txt'])
  })

  it('migrates version 1 base64 images to binary media', async () => {
    const versionOne = initialPersistedState() as unknown as Record<string, unknown>
    versionOne.schemaVersion = 1
    const nodes = versionOne.nodes as Record<string, unknown>
    const contents = versionOne.contents as Record<string, unknown>
    nodes.photo = { id: 'photo', parentId: null, name: 'photo.heic', kind: 'file', order: 0, source: 'drop' }
    contents.photo = { fileId: 'photo', text: '', contentKind: 'image', dataUrl: 'data:image/heic;base64,AAEC', mimeType: 'image/heic', version: 1, status: 'local-only' }

    const restored = parsePersistedState(versionOne)
    expect(restored.contents.photo.dataUrl).toBeUndefined()
    expect(new Uint8Array(await restored.contents.photo.mediaBlob!.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2]))
    expect(restored.contents.photo.mimeType).toBe('image/heic')
  })

  it('migrates version 2 editor view ids and preview-only active files', () => {
    const versionTwo = initialPersistedState() as unknown as Record<string, unknown>
    versionTwo.schemaVersion = 2
    const nodes = versionTwo.nodes as Record<string, unknown>
    const contents = versionTwo.contents as Record<string, unknown>
    const layout = versionTwo.layout as { groups: Array<Record<string, unknown>> }
    nodes.note = { id: 'note', parentId: null, name: 'note.md', kind: 'file', order: 0, source: 'new' }
    contents.note = { fileId: 'note', text: '# Note', contentKind: 'text', version: 1, status: 'cached' }
    layout.groups[0] = { id: 'primary', tabs: ['note'], activeFileId: 'note', view: 'editor' }
    layout.groups[1] = { id: 'secondary', tabs: [], activeFileId: 'note', view: 'markdown-preview' }

    const restored = parsePersistedState(versionTwo)
    expect(restored.layout.groups[0].view).toBe('text-editor')
    expect(restored.layout.groups[1]).toMatchObject({ activeFileId: 'note', tabs: ['note'], view: 'markdown-preview' })
  })

  it('migrates a version 3 active file that is outside its pane tabs', () => {
    const versionThree = initialPersistedState() as unknown as Record<string, unknown>
    versionThree.schemaVersion = 3
    const nodes = versionThree.nodes as Record<string, unknown>
    const contents = versionThree.contents as Record<string, unknown>
    const layout = versionThree.layout as { groups: Array<Record<string, unknown>> }
    nodes.note = { id: 'note', parentId: null, name: 'note.md', kind: 'file', order: 0, source: 'new' }
    contents.note = { fileId: 'note', text: '# Note', contentKind: 'text', version: 1, status: 'cached' }
    layout.groups[1] = { id: 'secondary', tabs: [], activeFileId: 'note', view: 'markdown-preview' }

    expect(parsePersistedState(versionThree).layout.groups[1].tabs).toEqual(['note'])
  })

  it('removes missing expanded directories while migrating version 4', () => {
    const versionFour = initialPersistedState() as unknown as Record<string, unknown>
    versionFour.schemaVersion = 4
    versionFour.expanded = ['missing-directory']

    expect(parsePersistedState(versionFour).expanded).toEqual([])
  })

  it('rejects a version 5 active file that is outside its pane tabs', () => {
    const invalid = initialPersistedState()
    invalid.nodes.note = { id: 'note', parentId: null, name: 'note.txt', kind: 'file', order: 0, source: 'new' }
    invalid.contents.note = { fileId: 'note', text: 'Note', contentKind: 'text', version: 1, status: 'cached' }
    invalid.layout.groups[0].activeFileId = 'note'
    expect(() => parsePersistedState(invalid)).toThrow('is not in its tabs')
  })
})
