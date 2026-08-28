/**
 * DirectDraw Surface (DDS) Parser and Decoder in pure TypeScript.
 * Supports:
 * - BC1 / DXT1 (RGB & 1-bit Alpha)
 * - BC2 / DXT3 (Explicit 4-bit Alpha)
 * - BC3 / DXT5 (Interpolated 8-bit Alpha)
 * - BC4 / ATI1 (Single Channel)
 * - BC5 / ATI2 (Two Channels / Normal Maps)
 * - Uncompressed RGBA / BGRA / ARGB / RGB / BGR / RGB565 / RGBA4444 / RGBA5551
 * - DX10 Extended Header Formats (DXGI_FORMAT_BC1..BC5, R8G8B8A8, B8G8R8A8, etc.)
 */

export interface DdsInfo {
  width: number
  height: number
  format: string
  mipmapCount: number
  hasAlpha: boolean
}

export interface DecodedDds extends DdsInfo {
  rgbaData: Uint8ClampedArray
  toCanvas(): HTMLCanvasElement
  toPngBlob(): Promise<Blob>
}

// Magic number for DDS files ("DDS ")
const DDS_MAGIC = 0x20534444

// Pixel format flags
const DDPF_ALPHAPIXELS = 0x1
const DDPF_ALPHA = 0x2
const DDPF_FOURCC = 0x4
const DDPF_RGB = 0x40
const DDPF_LUMINANCE = 0x20000

// FourCC codes
const FOURCC_DXT1 = 0x31545844 // 'DXT1'
const FOURCC_DXT2 = 0x32545844 // 'DXT2'
const FOURCC_DXT3 = 0x33545844 // 'DXT3'
const FOURCC_DXT4 = 0x34545844 // 'DXT4'
const FOURCC_DXT5 = 0x35545844 // 'DXT5'
const FOURCC_ATI1 = 0x31495441 // 'ATI1'
const FOURCC_BC4U = 0x55344342 // 'BC4U'
const FOURCC_BC4S = 0x53344342 // 'BC4S'
const FOURCC_ATI2 = 0x32495441 // 'ATI2'
const FOURCC_BC5U = 0x55354342 // 'BC5U'
const FOURCC_BC5S = 0x53354342 // 'BC5S'
const FOURCC_DX10 = 0x30315844 // 'DX10'

// DXGI formats
const DXGI_FORMAT_R8G8B8A8_UNORM = 28
const DXGI_FORMAT_R8G8B8A8_UNORM_SRGB = 29
const DXGI_FORMAT_B8G8R8A8_UNORM = 87
const DXGI_FORMAT_B8G8R8X8_UNORM = 88
const DXGI_FORMAT_B8G8R8A8_UNORM_SRGB = 91
const DXGI_FORMAT_BC1_UNORM = 71
const DXGI_FORMAT_BC1_UNORM_SRGB = 72
const DXGI_FORMAT_BC2_UNORM = 74
const DXGI_FORMAT_BC2_UNORM_SRGB = 75
const DXGI_FORMAT_BC3_UNORM = 77
const DXGI_FORMAT_BC3_UNORM_SRGB = 78
const DXGI_FORMAT_BC4_UNORM = 80
const DXGI_FORMAT_BC4_SNORM = 81
const DXGI_FORMAT_BC5_UNORM = 83
const DXGI_FORMAT_BC5_SNORM = 84

function getMaskShiftAndScale(mask: number): { shift: number; scale: number } {
  if (mask === 0) return { shift: 0, scale: 0 }
  let shift = 0
  while ((mask & 1) === 0) {
    mask >>>= 1
    shift += 1
  }
  const maxVal = mask
  const scale = 255 / maxVal
  return { shift, scale }
}

