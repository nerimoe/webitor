import { useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import Fuse from 'fuse.js'
import { FileImage, FileText, FileVideo, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '../store/useWorkspace'
import type { FileNode } from '../types'

interface SearchRecord {
  id: string
  fileId: string
  name: string
  path: string
  text: string
  line: number
  from: number
  mediaKind: 'binary' | 'image' | 'video' | null
}

function nodePath(node: FileNode, nodes: Record<string, FileNode>) {
  const parts = [node.name]
  let parentId = node.parentId
  while (parentId && nodes[parentId]) {
    parts.unshift(nodes[parentId].name)
    parentId = nodes[parentId].parentId
  }
  return parts.join(' / ')
}

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const nodes = useWorkspace((state) => state.nodes)
  const contents = useWorkspace((state) => state.contents)
  const openFileFullScreen = useWorkspace((state) => state.openFileFullScreen)
  const setPendingReveal = useWorkspace((state) => state.setPendingReveal)
  const setSidebarOpen = useWorkspace((state) => state.setSidebarOpen)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const records = useMemo(() => {
    const output: SearchRecord[] = []
    Object.values(nodes).filter((node) => node.kind === 'file').forEach((node) => {
      const content = contents[node.id]
      if (!content) throw new Error(`Search index cannot find content for ${node.id}`)
      const path = nodePath(node, nodes)
      if (content.contentKind !== 'text') {
        output.push({ id: `${node.id}:media`, fileId: node.id, name: node.name, path, text: '', line: 0, from: 0, mediaKind: content.contentKind ?? 'binary' })
        return
      }
      let offset = 0
      const lines = content.text.split('\n')
      lines.forEach((text, index) => {
        if (text.trim() || index === 0) output.push({ id: `${node.id}:${index}`, fileId: node.id, name: node.name, path, text, line: index + 1, from: offset, mediaKind: null })
        offset += text.length + 1
      })
    })
    return output.slice(0, 10_000)
  }, [contents, nodes])

  const results = useMemo(() => {
    if (!query.trim()) {
      const seen = new Set<string>()
      return records.filter((record) => {
        if (seen.has(record.fileId)) return false
        seen.add(record.fileId)
        return true
      }).slice(0, 12)
    }
    return new Fuse(records, { keys: [{ name: 'name', weight: 0.45 }, { name: 'path', weight: 0.2 }, { name: 'text', weight: 0.7 }], threshold: 0.38, ignoreLocation: true, includeScore: true })
      .search(query.trim(), { limit: 40 }).map((result) => result.item)
  }, [query, records])

  const choose = (record: SearchRecord) => {
    openFileFullScreen(record.fileId)
    if (!record.mediaKind) {
      const direct = record.text.toLowerCase().indexOf(query.toLowerCase())
      const from = record.from + Math.max(0, direct)
      setPendingReveal({ fileId: record.fileId, from, to: from + Math.max(1, direct >= 0 ? query.length : record.text.length) })
    }
    onOpenChange(false)
    setSidebarOpen(false)
  }

  return <Dialog.Root open={open} onOpenChange={(value) => { onOpenChange(value); if (value) { setQuery(''); setSelected(0) } }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="search-dialog" aria-describedby={undefined}>
        <Dialog.Title className="sr-only">{t('globalSearch')}</Dialog.Title>
        <div className="global-search-input"><Search size={21} /><input ref={inputRef} autoFocus value={query} placeholder={t('searchDocuments')} onChange={(event) => { setQuery(event.target.value); setSelected(0) }} onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(results.length - 1, value + 1)) }
          if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)) }
          if (event.key === 'Enter' && results[selected]) choose(results[selected])
        }} /><button aria-label={t('clearSearch')} disabled={!query} onClick={() => { setQuery(''); setSelected(0); inputRef.current?.focus() }}><X size={20} /></button></div>
        <div className="global-search-results">
          {results.length ? results.map((record, index) => <button key={record.id} className={index === selected ? 'selected' : ''} onPointerMove={() => setSelected(index)} onClick={() => choose(record)}>
            {record.mediaKind === 'image' ? <FileImage size={20} /> : record.mediaKind === 'video' ? <FileVideo size={20} /> : <FileText size={20} />}
            <span className="search-result-copy"><strong>{record.name}{record.line ? `:${record.line}` : ''}</strong><small>{record.text || record.path}</small></span>
            <span className="search-result-path">{record.path}</span>
          </button>) : <div className="search-empty">{t('noResults')}</div>}
        </div>
        <div className="search-footer">{t('searchHint')}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
