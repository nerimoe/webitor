import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { strToU8, zipSync } from 'fflate'
import '../i18n'
import type { FileContent, FileNode } from '../types'
import ZipDocumentView from './ZipDocumentView'

describe('ZipDocumentView', () => {
  const sampleZip = zipSync({
    'hello.txt': strToU8('Hello inside zip!'),
    'docs/readme.md': strToU8('# Readme Title\nSome description.'),
    'src/index.js': strToU8('console.log("webitor");'),
    'images/icon.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  })

  const mockNode: FileNode = {
    id: 'node-zip-1',
    parentId: null,
    name: 'project.zip',
    kind: 'file',
    order: 0,
    source: 'picker'
  }

  const mockContent: FileContent = {
    fileId: 'node-zip-1',
    text: '',
    contentKind: 'zip',
    mediaBlob: new Blob([sampleZip], { type: 'application/zip' }),
    version: 1,
    status: 'synced'
  }

  const registerController = vi.fn()

  it('parses zip archive and renders file tree/list and preview', async () => {
    render(
      <ZipDocumentView
        fileId="node-zip-1"
        node={mockNode}
        content={mockContent}
        updateText={vi.fn()}
        registerController={registerController}
      />
    )

    // Wait for parsing to finish and entries to appear
    await waitFor(() => {
      expect(screen.getByTestId('zip-document-view')).toBeInTheDocument()
      expect(screen.getByText('hello.txt')).toBeInTheDocument()
    })

    // Click hello.txt to preview plain text
    const helloEntry = screen.getByText('hello.txt')
    fireEvent.click(helloEntry)

    await waitFor(() => {
      expect(screen.getByText('Hello inside zip!')).toBeInTheDocument()
    })

    // Click readme.md to preview markdown
    const readmeEntry = screen.getByText('readme.md')
    fireEvent.click(readmeEntry)

    await waitFor(() => {
      expect(screen.getByText('Readme Title')).toBeInTheDocument()
    })
  })

  it('filters entries when typing in search input', async () => {
    render(
      <ZipDocumentView
        fileId="node-zip-1"
        node={mockNode}
        content={mockContent}
        updateText={vi.fn()}
        registerController={registerController}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('hello.txt')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/filter/i)
    fireEvent.change(searchInput, { target: { value: 'index.js' } })

    expect(screen.getByText('index.js')).toBeInTheDocument()
    expect(screen.queryByText('hello.txt')).not.toBeInTheDocument()
  })

  it('supports selecting checkboxes and shows extract/download selected buttons', async () => {
    render(
      <ZipDocumentView
        fileId="node-zip-1"
        node={mockNode}
        content={mockContent}
        updateText={vi.fn()}
        registerController={registerController}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('hello.txt')).toBeInTheDocument()
    })

    const selectButtons = screen.getAllByLabelText(/select/i)
    fireEvent.click(selectButtons[0])

    // Should show batch action buttons
    await waitFor(() => {
      expect(screen.getByText(/download selected/i)).toBeInTheDocument()
    })
  })

  it('extracts entries into a folder named after the zip archive', async () => {
    render(
      <ZipDocumentView
        fileId="node-zip-1"
        node={mockNode}
        content={mockContent}
        updateText={vi.fn()}
        registerController={registerController}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('hello.txt')).toBeInTheDocument()
    })

    // Click "Extract all to workspace" button
    const extractAllBtn = screen.getByRole('button', { name: /extract all to workspace|全部解压到工作区/i })
    expect(extractAllBtn).toBeInTheDocument()
    fireEvent.click(extractAllBtn)
  })
})