function decodeBc1(data: Uint8Array, offset: number, width: number, height: number, out: Uint8ClampedArray): void {
  const blockCountX = Math.max(1, Math.floor((width + 3) / 4))
  const blockCountY = Math.max(1, Math.floor((height + 3) / 4))
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  let ptr = offset
  const colorTable = new Uint8Array(16) // 4 colors * 4 channels (RGBA)

  for (let by = 0; by < blockCountY; by += 1) {
    for (let bx = 0; bx < blockCountX; bx += 1) {
      if (ptr + 8 > data.byteLength) return
      const c0 = view.getUint16(ptr, true)
      const c1 = view.getUint16(ptr + 2, true)
      const lookup = view.getUint32(ptr + 4, true)
      ptr += 8

      const r0 = ((c0 >> 11) & 0x1f) * (255 / 31)
      const g0 = ((c0 >> 5) & 0x3f) * (255 / 63)
      const b0 = (c0 & 0x1f) * (255 / 31)

      const r1 = ((c1 >> 11) & 0x1f) * (255 / 31)
      const g1 = ((c1 >> 5) & 0x3f) * (255 / 63)
      const b1 = (c1 & 0x1f) * (255 / 31)

      colorTable[0] = r0; colorTable[1] = g0; colorTable[2] = b0; colorTable[3] = 255
      colorTable[4] = r1; colorTable[5] = g1; colorTable[6] = b1; colorTable[7] = 255

      if (c0 > c1) {
        colorTable[8] = (2 * r0 + r1) / 3
        colorTable[9] = (2 * g0 + g1) / 3
        colorTable[10] = (2 * b0 + b1) / 3
        colorTable[11] = 255

        colorTable[12] = (r0 + 2 * r1) / 3
        colorTable[13] = (g0 + 2 * g1) / 3
        colorTable[14] = (b0 + 2 * b1) / 3
        colorTable[15] = 255
      } else {
        colorTable[8] = (r0 + r1) / 2
        colorTable[9] = (g0 + g1) / 2
        colorTable[10] = (b0 + b1) / 2
        colorTable[11] = 255

        colorTable[12] = 0
        colorTable[13] = 0
        colorTable[14] = 0
        colorTable[15] = 0
      }

      for (let py = 0; py < 4; py += 1) {
        const y = by * 4 + py
        if (y >= height) continue
        for (let px = 0; px < 4; px += 1) {
          const x = bx * 4 + px
          if (x >= width) continue
          const codeIndex = (py * 4 + px) * 2
          const code = (lookup >> codeIndex) & 0x3
          const outIndex = (y * width + x) * 4
          const cIndex = code * 4
          out[outIndex] = colorTable[cIndex]
          out[outIndex + 1] = colorTable[cIndex + 1]
          out[outIndex + 2] = colorTable[cIndex + 2]
          out[outIndex + 3] = colorTable[cIndex + 3]
        }
      }
    }
  }
}

function decodeBc2(data: Uint8Array, offset: number, width: number, height: number, out: Uint8ClampedArray): void {
  const blockCountX = Math.max(1, Math.floor((width + 3) / 4))
  const blockCountY = Math.max(1, Math.floor((height + 3) / 4))
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  let ptr = offset
  const colorTable = new Uint8Array(16)

  for (let by = 0; by < blockCountY; by += 1) {
    for (let bx = 0; bx < blockCountX; bx += 1) {
      if (ptr + 16 > data.byteLength) return
      const alpha0 = view.getUint32(ptr, true)
      const alpha1 = view.getUint32(ptr + 4, true)
      const c0 = view.getUint16(ptr + 8, true)
      const c1 = view.getUint16(ptr + 10, true)
      const lookup = view.getUint32(ptr + 12, true)
      ptr += 16

      const r0 = ((c0 >> 11) & 0x1f) * (255 / 31)
      const g0 = ((c0 >> 5) & 0x3f) * (255 / 63)
      const b0 = (c0 & 0x1f) * (255 / 31)

      const r1 = ((c1 >> 11) & 0x1f) * (255 / 31)
      const g1 = ((c1 >> 5) & 0x3f) * (255 / 63)
      const b1 = (c1 & 0x1f) * (255 / 31)

      colorTable[0] = r0; colorTable[1] = g0; colorTable[2] = b0
      colorTable[4] = r1; colorTable[5] = g1; colorTable[6] = b1
      colorTable[8] = (2 * r0 + r1) / 3; colorTable[9] = (2 * g0 + g1) / 3; colorTable[10] = (2 * b0 + b1) / 3
      colorTable[12] = (r0 + 2 * r1) / 3; colorTable[13] = (g0 + 2 * g1) / 3; colorTable[14] = (b0 + 2 * b1) / 3

      for (let py = 0; py < 4; py += 1) {
        const y = by * 4 + py
        if (y >= height) continue
        for (let px = 0; px < 4; px += 1) {
          const x = bx * 4 + px
          if (x >= width) continue
          const pixelIndex = py * 4 + px
          const aRaw = pixelIndex < 8
            ? (alpha0 >> (pixelIndex * 4)) & 0x0f
            : (alpha1 >> ((pixelIndex - 8) * 4)) & 0x0f
          const alpha = aRaw * 17

          const code = (lookup >> (pixelIndex * 2)) & 0x3
          const outIndex = (y * width + x) * 4
          const cIndex = code * 4
          out[outIndex] = colorTable[cIndex]
          out[outIndex + 1] = colorTable[cIndex + 1]
          out[outIndex + 2] = colorTable[cIndex + 2]
          out[outIndex + 3] = alpha
        }
      }
    }
  }
}

