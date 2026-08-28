import { describe, expect, it } from 'vitest'
import { decodeDds, parseDdsInfo } from './dds'

function createMockDdsHeader(
  width: number,
  height: number,
  fourCC: string | number,
  flags = 0x4, // DDPF_FOURCC
  bitCount = 0,
  rMask = 0,
  gMask = 0,
  bMask = 0,
  aMask = 0
): Uint8Array {
  const buffer = new ArrayBuffer(128)
  const view = new DataView(buffer)
  // Magic: 'DDS '
  view.setUint32(0, 0x20534444, true)
  // dwSize: 124
  view.setUint32(4, 124, true)
  // dwFlags: CAPS | HEIGHT | WIDTH | PIXELFORMAT
  view.setUint32(8, 0x1007, true)
  // dwHeight, dwWidth
  view.setUint32(12, height, true)
  view.setUint32(16, width, true)
  // dwMipMapCount
  view.setUint32(28, 1, true)

  // ddspf (offset 76)
  view.setUint32(76, 32, true) // dwSize
  view.setUint32(80, flags, true) // dwFlags
  if (typeof fourCC === 'string') {
    const code = fourCC.charCodeAt(0) | (fourCC.charCodeAt(1) << 8) | (fourCC.charCodeAt(2) << 16) | (fourCC.charCodeAt(3) << 24)
    view.setUint32(84, code, true)
  } else {
    view.setUint32(84, fourCC, true)
  }
  view.setUint32(88, bitCount, true)
  view.setUint32(92, rMask, true)
  view.setUint32(96, gMask, true)
  view.setUint32(100, bMask, true)
  view.setUint32(104, aMask, true)

  return new Uint8Array(buffer)
}

describe('dds parser and decoder', () => {
  it('parses DXT1 / BC1 headers correctly', () => {
    const header = createMockDdsHeader(256, 128, 'DXT1')
    const info = parseDdsInfo(header)
    expect(info.width).toBe(256)
    expect(info.height).toBe(128)
    expect(info.format).toBe('BC1 / DXT1')
    expect(info.hasAlpha).toBe(false)
  })

  it('parses DXT5 / BC3 headers with alpha flag', () => {
    const header = createMockDdsHeader(512, 512, 'DXT5')
    const info = parseDdsInfo(header)
    expect(info.width).toBe(512)
    expect(info.height).toBe(512)
    expect(info.format).toBe('BC3 / DXT5')
    expect(info.hasAlpha).toBe(true)
  })

  it('parses uncompressed 32-bit RGBA headers', () => {
    const header = createMockDdsHeader(64, 64, 0, 0x41, 32, 0x000000ff, 0x0000ff00, 0x00ff0000, 0xff000000)
    const info = parseDdsInfo(header)
    expect(info.width).toBe(64)
    expect(info.height).toBe(64)
    expect(info.format).toBe('32-bit RGBA')
    expect(info.hasAlpha).toBe(true)
  })

  it('throws on invalid magic or truncated headers', () => {
    expect(() => parseDdsInfo(new Uint8Array(64))).toThrow('too small')
    const invalidMagic = new Uint8Array(128)
    expect(() => parseDdsInfo(invalidMagic)).toThrow('Invalid DDS magic')
  })

  it('decodes uncompressed 32-bit RGBA pixels correctly', () => {
    const header = createMockDdsHeader(2, 2, 0, 0x41, 32, 0x000000ff, 0x0000ff00, 0x00ff0000, 0xff000000)
    // 4 pixels: red, green, blue, white
    const pixelData = new Uint8Array([
      255, 0, 0, 255,   // Red
      0, 255, 0, 255,   // Green
      0, 0, 255, 255,   // Blue
      255, 255, 255, 255 // White
    ])
    const fullDds = new Uint8Array(128 + pixelData.length)
    fullDds.set(header, 0)
    fullDds.set(pixelData, 128)

    const decoded = decodeDds(fullDds)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    expect(decoded.rgbaData.length).toBe(16)
    // Pixel 0 (Red)
    expect(decoded.rgbaData[0]).toBe(255)
    expect(decoded.rgbaData[1]).toBe(0)
    expect(decoded.rgbaData[2]).toBe(0)
    expect(decoded.rgbaData[3]).toBe(255)
    // Pixel 1 (Green)
    expect(decoded.rgbaData[4]).toBe(0)
    expect(decoded.rgbaData[5]).toBe(255)
    expect(decoded.rgbaData[6]).toBe(0)
    expect(decoded.rgbaData[7]).toBe(255)
  })

  it('decodes BC1 / DXT1 blocks correctly', () => {
    const header = createMockDdsHeader(4, 4, 'DXT1')
    // 1 block of 4x4 DXT1 (8 bytes)
    // c0 = 0xF800 (Red 31, 0, 0), c1 = 0x07E0 (Green 0, 63, 0), lookup = 0x00000000 (all c0)
    const block = new Uint8Array([
      0x00, 0xF8, // c0 = red
      0xE0, 0x07, // c1 = green
      0x00, 0x00, 0x00, 0x00 // all pixel index = 0 (c0)
    ])
    const fullDds = new Uint8Array(128 + block.length)
    fullDds.set(header, 0)
    fullDds.set(block, 128)

    const decoded = decodeDds(fullDds)
    expect(decoded.width).toBe(4)
    expect(decoded.height).toBe(4)
    expect(decoded.rgbaData[0]).toBe(255)
    expect(decoded.rgbaData[1]).toBe(0)
    expect(decoded.rgbaData[2]).toBe(0)
    expect(decoded.rgbaData[3]).toBe(255)
  })
})
