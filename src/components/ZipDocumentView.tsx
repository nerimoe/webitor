import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Archive, CheckSquare, ChevronDown, ChevronRight, Copy, Download,
  FileCode, FileImage, FileMusic, FileText, FileVideo, FileWarning,
  Folder, FolderInput, FolderOpen, LoaderCircle, Search, Square, X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DocumentViewProps } from '../documentFormats/types'
import { useImportWorkflow, type ImportItem } from '../hooks/useImportWorkflow'
import { contentMediaBlob, downloadBlob } from '../lib/files'
import {
  createZipBlob, decodeZipText, formatBytes, getFileExtension,
  inferEntryKind, inferMimeType, isProbablyUtf8, parseZipArchive,
  type ZipEntry, type ZipEntryKind
} from '../lib/zip'
import { ImagePreview } from './ImagePreview'
import { MarkdownPreview } from './MarkdownPreview'

function getEntryIcon(entry: ZipEntry, kind: ZipEntryKind, isOpen: boolean) {
  if (entry.dir) return isOpen ? FolderOpen : Folder
  switch (kind) {
    case 'image': return FileImage
    case 'video': return FileVideo
    case 'audio': return FileMusic
    case 'markdown':
    case 'text': {
      const ext = getFileExtension(entry.name)
      if (['js', 'ts', 'jsx', 'tsx', 'json', 'py', 'c', 'cpp', 'rs', 'go', 'html', 'css', 'xml', 'yaml', 'yml'].includes(ext)) {
        return FileCode
      }
      return FileText
    }
    case 'zip': return Archive
    default: return FileText
  }
}

