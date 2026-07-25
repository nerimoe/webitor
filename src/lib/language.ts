import type { Extension } from '@codemirror/state'

const extensionMap: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', html: 'html', htm: 'html', css: 'css',
  json: 'json', md: 'markdown', markdown: 'markdown', py: 'python', java: 'java',
  c: 'cpp', h: 'cpp', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', rs: 'rust', sql: 'sql',
  xml: 'xml', svg: 'xml', yaml: 'yaml', yml: 'yaml',
  ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini'
}

export function languageForName(name: string) {
  return extensionMap[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'plain'
}

export function isMarkdown(name: string) {
  return ['md', 'markdown'].includes(name.split('.').pop()?.toLowerCase() ?? '')
}

export async function loadLanguage(language: string): Promise<Extension[]> {
  switch (language) {
    case 'javascript': return [(await import('@codemirror/lang-javascript')).javascript({ jsx: true })]
    case 'typescript': return [(await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true })]
    case 'html': return [(await import('@codemirror/lang-html')).html()]
    case 'css': return [(await import('@codemirror/lang-css')).css()]
    case 'json': return [(await import('@codemirror/lang-json')).json()]
    case 'markdown': return [(await import('@codemirror/lang-markdown')).markdown()]
    case 'python': return [(await import('@codemirror/lang-python')).python()]
    case 'java': return [(await import('@codemirror/lang-java')).java()]
    case 'cpp': return [(await import('@codemirror/lang-cpp')).cpp()]
    case 'rust': return [(await import('@codemirror/lang-rust')).rust()]
    case 'sql': return [(await import('@codemirror/lang-sql')).sql()]
    case 'xml': return [(await import('@codemirror/lang-xml')).xml()]
    case 'yaml': return [(await import('@codemirror/lang-yaml')).yaml()]
    case 'ini': {
      const [{ StreamLanguage }, { properties }] = await Promise.all([
        import('@codemirror/language'),
        import('@codemirror/legacy-modes/mode/properties')
      ])
      return [StreamLanguage.define(properties)]
    }
    default: return []
  }
}
