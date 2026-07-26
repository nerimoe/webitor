import { describe, expect, it } from 'vitest'
import { packText, unpackText } from './textPacking'

describe('compact text packing', () => {
  it('round-trips common and uncommon Unicode text', () => {
    const text = '这是一段中文，mixed ASCII 123\n生僻字：龘𠮷，emoji: 👩‍💻。\u0000'
    expect(unpackText(packText(text))).toBe(text)
  })

  it('rejects truncated packed text', () => {
    expect(() => unpackText(Uint8Array.of(241, 0x4e))).toThrow(/truncated/i)
  })
})