export default function ZipDocumentView({ content, node, registerController }: DocumentViewProps) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [entries, setEntries] = useState<ZipEntry[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [activePath, setActivePath] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [copySuccess, setCopySuccess] = useState(false)
  const { conflict, applyConflictToAll, setApplyConflictToAll, finishConflict, importItems } = useImportWorkflow()

  useEffect(() => {
    registerController(null)
  }, [registerController])

  useEffect(() => {
    let active = true
    setPhase('loading')
    setActivePath(null)
    setSelectedPaths(new Set())

    const loadArchive = async () => {
      try {
        const blob = contentMediaBlob(content)
        const buffer = await blob.arrayBuffer()
        if (!active) return
        const parsed = await parseZipArchive(buffer)
        if (!active) return
        setEntries(parsed)

        // Expand root/first-level directories by default
        const initialExpanded = new Set<string>()
        parsed.forEach((entry) => {
          if (entry.dir && entry.depth <= 1) initialExpanded.add(entry.path)
        })
        setExpandedDirs(initialExpanded)

        // Pre-select the first file if available
        const firstFile = parsed.find((e) => !e.dir)
        if (firstFile) setActivePath(firstFile.path)

        setPhase('ready')
      } catch (error) {
        console.error('Failed to parse ZIP archive:', error)
        if (active) setPhase('failed')
      }
    }

    void loadArchive()
    return () => {
      active = false
    }
  }, [content])

  const activeEntry = useMemo(
    () => entries.find((e) => e.path === activePath) ?? null,
    [entries, activePath]
  )

  const activeKind = useMemo(
    () => (activeEntry && !activeEntry.dir ? inferEntryKind(activeEntry.name) : null),
    [activeEntry]
  )

  // Filtered entries for search / filter
  const filteredEntries = useMemo(() => {
    if (!filterText.trim()) return entries
    const lower = filterText.trim().toLowerCase()
    return entries.filter((e) => e.path.toLowerCase().includes(lower))
  }, [entries, filterText])

  // Visible entries in tree view when not searching
  const visibleTreeEntries = useMemo(() => {
    if (filterText.trim()) return filteredEntries
    return entries.filter((entry) => {
      if (entry.depth === 0) return true
      const parts = entry.path.split('/')
      let ancestor = ''
      for (let i = 0; i < parts.length - 1; i += 1) {
        ancestor = ancestor ? `${ancestor}/${parts[i]}` : parts[i]
        if (!expandedDirs.has(ancestor)) return false
      }
      return true
    })
  }, [entries, expandedDirs, filterText, filteredEntries])

  const totalFiles = useMemo(() => entries.filter((e) => !e.dir).length, [entries])
  const totalBytes = useMemo(() => entries.filter((e) => !e.dir).reduce((sum, e) => sum + e.size, 0), [entries])

  // Toggle directory expanded
  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  // Toggle single selection
  const toggleSelect = useCallback((path: string, event?: React.MouseEvent) => {
    event?.stopPropagation()
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  // Toggle select all
  const toggleSelectAll = useCallback(() => {
    if (selectedPaths.size === entries.length) {
      setSelectedPaths(new Set())
    } else {
      setSelectedPaths(new Set(entries.map((e) => e.path)))
    }
  }, [entries, selectedPaths.size])

  // Extract selected / specific entries to workspace
  const extractToWorkspace = useCallback(async (targetEntries: ZipEntry[]) => {
    if (!targetEntries.length) return
    const items: ImportItem[] = targetEntries.map((e) => {
      const parts = e.path.split('/')
      const name = parts.pop()!
      const folderPath = parts

      if (e.dir) {
        return { kind: 'directory', path: [...folderPath, name] }
      }

      const kind = inferEntryKind(name)
      const isText = kind === 'text' || kind === 'markdown' || isProbablyUtf8(e.data)
      const mimeType = inferMimeType(name)

      return {
        kind: 'decoded',
        name,
        text: isText ? decodeZipText(e.data) : '',
        mediaBlob: isText ? undefined : new Blob([e.data as BlobPart], { type: mimeType }),
        mimeType,
        contentKind: isText ? 'text' : kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind === 'zip' ? 'zip' : 'binary',
        path: folderPath,
        source: 'picker'
      }
    })

    await importItems(items, 'list')
  }, [importItems])

  // Download specific or selected entries
  const downloadEntries = useCallback((targetEntries: ZipEntry[], defaultName = node.name) => {
    const fileEntries = targetEntries.filter((e) => !e.dir)
    if (!fileEntries.length) return

    if (fileEntries.length === 1) {
      const single = fileEntries[0]
      downloadBlob(new Blob([single.data as BlobPart], { type: inferMimeType(single.name) }), single.name)
      return
    }

    const zipRecords: Record<string, Uint8Array> = {}
    for (const e of fileEntries) {
      zipRecords[e.path] = e.data
    }
    const archiveBase = defaultName.replace(/\.zip$/i, '')
    downloadBlob(createZipBlob(zipRecords), `${archiveBase}-extracted.zip`)
  }, [node.name])

  // Copy active text content
  const handleCopy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    })
  }, [])

  if (phase === 'loading') {
    return (
      <div className="document-view-loading zip-loading" role="status">
        <LoaderCircle className="spin" size={32} />
        <span>{t('zipParsing')}</span>
      </div>
    )
  }

  if (phase === 'failed') {
    return (
      <div className="media-preview-unavailable" role="status">
        <FileWarning size={36} />
        <span>{t('zipParseFailed')}</span>
      </div>
    )
  }

  const selectedCount = selectedPaths.size
  const isAllSelected = entries.length > 0 && selectedCount === entries.length
  const selectedEntries = entries.filter((e) => selectedPaths.has(e.path))

  return (
    <div className="zip-document-view" data-testid="zip-document-view">
      {/* Left Pane: Archive File List / Tree */}
      <aside className="zip-sidebar">
        {/* Top Search Bar */}
        <div className="zip-search-bar">
          <Search size={16} className="zip-search-icon" />
          <input
            type="text"
            placeholder={t('searchZipEntries')}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="zip-search-input"
          />
          {filterText && (
            <button
              className="zip-search-clear"
              onClick={() => setFilterText('')}
              aria-label={t('clearSearch')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Action Toolbar */}
        <div className="zip-toolbar">
          <div className="zip-toolbar-left">
            <button
              className="zip-toolbar-button"
              onClick={toggleSelectAll}
              title={isAllSelected ? t('deselectAll') : t('selectAll')}
            >
              {isAllSelected ? <CheckSquare size={16} /> : <Square size={16} />}
              <span>{isAllSelected ? t('deselectAll') : t('selectAll')}</span>
            </button>
            <span className="zip-stats-summary">
              {t('entryCount', { count: totalFiles })} · {formatBytes(totalBytes)}
            </span>
          </div>

          <div className="zip-toolbar-actions">
            {selectedCount > 0 && (
              <>
                <button
                  className="zip-action-btn primary"
                  onClick={() => void extractToWorkspace(selectedEntries)}
                  title={t('extractSelectedToWorkspace', { count: selectedCount })}
                >
                  <FolderInput size={15} />
                  <span>{t('extractSelected', { count: selectedCount })}</span>
                </button>
                <button
                  className="zip-action-btn secondary"
                  onClick={() => downloadEntries(selectedEntries)}
                  title={t('downloadSelected')}
                >
                  <Download size={15} />
                  <span>{t('downloadSelected')}</span>
                </button>
              </>
            )}
            {selectedCount === 0 && (
              <button
                className="zip-action-btn secondary"
                onClick={() => void extractToWorkspace(entries)}
                title={t('extractAllToWorkspace')}
              >
                <FolderInput size={15} />
                <span>{t('extractAllToWorkspace')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Tree / Flat List of Entries */}
        <div className="zip-list-scroll">
          {visibleTreeEntries.length === 0 ? (
            <div className="zip-empty-list">{t('noResults')}</div>
          ) : (
            visibleTreeEntries.map((entry) => {
              const isSelected = selectedPaths.has(entry.path)
              const isActive = activePath === entry.path
              const isOpen = expandedDirs.has(entry.path)
              const kind = entry.dir ? 'text' : inferEntryKind(entry.name)
              const Icon = getEntryIcon(entry, kind, isOpen)

              return (
                <div
                  key={entry.path}
                  className={`zip-entry-row ${isActive ? 'active' : ''} ${entry.dir ? 'is-dir' : ''}`}
                  style={{ paddingLeft: filterText ? 12 : 8 + entry.depth * 16 }}
                  onClick={() => {
                    if (entry.dir && !filterText) toggleDir(entry.path)
                    setActivePath(entry.path)
                  }}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      if (entry.dir && !filterText) toggleDir(entry.path)
                      setActivePath(entry.path)
                    }
                  }}
                >
                  <button
                    className={`zip-entry-check ${isSelected ? 'checked' : ''}`}
                    onClick={(e) => toggleSelect(entry.path, e)}
                    aria-label={isSelected ? t('deselect') : t('select')}
                  >
                    {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>

                  {!filterText && entry.dir ? (
                    <button
                      className="zip-chevron-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleDir(entry.path)
                      }}
                      aria-label={isOpen ? t('collapse') : t('expand')}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  ) : !filterText ? (
                    <span className="zip-entry-spacer" />
                  ) : null}

                  <Icon
                    size={16}
                    className={`zip-entry-icon ${entry.dir ? 'folder' : kind}`}
                  />
                  <span className="zip-entry-name" title={entry.path}>
                    {entry.name}
                  </span>
                  {!entry.dir && (
                    <span className="zip-entry-size">{formatBytes(entry.size)}</span>
                  )}
                </div>
              )
            })
          )}
        </div>
      </aside>

      {/* Right Pane: File Preview */}
      <main className="zip-preview-pane">
        {activeEntry ? (
          <EntryPreviewArea
            entry={activeEntry}
            kind={activeKind}
            archiveName={node.name}
            onExtract={() => {
              if (activeEntry.dir) {
                const subEntries = entries.filter((e) => e.path === activeEntry.path || e.path.startsWith(`${activeEntry.path}/`))
                void extractToWorkspace(subEntries)
              } else {
                void extractToWorkspace([activeEntry])
              }
            }}
            onDownload={() => {
              if (activeEntry.dir) {
                const subEntries = entries.filter((e) => e.path === activeEntry.path || e.path.startsWith(`${activeEntry.path}/`))
                downloadEntries(subEntries, `${activeEntry.name}.zip`)
              } else {
                downloadEntries([activeEntry])
              }
            }}
            onCopy={handleCopy}
            copySuccess={copySuccess}
          />
        ) : (
          <div className="zip-empty-preview">
            <Archive size={48} className="zip-empty-icon" />
            <h3>{node.name}</h3>
            <p>{t('entryCount', { count: totalFiles })} · {formatBytes(totalBytes)}</p>
            <div className="zip-empty-actions">
              <button
                className="primary-button"
                onClick={() => void extractToWorkspace(entries)}
              >
                <FolderInput size={18} />
                {t('extractAllToWorkspace')}
              </button>
              <button
                className="secondary-button"
                onClick={() => downloadEntries(entries)}
              >
                <Download size={18} />
                {t('downloadAll')}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Conflict Resolution Dialog */}
      <Dialog.Root open={Boolean(conflict)} onOpenChange={(open) => { if (!open && conflict) finishConflict('skip') }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>{t('collisionTitle')}</Dialog.Title>
            <Dialog.Description>{t('collisionBody', { name: conflict?.name })}</Dialog.Description>
            <label className="dialog-check">
              <input
                type="checkbox"
                checked={applyConflictToAll}
                onChange={(e) => setApplyConflictToAll(e.target.checked)}
              />
              {t('applyAll')}
            </label>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => finishConflict('skip')}>{t('skip')}</button>
              <button className="secondary-button" onClick={() => finishConflict('copy')}>{t('keepBoth')}</button>
              <button className="primary-button" onClick={() => finishConflict('overwrite')}>{t('overwrite')}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function EntryPreviewArea({
  entry,
  kind,
  onExtract,
  onDownload,
  onCopy,
  copySuccess
}: {
  entry: ZipEntry
  kind: ZipEntryKind | null
  archiveName: string
  onExtract: () => void
  onDownload: () => void
  onCopy: (text: string) => void
  copySuccess: boolean
}) {
  const { t } = useTranslation()
  const [mediaUrl, setMediaUrl] = useState<string>('')
  const [decodedText, setDecodedText] = useState<string>('')
  const [isTextDecodable, setIsTextDecodable] = useState(false)

  useEffect(() => {
    if (entry.dir) {
      setMediaUrl('')
      setDecodedText('')
      setIsTextDecodable(false)
      return
    }

    const mime = inferMimeType(entry.name)
    const currentKind = kind ?? inferEntryKind(entry.name)

    if (currentKind === 'image' || currentKind === 'video' || currentKind === 'audio') {
      const blob = new Blob([entry.data as BlobPart], { type: mime })
      const url = URL.createObjectURL(blob)
      setMediaUrl(url)
      setDecodedText('')
      setIsTextDecodable(false)
      return () => URL.revokeObjectURL(url)
    }

    if (currentKind === 'text' || currentKind === 'markdown' || isProbablyUtf8(entry.data)) {
      setMediaUrl('')
      const text = decodeZipText(entry.data)
      setDecodedText(text)
      setIsTextDecodable(true)
    } else {
      setMediaUrl('')
      setDecodedText('')
      setIsTextDecodable(false)
    }
  }, [entry, kind])

  const Icon = getEntryIcon(entry, kind ?? 'text', false)

  return (
    <div className="zip-preview-wrapper">
      {/* Preview Header */}
      <header className="zip-preview-header">
        <div className="zip-preview-info">
          <Icon size={20} className="zip-preview-info-icon" />
          <div className="zip-preview-titles">
            <h4 className="zip-preview-name">{entry.name}</h4>
            <span className="zip-preview-path">{entry.path} · {formatBytes(entry.size)}</span>
          </div>
        </div>

        <div className="zip-preview-actions">
          {isTextDecodable && (
            <button
              className="zip-action-btn secondary"
              onClick={() => onCopy(decodedText)}
              title={copySuccess ? t('copied') : t('copyContent')}
            >
              <Copy size={15} />
              <span>{copySuccess ? t('copied') : t('copy')}</span>
            </button>
          )}
          <button
            className="zip-action-btn secondary"
            onClick={onExtract}
            title={t('extractToWorkspace')}
          >
            <FolderInput size={15} />
            <span>{t('extractToWorkspace')}</span>
          </button>
          <button
            className="zip-action-btn secondary"
            onClick={onDownload}
            title={t('download')}
          >
            <Download size={15} />
            <span>{t('download')}</span>
          </button>
        </div>
      </header>

      {/* Preview Body */}
      <div className="zip-preview-body">
        {entry.dir ? (
          <div className="zip-dir-preview">
            <FolderOpen size={48} className="zip-dir-icon" />
            <h4>{entry.name}</h4>
            <p className="zip-dir-path">{entry.path}</p>
            <div className="zip-dir-actions">
              <button className="primary-button" onClick={onExtract}>
                <FolderInput size={16} />
                {t('extractFolderToWorkspace')}
              </button>
              <button className="secondary-button" onClick={onDownload}>
                <Download size={16} />
                {t('downloadFolder')}
              </button>
            </div>
          </div>
        ) : kind === 'image' && mediaUrl ? (
          <div className="zip-image-preview">
            <ImagePreview src={mediaUrl} name={entry.name} />
          </div>
        ) : kind === 'video' && mediaUrl ? (
          <div className="zip-media-container video-preview">
            <video controls src={mediaUrl} className="zip-video-element" />
          </div>
        ) : kind === 'audio' && mediaUrl ? (
          <div className="zip-audio-container">
            <FileMusic size={48} className="zip-audio-icon" />
            <audio controls src={mediaUrl} className="zip-audio-element" />
          </div>
        ) : kind === 'markdown' && isTextDecodable ? (
          <div className="zip-markdown-container">
            <MarkdownPreview value={decodedText} />
          </div>
        ) : isTextDecodable ? (
          <div className="zip-code-container">
            <pre className="zip-code-pre">
              <code>{decodedText}</code>
            </pre>
          </div>
        ) : (
          <div className="zip-binary-preview">
            <FileWarning size={48} className="zip-binary-icon" />
            <h4>{entry.name}</h4>
            <p>{t('zipBinaryPreviewUnavailable')}</p>
            <p className="zip-binary-size">{formatBytes(entry.size)}</p>
            <div className="zip-binary-actions">
              <button className="primary-button" onClick={onExtract}>
                <FolderInput size={16} />
                {t('extractToWorkspace')}
              </button>
              <button className="secondary-button" onClick={onDownload}>
                <Download size={16} />
                {t('download')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
