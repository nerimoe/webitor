import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  createZipBlob,
  decodeZipText,
  formatBytes,
  getFileExtension,
  inferEntryKind,
  inferMimeType,
  isProbablyUtf8,
  parseZipArchive
} from './zip'

describe('zip utilities', () => {
  it('formats byte sizes cleanly', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024 * 3.45)).toBe('3.45 MB')
  })

  it('infers file extension and kind correctly', () => {
    expect(getFileExtension('readme.md')).toBe('md')
    expect(getFileExtension('path/to/image.PNG')).toBe('png')
    expect(getFileExtension('no-extension')).toBe('')

    expect(inferEntryKind('doc.md')).toBe('markdown')
    expect(inferEntryKind('photo.jpg')).toBe('image')
    expect(inferEntryKind('movie.mp4')).toBe('video')
    expect(inferEntryKind('song.mp3')).toBe('audio')
    expect(inferEntryKind('script.ts')).toBe('text')
    expect(inferEntryKind('nested.zip')).toBe('zip')
    expect(inferEntryKind('app.exe')).toBe('binary')
  })

  it('infers mime types correctly', () => {
    expect(inferMimeType('pic.png')).toBe('image/png')
    expect(inferMimeType('video.webm')).toBe('video/webm')
    expect(inferMimeType('audio.wav')).toBe('audio/wav')
    expect(inferMimeType('text.txt')).toBe('text/plain;charset=utf-8')
    expect(inferMimeType('archive.zip')).toBe('application/zip')
    expect(inferMimeType('unknown.custom')).toBe('application/octet-stream')
  })

  it('detects UTF-8 and decodes text', () => {
    const textBytes = strToU8('Hello, Webitor!')
    expect(isProbablyUtf8(textBytes)).toBe(true)
    expect(decodeZipText(textBytes)).toBe('Hello, Webitor!')

    const binaryBytes = new Uint8Array([0, 1, 2, 3, 0, 4, 5])
    expect(isProbablyUtf8(binaryBytes)).toBe(false)
  })

  it('parses zip archives and synthesizes directory structure', async () => {
    const zipData = zipSync({
      'root.txt': strToU8('root content'),
      'src/index.js': strToU8('console.log("hello")'),
      'src/components/Button.tsx': strToU8('export const Button = () => null'),
      'images/logo.png': new Uint8Array([137, 80, 78, 71])
    })

    const entries = await parseZipArchive(zipData)

    const paths = entries.map((e) => e.path)
    expect(paths).toContain('root.txt')
    expect(paths).toContain('src')
    expect(paths).toContain('src/index.js')
    expect(paths).toContain('src/components')
    expect(paths).toContain('src/components/Button.tsx')
    expect(paths).toContain('images')
    expect(paths).toContain('images/logo.png')

    const srcDir = entries.find((e) => e.path === 'src')
    expect(srcDir?.dir).toBe(true)

    const button = entries.find((e) => e.path === 'src/components/Button.tsx')
    expect(button?.dir).toBe(false)
    expect(decodeZipText(button!.data)).toBe('export const Button = () => null')
  })

  it('creates zip blob from records', () => {
    const blob = createZipBlob({
      'test.txt': strToU8('hello')
    })
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/zip')
    expect(blob.size).toBeGreaterThan(0)
  })
})
