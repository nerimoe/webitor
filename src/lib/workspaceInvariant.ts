import type { FileNode } from '../types'

function normalizedName(name: string) {
  return name.toLowerCase()
}

export function uniqueSiblingName(
  nodes: Record<string, FileNode>,
  parentId: string | null,
  requestedName: string,
  excludeId?: string
) {
  const name = requestedName
  if (!name.trim()) throw new Error('Node names must not be empty')
  const occupied = new Set(
    Object.values(nodes)
      .filter((node) => node.parentId === parentId && node.id !== excludeId)
      .map((node) => normalizedName(node.name))
  )
  if (!occupied.has(normalizedName(name))) return name

  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  let counter = 2
  while (occupied.has(normalizedName(`${base} ${counter}${extension}`))) counter += 1
  return `${base} ${counter}${extension}`
}

export function assertDirectoryParent(nodes: Record<string, FileNode>, parentId: string | null) {
  if (parentId && nodes[parentId]?.kind !== 'directory') throw new Error(`Parent ${parentId} is not a directory`)
}

export function assertWorkspaceNodes(nodes: Record<string, FileNode>) {
  const siblingNames = new Set<string>()
  Object.values(nodes).forEach((node) => {
    if (!node.name.trim()) throw new Error(`Node ${node.id} has an empty name`)
    if (node.id === node.parentId) throw new Error(`Node ${node.id} cannot be its own parent`)
    if (node.parentId) {
      const parent = nodes[node.parentId]
      if (!parent) throw new Error(`Node ${node.id} references a missing parent`)
      if (parent.kind !== 'directory') throw new Error(`Node ${node.id} has a non-directory parent`)
    }
    const siblingKey = `${node.parentId ?? ''}\u0000${normalizedName(node.name)}`
    if (siblingNames.has(siblingKey)) throw new Error(`Duplicate sibling name: ${node.name}`)
    siblingNames.add(siblingKey)
  })

  Object.values(nodes).forEach((node) => {
    const visited = new Set<string>()
    let current: FileNode | undefined = node
    while (current?.parentId) {
      if (visited.has(current.id)) throw new Error(`Directory cycle includes ${node.id}`)
      visited.add(current.id)
      current = nodes[current.parentId]
    }
  })
}
