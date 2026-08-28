import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '../i18n'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { FileContent, FileNode } from '../types'
import DdsDocumentView from './DdsDocumentView'

function createSampleDdsBuffer(): ArrayBuffer {
  const buffer = new ArrayBuffer(128 + 16)
  const view = new DataView(buffer)
  // Magic: 'DDS '
  view.setUint32(0, 0x20534444, true)
  view.setUint32(4, 124, true)
  view.setUint32(8, 0x1007, true)
  view.setUint32(12, 4, true) // height
  view.setUint32(16, 4, true) // width
  view.setUint32(28, 1, true) // mipmaps

  // ddspf
  view.setUint32(76, 32, true)
  view.setUint32(80, 0x41, true) // DDPF_RGB | DDPF_ALPHAPIXELS
  view.setUint32(88, 32, true)
  view.setUint32(92, 0x000000ff, true)
  view.setUint32(96, 0x0000ff00, true)
  view.setUint32(100, 0x00ff0000, true)
  view.setUint32(104, 0xff000000, true)

  return buffer
}

describe('DdsDocumentView', () => {
  const mockNode: FileNode = {
    id: 'node-dds-1',
    parentId: null,
    name: 'diffuse.dds',
    kind: 'file',
    order: 0,
    source: 'picker'
  }

  const mockContent: FileContent = {
    fileId: 'node-dds-1',
    text: '',
    contentKind: 'image',
    mediaBlob: new Blob([createSampleDdsBuffer()], { type: 'image/vnd-ms.dds' }),
    version: 1,
    status: 'synced'
  }

  const registerController = vi.fn()

  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn()
    HTMLElement.prototype.scrollBy = vi.fn()

    // Mock HTMLCanvasElement in JSDOM
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      putImageData: vi.fn(),
      getImageData: vi.fn()
    })
    HTMLCanvasElement.prototype.toBlob = vi.fn(function (cb) {
      cb(new Blob(['fake-png'], { type: 'image/png' }))
    })
  })

  it('decodes DDS file, displays dimensions and format badges, and renders preview', async () => {
    render(
      <Tooltip.Provider>
        <DdsDocumentView
          fileId="node-dds-1"
          node={mockNode}
          content={mockContent}
          updateText={vi.fn()}
          registerController={registerController}
        />
      </Tooltip.Provider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('dds-document-view')).toBeInTheDocument()
    })

    // Check badges
    expect(screen.getByText('32-bit RGBA')).toBeInTheDocument()
    expect(screen.getByText('4 × 4')).toBeInTheDocument()

    // Check convert buttons
    expect(screen.getByRole('button', { name: /Save PNG to workspace|转换为 PNG 并保存到工作区/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download PNG|下载 PNG/ })).toBeInTheDocument()
  })
})
