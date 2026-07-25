import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { defaultKeymap, history, historyField, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from '@codemirror/search'
import { EditorView, drawSelection, dropCursor, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Eye, EyeOff, FileText, MoreHorizontal, Redo2, Save, Search, Share2, Undo2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isMarkdown, loadLanguage } from '../lib/language'
import { dataUrlToBlob, shareBlob, shareTextFile } from '../lib/files'
import { useWorkspace } from '../store/useWorkspace'
import type { EditorGroup } from '../types'
import { IconButton } from './IconButton'
import { MarkdownPreview } from './MarkdownPreview'
import { ImagePreview } from './ImagePreview'
import { TimelineDialog } from './TimelineDialog'

const editorHistory = new Map<string, ReturnType<NonNullable<ReactCodeMirrorRef['state']>['toJSON']>>()

export function EditorPane({ group, leading }: { group: EditorGroup; leading?: ReactNode }) {
  const { t } = useTranslation()
  const nodes = useWorkspace((state) => state.nodes)
  const contents = useWorkspace((state) => state.contents)
  const theme = useWorkspace((state) => state.settings.theme)
  const groups = useWorkspace((state) => state.layout.groups)
  const updateContent = useWorkspace((state) => state.updateContent)
  const saveFile = useWorkspace((state) => state.saveFile)
  const setGroupView = useWorkspace((state) => state.setGroupView)
  const previewMarkdown = useWorkspace((state) => state.previewMarkdown)
  const closeSecondary = useWorkspace((state) => state.closeSecondary)
  const closePrimary = useWorkspace((state) => state.closePrimary)
  const pendingReveal = useWorkspace((state) => state.pendingReveal)
  const setPendingReveal = useWorkspace((state) => state.setPendingReveal)
  const [languageExtensions, setLanguageExtensions] = useState<import('@codemirror/state').Extension[]>([])
  const ref = useRef<ReactCodeMirrorRef>(null)
  const fileId = group.activeFileId
  const node = fileId ? nodes[fileId] : undefined
  const content = fileId ? contents[fileId] : undefined
  const markdown = Boolean(node && isMarkdown(node.name))
  const image = content?.contentKind === 'image' && Boolean(content.dataUrl)
  const showCodeGutters = Boolean(node && node.language !== 'plain' && node.language !== 'markdown')
  const previewActive = Boolean(fileId && groups[1].view === 'markdown-preview' && groups[1].activeFileId === fileId)
  const splitActive = Boolean(groups[1].activeFileId)
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    let cancelled = false
    void loadLanguage(node?.language ?? 'plain').then((extensions) => !cancelled && setLanguageExtensions(extensions))
    return () => { cancelled = true }
  }, [node?.language])

  useEffect(() => () => {
    if (fileId && ref.current?.state) editorHistory.set(fileId, ref.current.state.toJSON({ history: historyField }))
  }, [fileId])

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
    EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'var(--font-code)', fontSize: '14px' }, '.cm-content': { padding: '14px 0 40px' }, '.cm-gutters': { background: 'transparent', border: 'none' } }),
    ...languageExtensions
  ], [languageExtensions, showCodeGutters])

  const run = (command: (view: import('@codemirror/view').EditorView) => boolean) => {
    const view = ref.current?.view
    if (view) { command(view); view.focus() }
  }
  const closePane = () => group.id === 'secondary' ? closeSecondary() : closePrimary()
  const closePaneFromKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); closePane() }
  }
  const savedEditorState = fileId ? editorHistory.get(fileId) : undefined
  const initialEditorState = savedEditorState?.doc === content?.text
    ? { json: savedEditorState, fields: { history: historyField } }
    : undefined

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
        <div className="document-title">{node && <FileText size={18} />}<span>{node?.name ?? t('noFile')}</span>{content?.status === 'saving' && <span className="dirty-dot" />}</div>
        {fileId && <div className="editor-actions">
          {!image && <IconButton icon={Undo2} label={t('undo')} onClick={() => run(undo)} />}
          {!image && <IconButton icon={Redo2} label={t('redo')} onClick={() => run(redo)} />}
          {!image && <IconButton icon={Search} label={t('search')} onClick={() => run(openSearchPanel)} />}
          <IconButton icon={Save} label={t('save')} onClick={() => void saveFile(fileId)} />
          <IconButton icon={Share2} label={t('share')} onClick={() => content?.dataUrl
            ? void shareBlob(dataUrlToBlob(content.dataUrl), node?.name ?? 'image')
            : void shareTextFile(content?.text ?? '', node?.name ?? 'document.txt')} />
          {!image && <TimelineDialog fileId={fileId} />}
          {markdown && <IconButton icon={Eye} label={t('preview')} active={previewActive} onClick={() => group.id === 'primary' ? previewMarkdown(fileId) : setGroupView(group.id, group.view === 'editor' ? 'markdown-preview' : 'editor')} />}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><IconButton icon={MoreHorizontal} label={t('moreActions')} /></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content className="menu-content" align="end">
              <DropdownMenu.Item className="menu-item" onSelect={() => void saveFile(fileId, true)}>{t('saveAs')}</DropdownMenu.Item>
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>
          {splitActive && <button className="icon-button pane-close" aria-label={t('closePane')} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); closePane() }} onKeyDown={closePaneFromKeyboard}><X size={18} /></button>}
        </div>}
      </div>
      {!fileId || !node || !content ? <div className="no-file">{t('noFile')}</div> : image && content.dataUrl
        ? <ImagePreview src={content.dataUrl} name={node.name} />
        : group.view === 'markdown-preview' && markdown
        ? <MarkdownPreview value={content.text} />
        : <div className="code-editor"><CodeMirror key={fileId} ref={ref} value={content.text} initialState={initialEditorState} extensions={extensions} theme={dark ? 'dark' : 'light'} onChange={(value) => updateContent(fileId, value)} basicSetup={false} /></div>}
      {content && <div className={`save-status ${content.status}`}><span />{t(content.status)}</div>}
    </section>
  )
}
