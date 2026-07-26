declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  interface HeifImage {
    display(target: ImageData, callback: (result: ImageData | null) => void): void
    free(): void
    get_height(): number
    get_width(): number
    is_primary(): boolean
  }

  interface HeifDecoder {
    decode(data: ArrayBuffer | Uint8Array): HeifImage[]
  }

  interface LibheifModule {
    HeifDecoder: new () => HeifDecoder
  }

  export default function createLibheif(): LibheifModule
}
