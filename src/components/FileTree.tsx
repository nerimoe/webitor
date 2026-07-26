import { useEffect, useMemo, useRef, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { ChevronRight, FileText, Folder, FolderOpen, GripVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '../store/useWorkspace'
import type { FileNode } from '../types'
import { useWorkspaceDrag } from './WorkspaceDnd'

function TreeRow({ node, depth }: { node: FileNode; depth: number }) {
  const { t } = useTranslation()
  const { nodes, expanded, openFile, toggleExpanded, renameNode, deleteNode } = useWorkspace()
  const secondaryFileId = useWorkspace((state) => state.layout.groups[1].activeFileId)
  const selectedNodeId = useWorkspace((state) => state.selectedNodeId)
  const setSelectedNodeId = useWorkspace((state) => state.setSelectedNodeId)
  const { attributes, listeners, setNodeRef: setDraggableRef, isDragging } = useDraggable({ id: node.id })
  const { setNodeRef: setDroppableRef } = useDroppable({ id: `row:${node.id}` })
  const { dropHint } = useWorkspaceDrag()
  const swipeStart = useRef<{ pointerId: number; x: number } | null>(null)
  const wheelSwipe = useRef<{ offset: number; timer: ReturnType<typeof setTimeout> | null }>({ offset: 0, timer: null })
  const suppressClick = useRef(false)
  const [swipeOffset, setSwipeOffset] = useState(0)
  const active = selectedNodeId === node.id
  const children = useMemo(() => Object.values(nodes).filter((child) => child.parentId === node.id).sort((a, b) => a.kind === b.kind ? a.order - b.order : a.kind === 'directory' ? -1 : 1), [nodes, node.id])
  const isOpen = expanded.includes(node.id)
  const Icon = node.kind === 'directory' ? (isOpen ? FolderOpen : Folder) : FileText

  const rename = () => {
    const name = window.prompt(t('rename'), node.name)
    if (name) renameNode(node.id, name)
  }
  const remove = () => {
    if (window.confirm(t('confirmDelete', { name: node.name }))) deleteNode(node.id)
  }
  const beginSwipe = (event: React.PointerEvent<HTMLDivElement>) => {
    if (node.kind !== 'file' || event.pointerType !== 'touch' || (event.target as HTMLElement).closest('.tree-grip')) return
    swipeStart.current = { pointerId: event.pointerId, x: event.clientX }
  }
  const moveSwipe = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current
    if (!start || start.pointerId !== event.pointerId) return
    const distance = Math.min(0, event.clientX - start.x)
    if (distance < -8) {
      event.preventDefault()
      setSwipeOffset(Math.max(-108, distance))
    }
  }
  const finishSwipe = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current
    if (!start || start.pointerId !== event.pointerId) return
    const distance = event.clientX - start.x
    swipeStart.current = null
    if (distance < -84) remove()
    if (Math.abs(distance) > 8) {
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 0)
    }
    setSwipeOffset(0)
  }
  const finishWheelSwipe = () => {
    const distance = wheelSwipe.current.offset
    wheelSwipe.current = { offset: 0, timer: null }
    if (distance < -84) remove()
    if (Math.abs(distance) > 8) {
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 0)
    }
    setSwipeOffset(0)
  }
  const moveWheelSwipe = (event: React.WheelEvent<HTMLDivElement>) => {
    if (node.kind !== 'file' || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
    event.preventDefault()
    if (wheelSwipe.current.timer) window.clearTimeout(wheelSwipe.current.timer)
    const offset = Math.max(-108, Math.min(0, wheelSwipe.current.offset - event.deltaX))
    wheelSwipe.current.offset = offset
    wheelSwipe.current.timer = window.setTimeout(finishWheelSwipe, 140)
    setSwipeOffset(offset)
  }

  useEffect(() => () => {
    if (wheelSwipe.current.timer) window.clearTimeout(wheelSwipe.current.timer)
  }, [])

  return <>
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          ref={(element) => { setDraggableRef(element); setDroppableRef(element) }}
          className={`tree-row ${active ? 'active' : ''} ${isDragging ? 'dragging' : ''} ${dropHint?.nodeId === node.id ? `drop-${dropHint.mode}` : ''}`}
          data-node-id={node.id}
          data-parent-id={node.parentId ?? ''}
          style={{ paddingInlineStart: 8 + depth * 16, transform: swipeOffset ? `translateX(${swipeOffset}px)` : undefined }}
          {...attributes}
          tabIndex={0}
          onClick={(event) => { if (suppressClick.current) { event.preventDefault(); return }; setSelectedNodeId(node.id); node.kind === 'directory' ? toggleExpanded(node.id) : openFile(node.id) }}
          onDoubleClick={() => node.kind === 'file' && openFile(node.id)}
          onContextMenu={() => setSelectedNodeId(node.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); rename() }
            if (event.key === 'Delete') { event.preventDefault(); remove() }
          }}
          onPointerDown={beginSwipe}
          onPointerMove={moveSwipe}
          onPointerUp={finishSwipe}
          onPointerCancel={finishSwipe}
          onWheel={moveWheelSwipe}
          {...listeners}
        >
          <span className="tree-grip" aria-hidden="true"><GripVertical size={14} /></span>
          {node.kind === 'directory' ? <ChevronRight className={`chevron ${isOpen ? 'open' : ''}`} size={14} /> : <span className="tree-spacer" />}
          <Icon size={17} className={node.kind === 'directory' ? 'folder-icon' : 'file-icon'} />
          <span className="tree-label">{node.name}</span>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="menu-content">
          {node.kind === 'file' && <ContextMenu.Item className="menu-item" onSelect={() => openFile(node.id)}>{t('open')}</ContextMenu.Item>}
          {node.kind === 'file' && <ContextMenu.Item className="menu-item" onSelect={() => openFile(node.id, 'secondary')}>{t(secondaryFileId ? 'replaceRight' : 'openRight', { name: node.name })}</ContextMenu.Item>}
          <ContextMenu.Separator className="menu-separator" />
          <ContextMenu.Item className="menu-item" onSelect={rename}>{t('rename')}</ContextMenu.Item>
          <ContextMenu.Item className="menu-item danger" onSelect={remove}>{t('delete')}</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
    {node.kind === 'directory' && isOpen && children.map((child) => <TreeRow key={child.id} node={child} depth={depth + 1} />)}
  </>
}

export function FileTree() {
  const nodes = useWorkspace((state) => state.nodes)
  const setSelectedNodeId = useWorkspace((state) => state.setSelectedNodeId)
  const roots = useMemo(() => Object.values(nodes).filter((node) => node.parentId === null).sort((a, b) => a.kind === b.kind ? a.order - b.order : a.kind === 'directory' ? -1 : 1), [nodes])
  const { setNodeRef: setRootDropRef } = useDroppable({ id: 'tree-root' })
  return <div ref={setRootDropRef} className="tree" role="tree" tabIndex={0} onClick={(event) => { if (event.currentTarget === event.target) setSelectedNodeId(null) }}>{roots.map((node) => <TreeRow key={node.id} node={node} depth={0} />)}</div>
}
