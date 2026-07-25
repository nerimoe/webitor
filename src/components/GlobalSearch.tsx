import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import Fuse from 'fuse.js'
import { FileImage, FileText, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '../store/useWorkspace'
import type { FileNode } from '../types'
import { IconButton } from './IconButton'

interface SearchRecord {
  id: string
  fileId: string
  name: string
  path: string
  text: string
  line: number
  from: number
  image: boolean
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

export function GlobalSearch() {
  const { t } = useTranslation()
  const nodes = useWorkspace((state) => state.nodes)
  const contents = useWorkspace((state) => state.contents)
  const openFile = useWorkspace((state) => state.openFile)
  const setPendingReveal = useWorkspace((state) => state.setPendingReveal)
  const setSidebarOpen = useWorkspace((state) => state.setSidebarOpen)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)

  const records = useMemo(() => {
    const output: SearchRecord[] = []
    Object.values(nodes).filter((node) => node.kind === 'file').forEach((node) => {
      const content = contents[node.id]
      const path = nodePath(node, nodes)
      if (content?.contentKind === 'image') {
        output.push({ id: `${node.id}:image`, fileId: node.id, name: node.name, path, text: '', line: 0, from: 0, image: true })
        return
      }
      let offset = 0
      const lines = (content?.text ?? '').split('\n')
      lines.forEach((text, index) => {
        if (text.trim() || index === 0) output.push({ id: `${node.id}:${index}`, fileId: node.id, name: node.name, path, text, line: index + 1, from: offset, image: false })
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
    openFile(record.fileId, 'primary')
    if (!record.image) {
      const direct = record.text.toLowerCase().indexOf(query.toLowerCase())
      const from = record.from + Math.max(0, direct)
      setPendingReveal({ fileId: record.fileId, from, to: from + Math.max(1, direct >= 0 ? query.length : record.text.length) })
    }
    setOpen(false)
    setSidebarOpen(false)
  }

  return <Dialog.Root open={open} onOpenChange={(value) => { setOpen(value); if (value) { setQuery(''); setSelected(0) } }}>
    <Dialog.Trigger asChild><IconButton icon={Search} label={t('globalSearch')} /></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="search-dialog" aria-describedby={undefined}>
        <Dialog.Title className="sr-only">{t('globalSearch')}</Dialog.Title>
        <div className="global-search-input"><Search size={21} /><input autoFocus value={query} placeholder={t('searchDocuments')} onChange={(event) => { setQuery(event.target.value); setSelected(0) }} onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(results.length - 1, value + 1)) }
          if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)) }
          if (event.key === 'Enter' && results[selected]) choose(results[selected])
        }} /><Dialog.Close asChild><button aria-label={t('close')}><X size={20} /></button></Dialog.Close></div>
        <div className="global-search-results">
          {results.length ? results.map((record, index) => <button key={record.id} className={index === selected ? 'selected' : ''} onPointerMove={() => setSelected(index)} onClick={() => choose(record)}>
            {record.image ? <FileImage size={20} /> : <FileText size={20} />}
            <span className="search-result-copy"><strong>{record.name}{record.line ? `:${record.line}` : ''}</strong><small>{record.text || record.path}</small></span>
            <span className="search-result-path">{record.path}</span>
          </button>) : <div className="search-empty">{t('noResults')}</div>}
        </div>
        <div className="search-footer">{t('searchHint')}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
