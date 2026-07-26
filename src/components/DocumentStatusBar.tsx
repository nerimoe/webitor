import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveDocumentViews } from '../documentFormats/registry'
import { useWorkspace } from '../store/useWorkspace'

const languageLabels: Record<string, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', html: 'HTML', css: 'CSS', json: 'JSON',
  markdown: 'Markdown', python: 'Python', java: 'Java', cpp: 'C/C++', rust: 'Rust', sql: 'SQL',
  xml: 'XML', yaml: 'YAML', ini: 'INI'
}

export function DocumentStatusBar({ fileId, shared = false }: { fileId: string; shared?: boolean }) {
  const { t } = useTranslation()
  const node = useWorkspace((state) => state.nodes[fileId])
  const content = useWorkspace((state) => state.contents[fileId])
  const textStats = useMemo(() => {
    if (!content || content.contentKind !== 'text') return null
    let lines = 1
    let characters = 0
    for (const character of content.text) {
      characters += 1
      if (character === '\n') lines += 1
    }
    return { lines, characters }
  }, [content])
  if (!node || !content) throw new Error(`Status bar file is unavailable: ${fileId}`)
  const resolution = resolveDocumentViews({ name: node.name, mimeType: content.mimeType, contentKind: content.contentKind })
  const fileType = resolution.format.id !== 'text'
    ? resolution.format.label({ name: node.name, mimeType: content.mimeType, contentKind: content.contentKind })
    : node.language === 'plain'
      ? t('plainText')
      : languageLabels[node.language ?? ''] ?? node.language ?? t('plainText')

  return <footer className={`document-status-bar ${shared ? 'shared-document-status' : ''}`} data-testid={shared ? 'shared-document-status' : 'document-status-bar'}>
    <div className="document-stats">
      <span className="file-type">{fileType}</span>
      {textStats && <span>{t('lineCount', { count: textStats.lines })}</span>}
      {textStats && <span>{t('characterCount', { count: textStats.characters })}</span>}
    </div>
    <div className={`save-status ${content.status}`} role="status" aria-label={t(content.status)}><span className="save-status-dot" /><span className="save-status-label">{t(content.status)}</span></div>
  </footer>
}
