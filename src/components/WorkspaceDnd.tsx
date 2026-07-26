import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core'
import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '../store/useWorkspace'

type DropHint = { nodeId: string; mode: 'before' | 'inside' | 'after' } | null

const WorkspaceDragContext = createContext<{ activeNodeId: string | null; dropHint: DropHint }>({ activeNodeId: null, dropHint: null })

const workspaceCollision: CollisionDetection = (args) => {
  return pointerWithin(args).sort((left, right) => {
    const priority = (id: string) => id.startsWith('editor:') ? 0 : id.startsWith('row:') ? 1 : 2
    return priority(String(left.id)) - priority(String(right.id))
  })
}

export function useWorkspaceDrag() {
  return useContext(WorkspaceDragContext)
}

export function WorkspaceDndProvider({ children }: { children: ReactNode }) {
  const nodes = useWorkspace((state) => state.nodes)
  const moveNode = useWorkspace((state) => state.moveNode)
  const reorderNode = useWorkspace((state) => state.reorderNode)
  const openFileInPane = useWorkspace((state) => state.openFileInPane)
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<DropHint>(null)
  const hintRef = useRef<DropHint>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 240, tolerance: 8 } })
  )

  const updateHint = (event: DragOverEvent) => {
    const overId = String(event.over?.id ?? '')
    if (!overId.startsWith('row:')) {
      hintRef.current = null
      setDropHint(null)
      return
    }
    const targetId = overId.slice(4)
    const target = nodes[targetId]
    const source = nodes[String(event.active.id).replace(/^node:/, '')]
    if (!target || !source || !event.over) return
    const mode = target.kind === 'directory' ? 'inside' : source.order > target.order ? 'before' : 'after'
    const next = { nodeId: targetId, mode } as DropHint
    hintRef.current = next
    setDropHint(next)
  }

  const finish = ({ active, over }: DragEndEvent) => {
    const nodeId = String(active.id).replace(/^node:/, '')
    const overId = String(over?.id ?? '')
    if (overId === 'editor:primary' || overId === 'editor:secondary') {
      if (nodes[nodeId]?.kind === 'file') {
        const targetGroup = overId.endsWith('secondary') ? 'secondary' : 'primary'
        openFileInPane(nodeId, targetGroup)
      }
    } else if (overId === 'tree-root') {
      moveNode(nodeId, null)
    } else if (overId.startsWith('row:')) {
      const targetId = overId.slice(4)
      const target = nodes[targetId]
      if (target) {
        const hint = hintRef.current?.nodeId === targetId ? hintRef.current : null
        const mode = hint?.mode ?? (target.kind === 'directory' ? 'inside' : 'after')
        if (mode === 'inside' && target.kind === 'directory') moveNode(nodeId, target.id)
        else reorderNode(nodeId, target.parentId, target.id, mode === 'before' ? 'before' : 'after')
      }
    }
    hintRef.current = null
    setDropHint(null)
    setActiveNodeId(null)
  }

  const start = ({ active }: DragStartEvent) => setActiveNodeId(String(active.id).replace(/^node:/, ''))
  const cancel = () => { hintRef.current = null; setDropHint(null); setActiveNodeId(null) }
  const activeNode = activeNodeId ? nodes[activeNodeId] : undefined

  return <WorkspaceDragContext.Provider value={{ activeNodeId, dropHint }}>
    <DndContext sensors={sensors} collisionDetection={workspaceCollision} onDragStart={start} onDragOver={updateHint} onDragEnd={finish} onDragCancel={cancel}>
      {children}
      <DragOverlay dropAnimation={null}>{activeNode && <div className="drag-overlay-row"><FileText size={17} /><span>{activeNode.name}</span></div>}</DragOverlay>
    </DndContext>
  </WorkspaceDragContext.Provider>
}

export function EditorDropZones() {
  const { t } = useTranslation()
  const nodes = useWorkspace((state) => state.nodes)
  const { activeNodeId } = useWorkspaceDrag()
  const active = activeNodeId ? nodes[activeNodeId] : undefined
  const primary = useDroppable({ id: 'editor:primary' })
  const secondary = useDroppable({ id: 'editor:secondary' })
  return <div className={`editor-split-zones ${active?.kind === 'file' ? 'visible' : ''}`} aria-hidden={active?.kind !== 'file'}>
    <div ref={primary.setNodeRef} className={primary.isOver ? 'active' : ''}>{t('openLeft')}</div>
    <div ref={secondary.setNodeRef} className={secondary.isOver ? 'active' : ''}>{t('openRightDrop')}</div>
  </div>
}