function decodeBc3(data: Uint8Array, offset: number, width: number, height: number, out: Uint8ClampedArray): void {
  const blockCountX = Math.max(1, Math.floor((width + 3) / 4))
  const blockCountY = Math.max(1, Math.floor((height + 3) / 4))
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  let ptr = offset
  const colorTable = new Uint8Array(16)
  const alphaTable = new Uint8Array(8)

  for (let by = 0; by < blockCountY; by += 1) {
    for (let bx = 0; bx < blockCountX; bx += 1) {
      if (ptr + 16 > data.byteLength) return
      const a0 = data[ptr]
      const a1 = data[ptr + 1]
      // 6 bytes of alpha index table (48 bits = 16 * 3 bits)
      const aLow = view.getUint32(ptr + 2, true)
      const aHigh = view.getUint16(ptr + 6, true)
      const c0 = view.getUint16(ptr + 8, true)
      const c1 = view.getUint16(ptr + 10, true)
      const lookup = view.getUint32(ptr + 12, true)
      ptr += 16

      alphaTable[0] = a0
      alphaTable[1] = a1
      if (a0 > a1) {
        alphaTable[2] = (6 * a0 + 1 * a1) / 7
        alphaTable[3] = (5 * a0 + 2 * a1) / 7
        alphaTable[4] = (4 * a0 + 3 * a1) / 7
        alphaTable[5] = (3 * a0 + 4 * a1) / 7
        alphaTable[6] = (2 * a0 + 5 * a1) / 7
        alphaTable[7] = (1 * a0 + 6 * a1) / 7
      } else {
        alphaTable[2] = (4 * a0 + 1 * a1) / 5
        alphaTable[3] = (3 * a0 + 2 * a1) / 5
        alphaTable[4] = (2 * a0 + 3 * a1) / 5
        alphaTable[5] = (1 * a0 + 4 * a1) / 5
        alphaTable[6] = 0
        alphaTable[7] = 255
      }

      const r0 = ((c0 >> 11) & 0x1f) * (255 / 31)
      const g0 = ((c0 >> 5) & 0x3f) * (255 / 63)
      const b0 = (c0 & 0x1f) * (255 / 31)

      const r1 = ((c1 >> 11) & 0x1f) * (255 / 31)
      const g1 = ((c1 >> 5) & 0x3f) * (255 / 63)
      const b1 = (c1 & 0x1f) * (255 / 31)

      colorTable[0] = r0; colorTable[1] = g0; colorTable[2] = b0
      colorTable[4] = r1; colorTable[5] = g1; colorTable[6] = b1
      colorTable[8] = (2 * r0 + r1) / 3; colorTable[9] = (2 * g0 + g1) / 3; colorTable[10] = (2 * b0 + b1) / 3
      colorTable[12] = (r0 + 2 * r1) / 3; colorTable[13] = (g0 + 2 * g1) / 3; colorTable[14] = (b0 + 2 * b1) / 3

      for (let py = 0; py < 4; py += 1) {
        const y = by * 4 + py
        if (y >= height) continue
        for (let px = 0; px < 4; px += 1) {
          const x = bx * 4 + px
          if (x >= width) continue
          const pixelIndex = py * 4 + px
          const bitOffset = pixelIndex * 3
          let aCode = 0
          if (bitOffset < 32) {
            aCode = (aLow >>> bitOffset) & 0x7
            if (bitOffset > 29) {
              const overflowBits = (bitOffset + 3) - 32
              aCode |= (aHigh & ((1 << overflowBits) - 1)) << (3 - overflowBits)
            }
          } else {
            aCode = (aHigh >>> (bitOffset - 32)) & 0x7
          }

          const code = (lookup >> (pixelIndex * 2)) & 0x3
          const outIndex = (y * width + x) * 4
          const cIndex = code * 4
          out[outIndex] = colorTable[cIndex]
          out[outIndex + 1] = colorTable[cIndex + 1]
          out[outIndex + 2] = colorTable[cIndex + 2]
          out[outIndex + 3] = alphaTable[aCode]
        }
      }
    }
  }
}

