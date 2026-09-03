import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '../i18n'
import type { FileContent, FileNode } from '../types'
import OptDocumentView from './OptDocumentView'

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: any) => void) | null = null

  postMessage(msg: any) {
    if (msg.type === 'open') {
      setTimeout(() => {
        this.onmessage?.({
          data: {
            id: msg.id,
            type: 'open',
            entries: [
              { id: 0, path: 'data.conf', sizeBytes: '323' },
              { id: 1, path: 'docs/readme.txt', sizeBytes: '19' }
            ]
          }
        } as any)
      }, 10)
    } else if (msg.type === 'read') {
      setTimeout(() => {
        const text = msg.fileId === 0 ? 'mode = test' : 'Readme in container'
        const buf = new TextEncoder().encode(text).buffer
        this.onmessage?.({
          data: {
            id: msg.id,
            type: 'read',
            fileId: msg.fileId,
            buffer: buf
          }
        } as any)
      }, 10)
    } else if (msg.type === 'readMultiple') {
      setTimeout(() => {
        const files = msg.fileIds.map((id: number) => ({
          fileId: id,
          buffer: new TextEncoder().encode(id === 0 ? 'mode = test' : 'Readme in container').buffer
        }))
        this.onmessage?.({
          data: {
            id: msg.id,
            type: 'readMultiple',
            files
          }
        } as any)
      }, 10)
    } else if (msg.type === 'zip') {
      setTimeout(() => {
        this.onmessage?.({
          data: {
            id: msg.id,
            type: 'zip',
            buffer: new Uint8Array([80, 75, 5, 6]).buffer
          }
        } as any)
      }, 10)
    }
  }

  terminate() {}
}

describe('OptDocumentView', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', MockWorker)
  })

  const mockNode: FileNode = {
    id: 'node-opt-1',
    parentId: null,
    name: 'archive.opt',
    kind: 'file',
    order: 0,
    source: 'picker'
  }

  const mockContent: FileContent = {
    fileId: 'node-opt-1',
    text: '',
    contentKind: 'opt',
    mediaBlob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/x-fscrypt-opt' }),
    version: 1,
    status: 'synced'
  }

  const registerController = vi.fn()

  it('renders opt document view and previews selected file', async () => {
    render(
      <OptDocumentView
        fileId="node-opt-1"
        node={mockNode}
        content={mockContent}
        updateText={vi.fn()}
        registerController={registerController}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('opt-document-view')).toBeInTheDocument()
      expect(screen.getByText('data.conf')).toBeInTheDocument()
      expect(screen.getByText('docs')).toBeInTheDocument()
    })

    // Click data.conf to preview text
    const dataConfEntry = screen.getByText('data.conf')
    fireEvent.click(dataConfEntry)

    await waitFor(() => {
      expect(screen.getByText('mode = test')).toBeInTheDocument()
    })
  })

  it('filters entries when typing into search input', async () => {
    render(
      <OptDocumentView
        fileId="node-opt-1"
        node={mockNode}
        content={mockContent}
        updateText={vi.fn()}
        registerController={registerController}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('data.conf')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/filter/i)
    fireEvent.change(searchInput, { target: { value: 'readme' } })

    expect(screen.getAllByText('readme.txt')[0]).toBeInTheDocument()
    expect(screen.queryByText('data.conf')).not.toBeInTheDocument()
  })

  it('handles checkbox selection for batch operations', async () => {
    render(
      <OptDocumentView
        fileId="node-opt-1"
        node={mockNode}
        content={mockContent}
        updateText={vi.fn()}
        registerController={registerController}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('data.conf')).toBeInTheDocument()
    })

    const selectButtons = screen.getAllByLabelText(/select/i)
    fireEvent.click(selectButtons[0])

    await waitFor(() => {
      expect(screen.getByText(/download selected/i)).toBeInTheDocument()
    })
  })

  it('extracts all entries to workspace when extract button is clicked', async () => {
    render(
      <OptDocumentView
        fileId="node-opt-1"
        node={mockNode}
        content={mockContent}
        updateText={vi.fn()}
        registerController={registerController}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('data.conf')).toBeInTheDocument()
    })

    const extractBtn = screen.getByRole('button', { name: /extract all to workspace|全部解压到工作区/i })
    expect(extractBtn).toBeInTheDocument()
    fireEvent.click(extractBtn)
  })
})
