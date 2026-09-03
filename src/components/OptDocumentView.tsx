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
import { decodeDds } from '../lib/dds'
import { contentMediaBlob, downloadBlob } from '../lib/files'
import {
  buildOptTree, formatBytes, getFileExtension, inferEntryKind, inferMimeType,
  OptArchiveClient, type OptEntry
} from '../lib/opt'
import { createZipBlob, decodeZipText, isProbablyUtf8, type ZipEntryKind } from '../lib/zip'
import { ImagePreview } from './ImagePreview'
import { MarkdownPreview } from './MarkdownPreview'

function getEntryIcon(entry: OptEntry, kind: ZipEntryKind, isOpen: boolean) {
  if (entry.dir) return isOpen ? FolderOpen : Folder
  switch (kind) {
    case 'image': return FileImage
    case 'video': return FileVideo
    case 'audio': return FileMusic
    case 'markdown':
    case 'text': {
      const ext = getFileExtension(entry.name)
      if (['js', 'ts', 'jsx', 'tsx', 'json', 'py', 'c', 'cpp', 'rs', 'go', 'html', 'css', 'xml', 'yaml', 'yml', 'conf', 'ini'].includes(ext)) {
        return FileCode
      }
      return FileText
    }
    case 'zip': return Archive
    default: return FileText
  }
}

