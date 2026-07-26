/// <reference lib="webworker" />

import createLibheif from 'libheif-js/libheif-wasm/libheif-bundle.mjs'

const libheif = createLibheif()

const MAX_FRAMES = 64
const MAX_FRAME_PIXELS = 100_000_000
const MAX_TOTAL_PIXELS = 200_000_000

type DecodeRequest = { buffer: ArrayBuffer }
type DecodedFrame = { blob: Blob; width: number; height: number }

function decodeImage(image: ReturnType<InstanceType<typeof libheif.HeifDecoder>['decode']>[number]) {
  const width = image.get_width()
  const height = image.get_height()
  const pixels = width * height
  if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > MAX_FRAME_PIXELS) throw new Error('HEIF image dimensions exceed the preview limit')
  const imageData = new ImageData(width, height)
  return new Promise<ImageData>((resolve, reject) => {
    image.display(imageData, (result) => result ? resolve(result) : reject(new Error('HEIF image decoding failed')))
  })
}

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const decoder = new libheif.HeifDecoder()
  const images = decoder.decode(event.data.buffer)
  try {
    if (!images.length) throw new Error('No images were found in this HEIF file')
    if (images.length > MAX_FRAMES) throw new Error('This HEIF file contains too many images to preview')
    let totalPixels = 0
    const frames: DecodedFrame[] = []
    for (const image of images) {
      const width = image.get_width()
      const height = image.get_height()
      totalPixels += width * height
      if (!Number.isSafeInteger(totalPixels) || totalPixels > MAX_TOTAL_PIXELS) throw new Error('HEIF images exceed the preview limit')
      const imageData = await decodeImage(image)
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Image canvas is unavailable')
      context.putImageData(imageData, 0, 0)
      frames.push({ blob: await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 }), width, height })
    }
    self.postMessage({ frames })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  } finally {
    images.forEach((image) => image.free())
  }
}

export {}
