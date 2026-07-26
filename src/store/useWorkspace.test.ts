import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialPersistedState, useWorkspace } from './useWorkspace'

describe('workspace store', () => {
  beforeEach(() => {
    useWorkspace.setState({ ...initialPersistedState(), hydrated: true, persistenceBlocked: false, notice: null, selectedNodeId: null })
  })

  afterEach(() => vi.useRealTimers())

  it('keeps imported sibling names unique', () => {
    const first = useWorkspace.getState().addFile('index.ts', 'one', { open: false })
    const second = useWorkspace.getState().addFile('index.ts', 'two', { open: false })
    expect(useWorkspace.getState().nodes[first].name).toBe('index.ts')
    expect(useWorkspace.getState().nodes[second].name).toBe('index 2.ts')
  })

  it('keeps sibling names unique through rename and move', () => {
    const folder = useWorkspace.getState().addDirectory('Notes')
    const existing = useWorkspace.getState().addFile('draft.txt', 'one', { parentId: folder, open: false })
    const moving = useWorkspace.getState().addFile('draft.txt', 'two', { open: false })
    useWorkspace.getState().moveNode(moving, folder)
    expect(useWorkspace.getState().nodes[moving].name).toBe('draft 2.txt')

    useWorkspace.getState().renameNode(existing, 'draft 2.txt')
    expect(useWorkspace.getState().nodes[existing].name).not.toBe(useWorkspace.getState().nodes[moving].name)
  })

  it('cancels pending autosave when a file is deleted', async () => {
    const file = useWorkspace.getState().addFile('temporary.txt', 'before')
    await useWorkspace.getState().persist()
    vi.useFakeTimers()
    useWorkspace.getState().updateContent(file, 'after')
    useWorkspace.getState().deleteNode(file)
    await vi.advanceTimersByTimeAsync(1_100)
    expect(useWorkspace.getState().nodes[file]).toBeUndefined()
    expect(useWorkspace.getState().contents[file]).toBeUndefined()
  })

  it('deletes a directory, descendants, content, and open tabs together', () => {
    const folder = useWorkspace.getState().addDirectory('src')
    const file = useWorkspace.getState().addFile('main.ts', 'code', { parentId: folder })
    useWorkspace.getState().deleteNode(folder)
    const state = useWorkspace.getState()
    expect(state.nodes[folder]).toBeUndefined()
    expect(state.nodes[file]).toBeUndefined()
    expect(state.contents[file]).toBeUndefined()
    expect(state.layout.groups[0].tabs).not.toContain(file)
    expect(state.expanded).not.toContain(folder)
  })

  it('uses the secondary group for Markdown preview without closing its tabs', () => {
    const previous = useWorkspace.getState().addFile('old.txt', 'old', { groupId: 'secondary' })
    const markdown = useWorkspace.getState().addFile('README.md', '# Hello')
    useWorkspace.getState().openFileView(markdown, 'secondary', 'markdown-preview')
    const secondary = useWorkspace.getState().layout.groups[1]
    expect(secondary.view).toBe('markdown-preview')
    expect(secondary.activeFileId).toBe(markdown)
    expect(secondary.tabs).toContain(previous)
  })

  it('moves a file into a directory and prevents circular directory moves', () => {
    const parent = useWorkspace.getState().addDirectory('parent')
    const child = useWorkspace.getState().addDirectory('child', parent)
    const file = useWorkspace.getState().addFile('note.txt', '', { open: false })
    useWorkspace.getState().moveNode(file, child)
    useWorkspace.getState().moveNode(parent, child)
    expect(useWorkspace.getState().nodes[file].parentId).toBe(child)
    expect(useWorkspace.getState().nodes[parent].parentId).toBeNull()
  })

  it('switches one pane between matching Markdown views', () => {
    const markdown = useWorkspace.getState().addFile('note.md', '# Note')
    useWorkspace.getState().setGroupView('primary', 'markdown-preview')
    expect(useWorkspace.getState().layout.groups[0].view).toBe('markdown-preview')
    useWorkspace.getState().setGroupView('primary', 'text-editor')
    expect(useWorkspace.getState().layout.groups[0].view).toBe('text-editor')
    expect(useWorkspace.getState().layout.groups[0].activeFileId).toBe(markdown)
  })

  it('closes either split group and promotes the remaining document', () => {
    const left = useWorkspace.getState().addFile('left.txt', 'left')
    const right = useWorkspace.getState().addFile('right.txt', 'right', { groupId: 'secondary' })
    useWorkspace.getState().closeGroup('secondary')
    expect(useWorkspace.getState().layout.groups[0].activeFileId).toBe(left)
    expect(useWorkspace.getState().layout.groups[1].activeFileId).toBeNull()

    useWorkspace.getState().openFile(right, 'secondary')
    useWorkspace.getState().closeGroup('primary')
    expect(useWorkspace.getState().layout.groups[0].activeFileId).toBe(right)
    expect(useWorkspace.getState().layout.groups[1].activeFileId).toBeNull()
  })

  it('can close the only open document without deleting it from the workspace', () => {
    const file = useWorkspace.getState().addFile('note.txt', 'note')
    useWorkspace.getState().closeGroup('primary')
    const state = useWorkspace.getState()
    expect(state.layout.groups[0].activeFileId).toBeNull()
    expect(state.nodes[file].name).toBe('note.txt')
  })

  it('reorders sibling documents without losing their order', () => {
    const first = useWorkspace.getState().addFile('first.txt', '', { open: false })
    const second = useWorkspace.getState().addFile('second.txt', '', { open: false })
    const third = useWorkspace.getState().addFile('third.txt', '', { open: false })
    useWorkspace.getState().reorderNode(third, null, first, 'before')
    const ordered = Object.values(useWorkspace.getState().nodes).sort((a, b) => a.order - b.order).map((node) => node.id)
    expect(ordered).toEqual([third, first, second])
  })
})