function decodeBc4(data: Uint8Array, offset: number, width: number, height: number, out: Uint8ClampedArray): void {
  const blockCountX = Math.max(1, Math.floor((width + 3) / 4))
  const blockCountY = Math.max(1, Math.floor((height + 3) / 4))
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  let ptr = offset
  const valTable = new Uint8Array(8)

  for (let by = 0; by < blockCountY; by += 1) {
    for (let bx = 0; bx < blockCountX; bx += 1) {
      if (ptr + 8 > data.byteLength) return
      const r0 = data[ptr]
      const r1 = data[ptr + 1]
      const low = view.getUint32(ptr + 2, true)
      const high = view.getUint16(ptr + 6, true)
      ptr += 8

      valTable[0] = r0
      valTable[1] = r1
      if (r0 > r1) {
        valTable[2] = (6 * r0 + 1 * r1) / 7
        valTable[3] = (5 * r0 + 2 * r1) / 7
        valTable[4] = (4 * r0 + 3 * r1) / 7
        valTable[5] = (3 * r0 + 4 * r1) / 7
        valTable[6] = (2 * r0 + 5 * r1) / 7
        valTable[7] = (1 * r0 + 6 * r1) / 7
      } else {
        valTable[2] = (4 * r0 + 1 * r1) / 5
        valTable[3] = (3 * r0 + 2 * r1) / 5
        valTable[4] = (2 * r0 + 3 * r1) / 5
        valTable[5] = (1 * r0 + 4 * r1) / 5
        valTable[6] = 0
        valTable[7] = 255
      }

      for (let py = 0; py < 4; py += 1) {
        const y = by * 4 + py
        if (y >= height) continue
        for (let px = 0; px < 4; px += 1) {
          const x = bx * 4 + px
          if (x >= width) continue
          const pixelIndex = py * 4 + px
          const bitOffset = pixelIndex * 3
          let code = 0
          if (bitOffset < 32) {
            code = (low >>> bitOffset) & 0x7
            if (bitOffset > 29) {
              const overflow = (bitOffset + 3) - 32
              code |= (high & ((1 << overflow) - 1)) << (3 - overflow)
            }
          } else {
            code = (high >>> (bitOffset - 32)) & 0x7
          }

          const val = valTable[code]
          const outIndex = (y * width + x) * 4
          out[outIndex] = val
          out[outIndex + 1] = val
          out[outIndex + 2] = val
          out[outIndex + 3] = 255
        }
      }
    }
  }
}

