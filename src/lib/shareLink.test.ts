import { describe, expect, it, vi } from 'vitest'
import { createFileShareUrl, readFileShareHash, shareOrCopyFileUrl } from './shareLink'

describe('file share links', () => {
  it('round-trips a compressed text file', async () => {
    const text = 'A local document with repeated text. '.repeat(200)
    const url = await createFileShareUrl({ name: 'notes.md', text })
    const hash = new URL(url).hash
    expect(hash).toMatch(/^#share=[gu]\./)
    await expect(readFileShareHash(hash)).resolves.toEqual({ name: 'notes.md', text })
  })

  it('uses compact packing for varied Chinese prose', async () => {
    const alphabet = '我的你是了不们这一他么在有个好来人那要会就什没到说吗为想能上去道她很看可知得过吧还对里以都事子生时样也和下真现做大啊怎出点起天把开让给但谢着只些如家后儿多意别所话小自回然果发见心走定听觉太该当经妈用打地再因呢女告最手前找行快而死先像等被从明中哦情作跟面诉爱已之问错孩斯成它感干法电间哪西己候次信欢正实关进车年喜认克爸谁方老应比帮无晚动头机分特相全杀需放常直才美于带今力工许东名同长亲种者嘿白学安尔叫理本国第友高两保请非重公记身受住活加何伙题完接拿望解其离谈又新更钱马思部场嗯计任确吃始结利朋警士外件难位表刚希查拉'
    let state = 17
    let text = ''
    for (let index = 0; index < 2000; index += 1) {
      state = state * 48271 % 2147483647
      text += alphabet[state % alphabet.length]
    }
    const url = await createFileShareUrl({ name: '文章.txt', text })
    expect(url.length).toBeLessThan(3400)
    await expect(readFileShareHash(new URL(url).hash)).resolves.toEqual({ name: '文章.txt', text })
  })

  it('keeps supported image metadata', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const url = await createFileShareUrl({ name: 'pixel.png', text: '', dataUrl, mimeType: 'image/png' })
    await expect(readFileShareHash(new URL(url).hash)).resolves.toEqual({ name: 'pixel.png', text: '', dataUrl, mimeType: 'image/png' })
  })

  it('does not base64-encode image bytes twice', async () => {
    const bytes = new Uint8Array(311 * 1024)
    let state = 0x12345678
    for (let index = 0; index < bytes.length; index += 1) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      bytes[index] = state & 0xff
    }
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    const dataUrl = `data:image/png;base64,${btoa(binary)}`
    const url = await createFileShareUrl({ name: 'photo.png', text: '', dataUrl, mimeType: 'image/png' })
    expect(url.length).toBeLessThan(dataUrl.length + 500)
    await expect(readFileShareHash(new URL(url).hash)).resolves.toEqual({ name: 'photo.png', text: '', dataUrl, mimeType: 'image/png' })
  })

  it('rejects malformed share data', async () => {
    await expect(readFileShareHash('#share=u.invalid!')).rejects.toThrow()
  })

  it('copies long links instead of passing them to a truncating share sheet', async () => {
    const share = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'share')
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      await expect(shareOrCopyFileUrl('x'.repeat(60_001), 'photo.png')).resolves.toBe('copied')
      expect(share).not.toHaveBeenCalled()
      expect(writeText).toHaveBeenCalledOnce()
    } finally {
      if (shareDescriptor) Object.defineProperty(navigator, 'share', shareDescriptor)
      else Reflect.deleteProperty(navigator, 'share')
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})
