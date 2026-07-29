const SHARE_TARGET_PARAM = 'share-target'
const SHARE_TARGET_COUNT_PARAM = 'count'
const SHARE_TARGET_ERROR_PARAM = 'share-target-error'
const SHARE_TARGET_PATH = '/__share-target'
const SHARE_TOKEN_PATTERN = /^[a-f0-9]{32}$/
const MAX_SHARED_FILES = 50

export class ShareTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareTargetError'
  }
}

export function hasShareTargetMarker(search = location.search) {
  const parameters = new URLSearchParams(search)
  return parameters.has(SHARE_TARGET_PARAM) || parameters.has(SHARE_TARGET_ERROR_PARAM)
}

export function cleanShareTargetUrl() {
  const url = new URL(location.href)
  url.searchParams.delete(SHARE_TARGET_PARAM)
  url.searchParams.delete(SHARE_TARGET_COUNT_PARAM)
  url.searchParams.delete(SHARE_TARGET_ERROR_PARAM)
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function descriptorFrom(href: string) {
  const url = new URL(href)
  if (url.searchParams.has(SHARE_TARGET_ERROR_PARAM)) throw new ShareTargetError('The operating system share could not be received')
  const shareToken = url.searchParams.get(SHARE_TARGET_PARAM)
  const count = Number(url.searchParams.get(SHARE_TARGET_COUNT_PARAM))
  if (!shareToken || !SHARE_TOKEN_PATTERN.test(shareToken) || !Number.isSafeInteger(count) || count < 1 || count > MAX_SHARED_FILES) {
    throw new ShareTargetError('The operating system share is invalid')
  }
  return { shareToken, count }
}

function fileName(response: Response) {
  const encoded = response.headers.get('X-Webitor-File-Name')
  if (!encoded) throw new ShareTargetError('A shared file has no name')
  try {
    const name = decodeURIComponent(encoded).split(/[\\/]/).at(-1)?.trim()
    if (!name) throw new ShareTargetError('A shared file has no valid name')
    return name
  } catch (error) {
    if (error instanceof ShareTargetError) throw error
    throw new ShareTargetError('A shared file name is invalid')
  }
}

export async function readShareTargetFiles(href = location.href) {
  const { shareToken, count } = descriptorFrom(href)
  const files: File[] = []
  for (let index = 0; index < count; index += 1) {
    const response = await fetch(`${SHARE_TARGET_PATH}/${shareToken}/${index}`, { cache: 'no-store' })
    if (!response.ok) throw new ShareTargetError('A shared file is no longer available')
    const bytes = await response.arrayBuffer()
    const modified = Number(response.headers.get('X-Webitor-Last-Modified'))
    files.push(new File([bytes], fileName(response), {
      type: response.headers.get('Content-Type') || 'application/octet-stream',
      ...(Number.isFinite(modified) && modified >= 0 ? { lastModified: modified } : {})
    }))
  }
  return {
    files,
    cleanup: () => fetch(`${SHARE_TARGET_PATH}/${shareToken}`, { method: 'DELETE' }).then((response) => {
      if (!response.ok) throw new ShareTargetError('Shared file cleanup failed')
    })
  }
}
