import { expect, test } from '@playwright/test'

function createSampleDdsBuffer(width = 128, height = 128): Buffer {
  const headerSize = 128
  const pixelCount = width * height
  const buffer = Buffer.alloc(headerSize + pixelCount * 4)

  // Magic: 'DDS '
  buffer.writeUInt32LE(0x20534444, 0)
  // dwSize: 124
  buffer.writeUInt32LE(124, 4)
  // dwFlags
  buffer.writeUInt32LE(0x1007, 8)
  // dwHeight, dwWidth
  buffer.writeUInt32LE(height, 12)
  buffer.writeUInt32LE(width, 16)
  // dwPitchOrLinearSize
  buffer.writeUInt32LE(width * 4, 20)
  // dwMipMapCount
  buffer.writeUInt32LE(1, 28)

  // ddspf (offset 76)
  buffer.writeUInt32LE(32, 76) // dwSize
  buffer.writeUInt32LE(0x41, 80) // DDPF_RGB | DDPF_ALPHAPIXELS
  buffer.writeUInt32LE(0, 84) // fourCC
  buffer.writeUInt32LE(32, 88) // bitCount
  buffer.writeUInt32LE(0x000000ff, 92) // rMask
  buffer.writeUInt32LE(0x0000ff00, 96) // gMask
  buffer.writeUInt32LE(0x00ff0000, 100) // bMask
  buffer.writeUInt32LE(0xff000000, 104) // aMask

  // Draw a gradient pattern
  let offset = headerSize
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const r = Math.floor((x / width) * 255)
      const g = Math.floor((y / height) * 255)
      const b = 180
      const a = 255
      buffer.writeUInt8(r, offset)
      buffer.writeUInt8(g, offset + 1)
      buffer.writeUInt8(b, offset + 2)
      buffer.writeUInt8(a, offset + 3)
      offset += 4
    }
  }

  return buffer
}

function createDxt1DdsBuffer(): Buffer {
  const width = 64
  const height = 64
  const blockCount = (width / 4) * (height / 4) // 16 * 16 = 256 blocks
  const buffer = Buffer.alloc(128 + blockCount * 8)

  // Magic 'DDS '
  buffer.writeUInt32LE(0x20534444, 0)
  buffer.writeUInt32LE(124, 4)
  buffer.writeUInt32LE(0x1007, 8)
  buffer.writeUInt32LE(height, 12)
  buffer.writeUInt32LE(width, 16)
  buffer.writeUInt32LE(1, 28)

  // ddspf
  buffer.writeUInt32LE(32, 76)
  buffer.writeUInt32LE(0x4, 80) // DDPF_FOURCC
  buffer.write('DXT1', 84, 4, 'ascii')

  let offset = 128
  for (let i = 0; i < blockCount; i += 1) {
    // c0: Red (0xF800), c1: Blue (0x001F)
    buffer.writeUInt16LE(0xf800, offset)
    buffer.writeUInt16LE(0x001f, offset + 2)
    // 2x2 pattern
    buffer.writeUInt32LE(0x55aa55aa, offset + 4)
    offset += 8
  }

  return buffer
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => indexedDB.deleteDatabase('local-ide'))
  await page.reload()
})

test('imports DDS texture, displays preview and badges, and converts to PNG', async ({ page }) => {
  const ddsBuffer = createSampleDdsBuffer(128, 128)

  // 1. Import DDS texture file
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'cyber_gradient.dds',
    mimeType: 'image/vnd-ms.dds',
    buffer: ddsBuffer
  })

  // Verify file in sidebar
  const sidebar = page.getByTestId('sidebar')
  await expect(sidebar.getByText('cyber_gradient.dds')).toBeVisible()

  // 2. Open DDS file
  await sidebar.getByText('cyber_gradient.dds').click()

  // Verify DDS viewer is loaded
  const ddsView = page.getByTestId('dds-document-view')
  await expect(ddsView).toBeVisible()

  // Verify metadata badges
  await expect(ddsView.getByText('32-bit RGBA')).toBeVisible()
  await expect(ddsView.getByText('128 × 128')).toBeVisible()

  // Verify image preview is rendered
  const imagePreview = ddsView.getByTestId('image-preview')
  await expect(imagePreview).toBeVisible()

  // Take screenshot of DDS Document View
  await page.screenshot({ path: 'test-results/dds-document-view.png', fullPage: true })

  // 3. Click "转换为 PNG 并保存到工作区" (Save PNG to workspace)
  const exportBtn = ddsView.getByRole('button', { name: /Save PNG to workspace|转换为 PNG 并保存到工作区/ })
  await exportBtn.click()

  // 4. Verify converted PNG appears in sidebar tree
  await expect(sidebar.getByText('cyber_gradient.png')).toBeVisible()

  // 5. Open the newly converted PNG
  await sidebar.getByText('cyber_gradient.png').click()

  // Verify it displays as an Image viewer
  await expect(page.getByTestId('image-preview')).toBeVisible()
  await page.screenshot({ path: 'test-results/dds-converted-png-view.png', fullPage: true })
})

test('imports and decodes DXT1 / BC1 compressed DDS texture', async ({ page }) => {
  const dxt1Buffer = createDxt1DdsBuffer()

  await page.locator('input[type=file]').first().setInputFiles({
    name: 'pattern_dxt1.dds',
    mimeType: 'image/vnd-ms.dds',
    buffer: dxt1Buffer
  })

  const sidebar = page.getByTestId('sidebar')
  await expect(sidebar.getByText('pattern_dxt1.dds')).toBeVisible()
  await sidebar.getByText('pattern_dxt1.dds').click()

  const ddsView = page.getByTestId('dds-document-view')
  await expect(ddsView).toBeVisible()
  await expect(ddsView.getByText('BC1 / DXT1')).toBeVisible()
  await expect(ddsView.getByText('64 × 64')).toBeVisible()

  await page.screenshot({ path: 'test-results/dds-dxt1-preview.png', fullPage: true })
})
