import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { defaultKeymap, history, historyField, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from '@codemirror/search'
import { EditorView, drawSelection, dropCursor, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Clock3, Eye, EyeOff, FilePlus2, FileText, MoreHorizontal, Redo2, Save, Search, Share2, Undo2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isMarkdown, loadLanguage } from '../lib/language'
import { dataUrlToBlob, shareBlob, shareTextFile } from '../lib/files'
import { useWorkspace } from '../store/useWorkspace'
import type { EditorGroup } from '../types'
import { IconButton } from './IconButton'
import { MarkdownPreview } from './MarkdownPreview'
import { ImagePreview } from './ImagePreview'
import { TimelineDialog } from './TimelineDialog'
import { useActionOverflow, type OverflowAction } from './useActionOverflow'
import { useLocalZoom } from './useLocalZoom'

const editorHistory = new Map<string, ReturnType<NonNullable<ReactCodeMirrorRef['state']>['toJSON']>>()

interface EditorPaneProps {
  group: EditorGroup
  leading?: ReactNode
  onNewDocument?: () => void
  onImportFiles?: () => void
}

interface DocumentAction extends OverflowAction {
  label: string
  icon: typeof Undo2
  onClick: () => void
  active?: boolean
}

export function EditorPane({ group, leading, onNewDocument, onImportFiles }: EditorPaneProps) {
  const { t } = useTranslation()
  const nodes = useWorkspace((state) => state.nodes)
  const contents = useWorkspace((state) => state.contents)
  const theme = useWorkspace((state) => state.settings.theme)
  const groups = useWorkspace((state) => state.layout.groups)
  const updateContent = useWorkspace((state) => state.updateContent)
  const saveFile = useWorkspace((state) => state.saveFile)
  const setGroupView = useWorkspace((state) => state.setGroupView)
  const previewMarkdown = useWorkspace((state) => state.previewMarkdown)
  const closeGroup = useWorkspace((state) => state.closeGroup)
  const renameNode = useWorkspace((state) => state.renameNode)
  const editorFontSize = useWorkspace((state) => state.layout.editorFontSize)
  const setEditorFontSize = useWorkspace((state) => state.setEditorFontSize)
  const pendingReveal = useWorkspace((state) => state.pendingReveal)
  const setPendingReveal = useWorkspace((state) => state.setPendingReveal)
  const [languageExtensions, setLanguageExtensions] = useState<import('@codemirror/state').Extension[]>([])
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [timelineOpen, setTimelineOpen] = useState(false)
  const ref = useRef<ReactCodeMirrorRef>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const codeZoomRef = useLocalZoom<HTMLDivElement>(editorFontSize, setEditorFontSize, { min: 12, max: 28, step: 1 })
  const fileId = group.activeFileId
  const node = fileId ? nodes[fileId] : undefined
  const content = fileId ? contents[fileId] : undefined
  const markdown = Boolean(node && isMarkdown(node.name))
  const image = content?.contentKind === 'image' && Boolean(content.dataUrl)
  const showCodeGutters = Boolean(node && node.language !== 'plain' && node.language !== 'markdown')
  const previewActive = Boolean(fileId && groups[1].view === 'markdown-preview' && groups[1].activeFileId === fileId)
  const splitActive = Boolean(groups[1].activeFileId)
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  useEffect(() => {
    let cancelled = false
    void loadLanguage(node?.language ?? 'plain').then((extensions) => !cancelled && setLanguageExtensions(extensions))
    return () => { cancelled = true }
  }, [node?.language])

  useEffect(() => () => {
    if (fileId && ref.current?.state) editorHistory.set(fileId, ref.current.state.toJSON({ history: historyField }))
  }, [fileId])

  useEffect(() => {
    setRenaming(false)
    setDraftName(node?.name ?? '')
  }, [fileId, node?.name])

  useEffect(() => {
    if (renaming) titleInput.current?.focus()
  }, [renaming])

  useEffect(() => {
    if (!fileId || pendingReveal?.fileId !== fileId) return
    const frame = requestAnimationFrame(() => {
      const view = ref.current?.view
      if (!view) return
      const from = Math.min(pendingReveal.from, view.state.doc.length)
      const to = Math.min(Math.max(from, pendingReveal.to), view.state.doc.length)
      view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
      view.focus()
      setPendingReveal(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [fileId, pendingReveal, setPendingReveal])

  const extensions = useMemo(() => [
    ...(showCodeGutters ? [lineNumbers(), foldGutter()] : []), history(), drawSelection(), dropCursor(), indentOnInput(), bracketMatching(), closeBrackets(),
    highlightActiveLine(), highlightSelectionMatches(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
    EditorView.lineWrapping,
    EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'var(--font-code)', fontSize: 'var(--editor-font-size)' }, '.cm-content': { padding: '14px 0 40px' }, '.cm-gutters': { background: 'transparent', border: 'none' } }),
    ...languageExtensions
  ], [languageExtensions, showCodeGutters])

  const run = (command: (view: import('@codemirror/view').EditorView) => boolean) => {
    const view = ref.current?.view
    if (view) { command(view); view.focus() }
  }
  const closePane = () => {
    if (!fileId) return
    closeGroup(group.id)
  }
  const closePaneFromKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); closePane() }
  }
  const savedEditorState = fileId ? editorHistory.get(fileId) : undefined
  const initialEditorState = savedEditorState?.doc === content?.text
    ? { json: savedEditorState, fields: { history: historyField } }
    : undefined
  const beginRename = () => {
    if (!node) return
    setDraftName(node.name)
    setRenaming(true)
  }
  const commitRename = () => {
    if (node && draftName.trim()) renameNode(node.id, draftName)
    setRenaming(false)
  }

  const actions = useMemo<DocumentAction[]>(() => {
    if (!fileId || !content) return []
    const next: DocumentAction[] = []
    if (!image) {
      next.push({ id: 'undo', priority: 5, label: t('undo'), icon: Undo2, onClick: () => run(undo) })
      next.push({ id: 'redo', priority: 6, label: t('redo'), icon: Redo2, onClick: () => run(redo) })
      next.push({ id: 'search', priority: 4, label: t('search'), icon: Search, onClick: () => run(openSearchPanel) })
    }
    if (!iOS) next.push({ id: 'save', priority: 1, label: t('save'), icon: Save, onClick: () => void saveFile(fileId) })
    next.push({ id: 'share', priority: 2, label: t('share'), icon: Share2, onClick: () => content.dataUrl
      ? void shareBlob(dataUrlToBlob(content.dataUrl), node?.name ?? 'image')
      : void shareTextFile(content.text, node?.name ?? 'document.txt') })
    if (!image) next.push({ id: 'timeline', priority: 7, label: t('timeline'), icon: Clock3, onClick: () => setTimelineOpen(true) })
    if (markdown) next.push({ id: 'preview', priority: 3, label: t('preview'), icon: Eye, active: previewActive, onClick: () => group.id === 'primary' ? previewMarkdown(fileId) : setGroupView(group.id, group.view === 'editor' ? 'markdown-preview' : 'editor') })
    next.push({ id: 'close', priority: 0, label: splitActive ? t('closePane') : t('closeFile'), icon: X, onClick: closePane })
    return next
  // Action callbacks intentionally follow the current editor instance and file.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, fileId, group.id, group.view, iOS, image, markdown, node?.name, previewActive, splitActive, t])
  const { ref: actionsRef, visible: visibleActions, overflow: overflowActions } = useActionOverflow(actions, { alwaysOverflow: !iOS && Boolean(fileId) })

  const renderAction = (action: DocumentAction) => action.id === 'close'
    ? <IconButton key={action.id} icon={X} label={action.label} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); action.onClick() }} onKeyDown={closePaneFromKeyboard} />
    : <IconButton key={action.id} icon={action.icon} label={action.label} active={action.active} onClick={action.onClick} />

  const renderOverflowAction = (action: DocumentAction) => {
    const Icon = action.icon
    return <DropdownMenu.Item key={action.id} className="menu-item with-icon" onSelect={action.onClick}><Icon size={18} />{action.label}</DropdownMenu.Item>
  }

  if (group.view === 'markdown-preview' && fileId && content) {
    return <section className="editor-pane preview-pane" data-testid="markdown-preview">
      <div className="preview-toolbar">
        <IconButton icon={EyeOff} label={t('preview')} onClick={() => setGroupView(group.id, 'editor')} />
        {splitActive && <button className="icon-button pane-close" aria-label={t('closePane')} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); closePane() }} onKeyDown={closePaneFromKeyboard}><X size={18} /></button>}
      </div>
      <MarkdownPreview value={content.text} />
    </section>
  }

  return (
    <section className="editor-pane" data-testid={`editor-${group.id}`} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}>
      <div className="document-bar">
        {leading && <div className="document-leading">{leading}</div>}
        {node ? <div className="document-title">
          <FileText size={18} />
          {renaming ? <input ref={titleInput} className="title-rename" value={draftName} aria-label={t('renameFile')} onChange={(event) => setDraftName(event.target.value)} onBlur={commitRename} onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); commitRename() }
            if (event.key === 'Escape') { event.preventDefault(); setRenaming(false) }
          }} /> : <button className="title-button" onClick={beginRename} aria-label={t('renameFile')}><span>{node.name}</span></button>}
          {content?.status === 'saving' && <span className="dirty-dot" />}
        </div> : <div className="document-title no-document-title"><span>{t('noFileTitle')}</span></div>}
        {fileId && <div ref={actionsRef} className="editor-actions">
          {visibleActions.map(renderAction)}
          {(!iOS || overflowActions.length > 0) && <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><IconButton icon={MoreHorizontal} label={t('moreActions')} /></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content className="menu-content" align="end">
              {overflowActions.map(renderOverflowAction)}
              {!iOS && <><DropdownMenu.Separator className="menu-separator" /><DropdownMenu.Item className="menu-item with-icon" onSelect={() => void saveFile(fileId, true)}><Save size={18} />{t('saveAs')}</DropdownMenu.Item></>}
              {!image && <><DropdownMenu.Separator className="menu-separator" /><DropdownMenu.Item className="menu-item with-icon" onSelect={() => setEditorFontSize(editorFontSize + 1)}><ZoomIn size={18} />{t('increaseTextSize')}</DropdownMenu.Item><DropdownMenu.Item className="menu-item with-icon" onSelect={() => setEditorFontSize(editorFontSize - 1)}><ZoomOut size={18} />{t('decreaseTextSize')}</DropdownMenu.Item></>}
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>}
        </div>}
      </div>
      {!fileId || !node || !content ? <div className="no-file-state" data-testid="no-file-state"><div className="empty-symbol">Aa</div><h1>{t('noFileTitle')}</h1><p>{t('noFileBody')}</p><div className="empty-actions"><button className="primary-button" onClick={onNewDocument}><FilePlus2 size={18} />{t('newFile')}</button><button className="secondary-button" onClick={onImportFiles}><Upload size={18} />{t('importFiles')}</button></div></div> : image && content.dataUrl
        ? <ImagePreview src={content.dataUrl} name={node.name} />
        : group.view === 'markdown-preview' && markdown
        ? <MarkdownPreview value={content.text} />
        : <div ref={codeZoomRef} className="code-editor" style={{ '--editor-font-size': `${editorFontSize}px` } as CSSProperties}><CodeMirror key={fileId} ref={ref} value={content.text} initialState={initialEditorState} extensions={extensions} theme={dark ? 'dark' : 'light'} onChange={(value) => updateContent(fileId, value)} basicSetup={false} /></div>}
      {content && <div className={`save-status ${content.status}`}><span />{t(content.status)}</div>}
      {fileId && !image && <TimelineDialog fileId={fileId} open={timelineOpen} onOpenChange={setTimelineOpen} />}
    </section>
  )
}