function decodeBc5(data: Uint8Array, offset: number, width: number, height: number, out: Uint8ClampedArray): void {
  const blockCountX = Math.max(1, Math.floor((width + 3) / 4))
  const blockCountY = Math.max(1, Math.floor((height + 3) / 4))
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  let ptr = offset
  const rTable = new Uint8Array(8)
  const gTable = new Uint8Array(8)

  for (let by = 0; by < blockCountY; by += 1) {
    for (let bx = 0; bx < blockCountX; bx += 1) {
      if (ptr + 16 > data.byteLength) return
      // Red block (8 bytes)
      const r0 = data[ptr]; const r1 = data[ptr + 1]
      const rLow = view.getUint32(ptr + 2, true); const rHigh = view.getUint16(ptr + 6, true)
      // Green block (8 bytes)
      const g0 = data[ptr + 8]; const g1 = data[ptr + 9]
      const gLow = view.getUint32(ptr + 10, true); const gHigh = view.getUint16(ptr + 14, true)
      ptr += 16

      rTable[0] = r0; rTable[1] = r1
      if (r0 > r1) {
        for (let i = 1; i <= 6; i += 1) rTable[i + 1] = ((7 - i) * r0 + i * r1) / 7
      } else {
        for (let i = 1; i <= 4; i += 1) rTable[i + 1] = ((5 - i) * r0 + i * r1) / 5
        rTable[6] = 0; rTable[7] = 255
      }

      gTable[0] = g0; gTable[1] = g1
      if (g0 > g1) {
        for (let i = 1; i <= 6; i += 1) gTable[i + 1] = ((7 - i) * g0 + i * g1) / 7
      } else {
        for (let i = 1; i <= 4; i += 1) gTable[i + 1] = ((5 - i) * g0 + i * g1) / 5
        gTable[6] = 0; gTable[7] = 255
      }

      for (let py = 0; py < 4; py += 1) {
        const y = by * 4 + py
        if (y >= height) continue
        for (let px = 0; px < 4; px += 1) {
          const x = bx * 4 + px
          if (x >= width) continue
          const pixelIndex = py * 4 + px
          const bitOffset = pixelIndex * 3

          let rCode = 0
          if (bitOffset < 32) {
            rCode = (rLow >>> bitOffset) & 0x7
            if (bitOffset > 29) rCode |= (rHigh & ((1 << (bitOffset - 29)) - 1)) << (32 - bitOffset)
          } else {
            rCode = (rHigh >>> (bitOffset - 32)) & 0x7
          }

          let gCode = 0
          if (bitOffset < 32) {
            gCode = (gLow >>> bitOffset) & 0x7
            if (bitOffset > 29) gCode |= (gHigh & ((1 << (bitOffset - 29)) - 1)) << (32 - bitOffset)
          } else {
            gCode = (gHigh >>> (bitOffset - 32)) & 0x7
          }

          const r = rTable[rCode]
          const g = gTable[gCode]
          // Calculate B for tangent space normal map: z = sqrt(1 - x^2 - y^2)
          const nx = (r / 255) * 2 - 1
          const ny = (g / 255) * 2 - 1
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
          const b = Math.min(255, Math.max(0, Math.round((nz + 1) * 0.5 * 255)))

          const outIndex = (y * width + x) * 4
          out[outIndex] = r
          out[outIndex + 1] = g
          out[outIndex + 2] = b
          out[outIndex + 3] = 255
        }
      }
    }
  }
}

function decodeUncompressedRgb(
  data: Uint8Array,
  offset: number,
  width: number,
  height: number,
  bitCount: number,
  rMask: number,
  gMask: number,
  bMask: number,
  aMask: number,
  out: Uint8ClampedArray
): void {
  const bytesPerPixel = Math.floor(bitCount / 8)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const { shift: rShift, scale: rScale } = getMaskShiftAndScale(rMask)
  const { shift: gShift, scale: gScale } = getMaskShiftAndScale(gMask)
  const { shift: bShift, scale: bScale } = getMaskShiftAndScale(bMask)
  const { shift: aShift, scale: aScale } = getMaskShiftAndScale(aMask)
  const hasAlpha = aMask !== 0

  let ptr = offset
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (ptr + bytesPerPixel > data.byteLength) return
      let val = 0
      if (bytesPerPixel === 4) {
        val = view.getUint32(ptr, true)
      } else if (bytesPerPixel === 3) {
        val = data[ptr] | (data[ptr + 1] << 8) | (data[ptr + 2] << 16)
      } else if (bytesPerPixel === 2) {
        val = view.getUint16(ptr, true)
      } else if (bytesPerPixel === 1) {
        val = data[ptr]
      }
      ptr += bytesPerPixel

      const r = rMask ? Math.round(((val & rMask) >>> rShift) * rScale) : 0
      const g = gMask ? Math.round(((val & gMask) >>> gShift) * gScale) : 0
      const b = bMask ? Math.round(((val & bMask) >>> bShift) * bScale) : 0
      const a = hasAlpha ? Math.round(((val & aMask) >>> aShift) * aScale) : 255

      const outIndex = (y * width + x) * 4
      out[outIndex] = r
      out[outIndex + 1] = g
      out[outIndex + 2] = b
      out[outIndex + 3] = a
    }
  }
}