export default function OptDocumentView({ content, node, registerController }: DocumentViewProps) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [entries, setEntries] = useState<OptEntry[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [activePath, setActivePath] = useState<string | null>(null)
  const [activeData, setActiveData] = useState<Uint8Array | null>(null)
  const [isLoadingEntry, setIsLoadingEntry] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [copySuccess, setCopySuccess] = useState(false)
  const [isBuildingZip, setIsBuildingZip] = useState(false)

  const clientRef = useRef<OptArchiveClient | null>(null)
  const fileDataCache = useRef<Map<number, Uint8Array>>(new Map())
  const { conflict, applyConflictToAll, setApplyConflictToAll, finishConflict, importItems } = useImportWorkflow()

  useEffect(() => {
    registerController(null)
  }, [registerController])

  useEffect(() => {
    let active = true
    setPhase('loading')
    setActivePath(null)
    setActiveData(null)
    setSelectedPaths(new Set())
    setExpandedDirs(new Set())
    fileDataCache.current.clear()

    if (clientRef.current) {
      clientRef.current.terminate()
      clientRef.current = null
    }

    const worker = new Worker(new URL('../workers/optDecoder.worker.ts', import.meta.url), { type: 'module' })
    const client = new OptArchiveClient(worker)
    clientRef.current = client

    const loadContainer = async () => {
      try {
        const blob = contentMediaBlob(content)
        const buffer = await blob.arrayBuffer()
        if (!active) return

        const rawFiles = await client.open(buffer)
        if (!active) return

        const parsed = buildOptTree(rawFiles)
        if (!active) return
        setEntries(parsed)

        const firstFile = parsed.find((e) => !e.dir)
        if (firstFile) setActivePath(firstFile.path)

        setPhase('ready')
      } catch (error) {
        console.error('Failed to open OPT container:', error)
        if (active) setPhase('failed')
      }
    }

    void loadContainer()

    return () => {
      active = false
      client.terminate()
      if (clientRef.current === client) {
        clientRef.current = null
      }
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

  // Load active file content on demand
  useEffect(() => {
    let active = true
    if (!activeEntry || activeEntry.dir || activeEntry.id === undefined) {
      setActiveData(null)
      setIsLoadingEntry(false)
      return
    }

    const cached = fileDataCache.current.get(activeEntry.id)
    if (cached) {
      setActiveData(cached)
      setIsLoadingEntry(false)
      return
    }

    const client = clientRef.current
    if (!client) return

    setIsLoadingEntry(true)
    const fileId = activeEntry.id

    void client.readFile(fileId).then((bytes) => {
      if (!active) return
      fileDataCache.current.set(fileId, bytes)
      setActiveData(bytes)
      setIsLoadingEntry(false)
    }).catch((error) => {
      console.error('Failed to read OPT file entry:', error)
      if (active) {
        setActiveData(null)
        setIsLoadingEntry(false)
      }
    })

    return () => {
      active = false
    }
  }, [activeEntry])

  const filteredEntries = useMemo(() => {
    if (!filterText.trim()) return entries
    const lower = filterText.trim().toLowerCase()
    return entries.filter((e) => e.path.toLowerCase().includes(lower))
  }, [entries, filterText])

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

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const toggleSelect = useCallback((path: string, event?: React.MouseEvent) => {
    event?.stopPropagation()
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (selectedPaths.size === entries.length) {
      setSelectedPaths(new Set())
    } else {
      setSelectedPaths(new Set(entries.map((e) => e.path)))
    }
  }, [entries, selectedPaths.size])

  // Extract selected or specified entries to workspace
  const extractToWorkspace = useCallback(async (targetEntries: OptEntry[]) => {
    const client = clientRef.current
    if (!targetEntries.length || !client) return

    const archiveFolder = node.name.replace(/\.opt$/i, '') || node.name
    const fileEntries = targetEntries.filter((e) => !e.dir && e.id !== undefined)

    // Find entries that need to be read
    const missingIds = fileEntries.filter((e) => !fileDataCache.current.has(e.id!)).map((e) => e.id!)
    if (missingIds.length > 0) {
      const loaded = await client.readMultiple(missingIds)
      for (const [id, bytes] of loaded.entries()) {
        fileDataCache.current.set(id, bytes)
      }
    }

    const items: ImportItem[] = [
      { kind: 'directory', path: [archiveFolder] }
    ]

    for (const e of targetEntries) {
      const parts = e.path.split('/')
      const name = parts.pop()!
      const folderPath = [archiveFolder, ...parts]

      if (e.dir) {
        items.push({ kind: 'directory', path: [...folderPath, name] })
      } else {
        const data = fileDataCache.current.get(e.id!)
        if (!data) continue

        const kind = inferEntryKind(name)
        const isText = kind === 'text' || kind === 'markdown' || isProbablyUtf8(data)
        const mimeType = inferMimeType(name)

        items.push({
          kind: 'decoded',
          name,
          text: isText ? decodeZipText(data) : '',
          mediaBlob: isText ? undefined : new Blob([data as BlobPart], { type: mimeType }),
          mimeType,
          contentKind: isText ? 'text' : kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind === 'zip' ? 'zip' : 'binary',
          path: folderPath,
          source: 'picker'
        })
      }
    }

    await importItems(items, 'list')
  }, [node.name, importItems])

  // Download entries as files or zip
  const downloadEntries = useCallback(async (targetEntries: OptEntry[], defaultName = node.name) => {
    const client = clientRef.current
    if (!client) return

    const fileEntries = targetEntries.filter((e) => !e.dir && e.id !== undefined)
    if (!fileEntries.length) return

    if (fileEntries.length === 1) {
      const single = fileEntries[0]
      let data = fileDataCache.current.get(single.id!)
      if (!data) {
        data = await client.readFile(single.id!)
        fileDataCache.current.set(single.id!, data)
      }
      downloadBlob(new Blob([data as BlobPart], { type: inferMimeType(single.name) }), single.name)
      return
    }

    // If all files in container are to be downloaded, use fast WASM create_store_zip
    if (fileEntries.length === totalFiles) {
      setIsBuildingZip(true)
      try {
        const zipBytes = await client.createZip()
        const archiveBase = defaultName.replace(/\.opt$/i, '')
        downloadBlob(new Blob([zipBytes as BlobPart], { type: 'application/zip' }), `${archiveBase}.zip`)
      } finally {
        setIsBuildingZip(false)
      }
      return
    }

    // Otherwise load missing entries and create zip
    const missingIds = fileEntries.filter((e) => !fileDataCache.current.has(e.id!)).map((e) => e.id!)
    if (missingIds.length > 0) {
      const loaded = await client.readMultiple(missingIds)
      for (const [id, bytes] of loaded.entries()) {
        fileDataCache.current.set(id, bytes)
      }
    }

    const zipRecords: Record<string, Uint8Array> = {}
    for (const e of fileEntries) {
      const data = fileDataCache.current.get(e.id!)
      if (data) zipRecords[e.path] = data
    }
    const archiveBase = defaultName.replace(/\.opt$/i, '')
    downloadBlob(createZipBlob(zipRecords), `${archiveBase}-extracted.zip`)
  }, [node.name, totalFiles])

  // Download entire container as zip
  const handleDownloadFullZip = useCallback(async () => {
    const client = clientRef.current
    if (!client || isBuildingZip) return
    setIsBuildingZip(true)
    try {
      const zipBytes = await client.createZip()
      const archiveBase = node.name.replace(/\.opt$/i, '')
      downloadBlob(new Blob([zipBytes as BlobPart], { type: 'application/zip' }), `${archiveBase}.zip`)
    } catch (e) {
      console.error('Failed to create ZIP from OPT:', e)
    } finally {
      setIsBuildingZip(false)
    }
  }, [node.name, isBuildingZip])

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
        <span>{t('optParsing')}</span>
      </div>
    )
  }

  if (phase === 'failed') {
    return (
      <div className="media-preview-unavailable" role="status">
        <FileWarning size={36} />
        <span>{t('optParseFailed')}</span>
        <button
          className="secondary-button"
          style={{ marginTop: 16 }}
          onClick={() => {
            try {
              const blob = contentMediaBlob(content)
              downloadBlob(blob, node.name)
            } catch (e) {
              console.error(e)
            }
          }}
        >
          <Download size={16} />
          <span>{t('download')}</span>
        </button>
      </div>
    )
  }

  const selectedCount = selectedPaths.size
  const isAllSelected = entries.length > 0 && selectedCount === entries.length
  const selectedEntries = entries.filter((e) => selectedPaths.has(e.path))

  return (
    <div className="zip-document-view opt-document-view" data-testid="opt-document-view">
      {/* Left Pane: Archive File List / Tree */}
      <aside className="zip-sidebar">
        {/* Top Search Bar */}
        <div className="zip-search-bar">
          <Search size={16} className="zip-search-icon" />
          <input
            type="text"
            placeholder={t('searchOptEntries')}
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
                  onClick={() => void downloadEntries(selectedEntries)}
                  title={t('downloadSelected')}
                >
                  <Download size={15} />
                  <span>{t('downloadSelected')}</span>
                </button>
              </>
            )}
            {selectedCount === 0 && (
              <>
                <button
                  className="zip-action-btn secondary"
                  onClick={() => void extractToWorkspace(entries)}
                  title={t('extractAllToWorkspace')}
                >
                  <FolderInput size={15} />
                  <span>{t('extractAllToWorkspace')}</span>
                </button>
                <button
                  className="zip-action-btn secondary"
                  onClick={() => void handleDownloadFullZip()}
                  disabled={isBuildingZip}
                  title={t('downloadZip')}
                >
                  {isBuildingZip ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
                  <span>{isBuildingZip ? t('buildingZip') : t('downloadZip')}</span>
                </button>
              </>
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
          <OptEntryPreviewArea
            entry={activeEntry}
            data={activeData}
            isLoading={isLoadingEntry}
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
                void downloadEntries(subEntries, `${activeEntry.name}.zip`)
              } else {
                void downloadEntries([activeEntry])
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
                onClick={() => void handleDownloadFullZip()}
                disabled={isBuildingZip}
              >
                {isBuildingZip ? <LoaderCircle size={18} className="spin" /> : <Download size={18} />}
                {isBuildingZip ? t('buildingZip') : t('downloadZip')}
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

function OptEntryPreviewArea({
  entry,
  data,
  isLoading,
  kind,
  onExtract,
  onDownload,
  onCopy,
  copySuccess
}: {
  entry: OptEntry
  data: Uint8Array | null
  isLoading: boolean
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
    if (entry.dir || !data) {
      setMediaUrl('')
      setDecodedText('')
      setIsTextDecodable(false)
      return
    }

    const mime = inferMimeType(entry.name)
    const currentKind = kind ?? inferEntryKind(entry.name)

    if (entry.name.toLowerCase().endsWith('.dds')) {
      let active = true
      let url = ''
      try {
        const decoded = decodeDds(data)
        void decoded.toPngBlob().then((blob) => {
          if (!active) return
          url = URL.createObjectURL(blob)
          setMediaUrl(url)
          setDecodedText('')
          setIsTextDecodable(false)
        })
      } catch (e) {
        console.warn('OPT DDS preview failed:', e)
      }
      return () => {
        active = false
        if (url) URL.revokeObjectURL(url)
      }
    }

    if (currentKind === 'image' || currentKind === 'video' || currentKind === 'audio') {
      const blob = new Blob([data as BlobPart], { type: mime })
      const url = URL.createObjectURL(blob)
      setMediaUrl(url)
      setDecodedText('')
      setIsTextDecodable(false)
      return () => URL.revokeObjectURL(url)
    }

    if (currentKind === 'text' || currentKind === 'markdown' || isProbablyUtf8(data)) {
      setMediaUrl('')
      const text = decodeZipText(data)
      setDecodedText(text)
      setIsTextDecodable(true)
    } else {
      setMediaUrl('')
      setDecodedText('')
      setIsTextDecodable(false)
    }
  }, [entry, data, kind])

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
        {isLoading ? (
          <div className="document-view-loading zip-loading" role="status">
            <LoaderCircle className="spin" size={24} />
            <span>{t('readingOptFile')}</span>
          </div>
        ) : entry.dir ? (
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
