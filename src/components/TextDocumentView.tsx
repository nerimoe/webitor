import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyField, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { EditorView, drawSelection, dropCursor, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import type { DocumentViewProps } from '../documentFormats/types'
import { loadLanguage } from '../lib/language'
import { useWorkspace } from '../store/useWorkspace'
import { useLocalZoom } from './useLocalZoom'

const editorHistory = new Map<string, ReturnType<NonNullable<ReactCodeMirrorRef['state']>['toJSON']>>()

export default function TextDocumentView({ fileId, node, content, updateText, registerController }: DocumentViewProps) {
  const theme = useWorkspace((state) => state.settings.theme)
  const editorFontSize = useWorkspace((state) => state.layout.editorFontSize)
  const setEditorFontSize = useWorkspace((state) => state.setEditorFontSize)
  const pendingReveal = useWorkspace((state) => state.pendingReveal)
  const setPendingReveal = useWorkspace((state) => state.setPendingReveal)
  const [languageExtensions, setLanguageExtensions] = useState<import('@codemirror/state').Extension[]>([])
  const ref = useRef<ReactCodeMirrorRef>(null)
  const { ref: codeZoomRef } = useLocalZoom<HTMLDivElement>(editorFontSize, setEditorFontSize, { min: 12, max: 28, step: 1 })
  const showCodeGutters = node.language !== 'plain' && node.language !== 'markdown'
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    let cancelled = false
    void loadLanguage(node.language ?? 'plain').then((extensions) => !cancelled && setLanguageExtensions(extensions))
    return () => { cancelled = true }
  }, [node.language])

  useEffect(() => () => {
    if (ref.current?.state) editorHistory.set(fileId, ref.current.state.toJSON({ history: historyField }))
  }, [fileId])

  useEffect(() => {
    const run = (command: (view: EditorView) => boolean) => {
      const view = ref.current?.view
      if (!view) return
      command(view)
      view.focus()
    }
    registerController({
      find: () => run(openSearchPanel),
      redo: () => run(redo),
      undo: () => run(undo)
    })
    return () => registerController(null)
  }, [fileId, registerController])

  useEffect(() => {
    if (pendingReveal?.fileId !== fileId) return
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
    highlightActiveLine(), highlightSelectionMatches(), search({ top: true }), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
    EditorView.lineWrapping,
    EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'var(--font-code)', fontSize: 'var(--editor-font-size)' }, '.cm-content': { padding: '14px 0 40px' }, '.cm-gutters': { background: 'transparent', border: 'none' } }),
    ...languageExtensions
  ], [languageExtensions, showCodeGutters])

  const savedEditorState = editorHistory.get(fileId)
  const initialEditorState = savedEditorState?.doc === content.text
    ? { json: savedEditorState, fields: { history: historyField } }
    : undefined

  return <div ref={codeZoomRef} className="code-editor" style={{ '--editor-font-size': `${editorFontSize}px` } as CSSProperties}>
    <CodeMirror key={fileId} ref={ref} value={content.text} initialState={initialEditorState} extensions={extensions} theme={dark ? 'dark' : 'light'} onChange={updateText} basicSetup={false} />
  </div>
}