export function parseDdsInfo(buffer: ArrayBuffer | Uint8Array): DdsInfo {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.byteLength < 128) throw new Error('File is too small to be a valid DDS image')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = view.getUint32(0, true)
  if (magic !== DDS_MAGIC) throw new Error('Invalid DDS magic header')

  const size = view.getUint32(4, true)
  if (size !== 124) throw new Error('Invalid DDS header size')

  const height = view.getUint32(12, true)
  const width = view.getUint32(16, true)
  const mipmapCount = Math.max(1, view.getUint32(28, true) || 1)

  const pfSize = view.getUint32(76, true)
  if (pfSize !== 32) throw new Error('Invalid DDS pixel format size')

  const pfFlags = view.getUint32(80, true)
  const fourCC = view.getUint32(84, true)
  const bitCount = view.getUint32(88, true)

  let formatName = 'Unknown'
  let hasAlpha = (pfFlags & DDPF_ALPHAPIXELS) !== 0 || (pfFlags & DDPF_ALPHA) !== 0

  if (pfFlags & DDPF_FOURCC) {
    if (fourCC === FOURCC_DXT1) {
      formatName = 'BC1 / DXT1'
    } else if (fourCC === FOURCC_DXT2 || fourCC === FOURCC_DXT3) {
      formatName = 'BC2 / DXT3'
      hasAlpha = true
    } else if (fourCC === FOURCC_DXT4 || fourCC === FOURCC_DXT5) {
      formatName = 'BC3 / DXT5'
      hasAlpha = true
    } else if (fourCC === FOURCC_ATI1 || fourCC === FOURCC_BC4U || fourCC === FOURCC_BC4S) {
      formatName = 'BC4 / ATI1'
    } else if (fourCC === FOURCC_ATI2 || fourCC === FOURCC_BC5U || fourCC === FOURCC_BC5S) {
      formatName = 'BC5 / ATI2'
    } else if (fourCC === FOURCC_DX10 && bytes.byteLength >= 148) {
      const dxgiFormat = view.getUint32(128, true)
      if (dxgiFormat === DXGI_FORMAT_BC1_UNORM || dxgiFormat === DXGI_FORMAT_BC1_UNORM_SRGB) formatName = 'BC1 (DX10)'
      else if (dxgiFormat === DXGI_FORMAT_BC2_UNORM || dxgiFormat === DXGI_FORMAT_BC2_UNORM_SRGB) { formatName = 'BC2 (DX10)'; hasAlpha = true }
      else if (dxgiFormat === DXGI_FORMAT_BC3_UNORM || dxgiFormat === DXGI_FORMAT_BC3_UNORM_SRGB) { formatName = 'BC3 (DX10)'; hasAlpha = true }
      else if (dxgiFormat === DXGI_FORMAT_BC4_UNORM || dxgiFormat === DXGI_FORMAT_BC4_SNORM) formatName = 'BC4 (DX10)'
      else if (dxgiFormat === DXGI_FORMAT_BC5_UNORM || dxgiFormat === DXGI_FORMAT_BC5_SNORM) formatName = 'BC5 (DX10)'
      else if (dxgiFormat === DXGI_FORMAT_R8G8B8A8_UNORM || dxgiFormat === DXGI_FORMAT_R8G8B8A8_UNORM_SRGB) { formatName = 'RGBA8 (DX10)'; hasAlpha = true }
      else if (dxgiFormat === DXGI_FORMAT_B8G8R8A8_UNORM || dxgiFormat === DXGI_FORMAT_B8G8R8A8_UNORM_SRGB) { formatName = 'BGRA8 (DX10)'; hasAlpha = true }
      else formatName = `DX10 (${dxgiFormat})`
    } else {
      const c1 = String.fromCharCode(fourCC & 0xff)
      const c2 = String.fromCharCode((fourCC >> 8) & 0xff)
      const c3 = String.fromCharCode((fourCC >> 16) & 0xff)
      const c4 = String.fromCharCode((fourCC >> 24) & 0xff)
      formatName = `${c1}${c2}${c3}${c4}`
    }
  } else if (pfFlags & DDPF_RGB) {
    formatName = `${bitCount}-bit ${hasAlpha ? 'RGBA' : 'RGB'}`
  } else if (pfFlags & DDPF_LUMINANCE) {
    formatName = `${bitCount}-bit Grayscale`
  }

  return { width, height, format: formatName, mipmapCount, hasAlpha }
}

