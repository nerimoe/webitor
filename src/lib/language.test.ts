import { describe, expect, it } from 'vitest'
import { isMarkdown, languageForName } from './language'

describe('language detection', () => {
  it('detects common source files case-insensitively', () => {
    expect(languageForName('App.TSX')).toBe('typescript')
    expect(languageForName('main.py')).toBe('python')
    expect(languageForName('data.unknown')).toBe('plain')
  })

  it('recognizes Markdown extensions', () => {
    expect(isMarkdown('README.md')).toBe(true)
    expect(isMarkdown('notes.markdown')).toBe(true)
    expect(isMarkdown('notes.txt')).toBe(false)
  })

  it('detects INI-style configuration files', () => {
    expect(languageForName('settings.ini')).toBe('ini')
    expect(languageForName('app.properties')).toBe('ini')
  })
})