export function decodeDds(buffer: ArrayBuffer | Uint8Array): DecodedDds {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const info = parseDdsInfo(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const pfFlags = view.getUint32(80, true)
  const fourCC = view.getUint32(84, true)
  const bitCount = view.getUint32(88, true)
  const rMask = view.getUint32(92, true)
  const gMask = view.getUint32(96, true)
  const bMask = view.getUint32(100, true)
  const aMask = view.getUint32(104, true)

  let dataOffset = 128
  let dxgiFormat: number | null = null

  if ((pfFlags & DDPF_FOURCC) && fourCC === FOURCC_DX10) {
    dataOffset = 148
    if (bytes.byteLength >= 148) {
      dxgiFormat = view.getUint32(128, true)
    }
  }

  const { width, height } = info
  const rgbaData = new Uint8ClampedArray(width * height * 4)

  if (pfFlags & DDPF_FOURCC) {
    if (fourCC === FOURCC_DXT1 || dxgiFormat === DXGI_FORMAT_BC1_UNORM || dxgiFormat === DXGI_FORMAT_BC1_UNORM_SRGB) {
      decodeBc1(bytes, dataOffset, width, height, rgbaData)
    } else if (fourCC === FOURCC_DXT2 || fourCC === FOURCC_DXT3 || dxgiFormat === DXGI_FORMAT_BC2_UNORM || dxgiFormat === DXGI_FORMAT_BC2_UNORM_SRGB) {
      decodeBc2(bytes, dataOffset, width, height, rgbaData)
    } else if (fourCC === FOURCC_DXT4 || fourCC === FOURCC_DXT5 || dxgiFormat === DXGI_FORMAT_BC3_UNORM || dxgiFormat === DXGI_FORMAT_BC3_UNORM_SRGB) {
      decodeBc3(bytes, dataOffset, width, height, rgbaData)
    } else if (fourCC === FOURCC_ATI1 || fourCC === FOURCC_BC4U || fourCC === FOURCC_BC4S || dxgiFormat === DXGI_FORMAT_BC4_UNORM || dxgiFormat === DXGI_FORMAT_BC4_SNORM) {
      decodeBc4(bytes, dataOffset, width, height, rgbaData)
    } else if (fourCC === FOURCC_ATI2 || fourCC === FOURCC_BC5U || fourCC === FOURCC_BC5S || dxgiFormat === DXGI_FORMAT_BC5_UNORM || dxgiFormat === DXGI_FORMAT_BC5_SNORM) {
      decodeBc5(bytes, dataOffset, width, height, rgbaData)
    } else if (dxgiFormat === DXGI_FORMAT_R8G8B8A8_UNORM || dxgiFormat === DXGI_FORMAT_R8G8B8A8_UNORM_SRGB) {
      decodeUncompressedRgb(bytes, dataOffset, width, height, 32, 0x000000ff, 0x0000ff00, 0x00ff0000, 0xff000000, rgbaData)
    } else if (dxgiFormat === DXGI_FORMAT_B8G8R8A8_UNORM || dxgiFormat === DXGI_FORMAT_B8G8R8A8_UNORM_SRGB || dxgiFormat === DXGI_FORMAT_B8G8R8X8_UNORM) {
      decodeUncompressedRgb(bytes, dataOffset, width, height, 32, 0x00ff0000, 0x0000ff00, 0x000000ff, dxgiFormat === DXGI_FORMAT_B8G8R8X8_UNORM ? 0 : 0xff000000, rgbaData)
    } else {
      throw new Error(`Unsupported DDS FourCC format: ${info.format}`)
    }
  } else if (pfFlags & DDPF_RGB) {
    decodeUncompressedRgb(bytes, dataOffset, width, height, bitCount, rMask, gMask, bMask, aMask, rgbaData)
  } else if (pfFlags & DDPF_LUMINANCE) {
    decodeUncompressedRgb(bytes, dataOffset, width, height, bitCount, rMask, rMask, rMask, aMask, rgbaData)
  } else {
    throw new Error(`Unsupported DDS pixel format flags: 0x${pfFlags.toString(16)}`)
  }

  const toCanvas = (): HTMLCanvasElement => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx) {
      try {
        const imageData = typeof ImageData !== 'undefined'
          ? new ImageData(rgbaData, width, height)
          : ctx.createImageData
            ? ctx.createImageData(width, height)
            : null
        if (imageData && ctx.putImageData) {
          if (imageData.data && imageData.data !== rgbaData) {
            imageData.data.set(rgbaData)
          }
          ctx.putImageData(imageData, 0, 0)
        }
      } catch (e) {
        console.warn('Failed to paint imageData onto canvas:', e)
      }
    }
    return canvas
  }

  const toPngBlob = async (): Promise<Blob> => {
    const canvas = toCanvas()
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas failed to export PNG blob'))
      }, 'image/png')
    })
  }

  return {
    ...info,
    rgbaData,
    toCanvas,
    toPngBlob
  }
}
