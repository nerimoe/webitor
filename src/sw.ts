/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

const worker = globalThis as unknown as ServiceWorkerGlobalScope & { __WB_MANIFEST: PrecacheEntry[] }
const SHARE_ACTION_PATH = '/share-target'
const SHARE_CACHE_PATH = '/__share-target/'
const SHARE_CACHE_NAME = 'webitor-share-target-v1'
const SHARE_FILE_FIELD = 'files'
const SHARE_TOKEN_PATTERN = /^[a-f0-9]{32}$/
const MAX_SHARED_FILES = 50
const STALE_SHARE_MS = 24 * 60 * 60 * 1000

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function internalSharePath(shareToken: string, index: number) {
  return `${SHARE_CACHE_PATH}${shareToken}/${index}`
}

async function deleteShare(cache: Cache, origin: string, shareToken: string) {
  const prefix = new URL(`${SHARE_CACHE_PATH}${shareToken}/`, origin).href
  const keys = await cache.keys()
  await Promise.all(keys.filter((request) => request.url.startsWith(prefix)).map((request) => cache.delete(request)))
}

async function pruneStaleShares(cache: Cache) {
  const now = Date.now()
  const keys = await cache.keys()
  await Promise.all(keys.map(async (request) => {
    const cached = await cache.match(request)
    const createdAt = Number(cached?.headers.get('X-Webitor-Created-At'))
    if (!Number.isFinite(createdAt) || now - createdAt > STALE_SHARE_MS) await cache.delete(request)
  }))
}

function redirectToApp(request: Request, parameters: Record<string, string>) {
  const url = new URL('/', request.url)
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value)
  return Response.redirect(url, 303)
}

async function receiveSharedFiles(request: Request) {
  try {
    const form = await request.formData()
    const files = form.getAll(SHARE_FILE_FIELD).filter((value): value is File => value instanceof File && value.name.length > 0)
    if (!files.length || files.length > MAX_SHARED_FILES) return redirectToApp(request, { 'share-target-error': 'invalid' })

    const cache = await caches.open(SHARE_CACHE_NAME)
    await pruneStaleShares(cache)
    const shareToken = token()
    const createdAt = String(Date.now())
    try {
      await Promise.all(files.map((file, index) => cache.put(new URL(internalSharePath(shareToken, index), request.url), new Response(file, {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Webitor-Created-At': createdAt,
          'X-Webitor-File-Name': encodeURIComponent(file.name),
          'X-Webitor-Last-Modified': String(file.lastModified)
        }
      }))))
    } catch (error) {
      await deleteShare(cache, request.url, shareToken)
      throw error
    }
    return redirectToApp(request, { 'share-target': shareToken, count: String(files.length) })
  } catch (error) {
    console.error('Web Share Target handoff failed:', error)
    return redirectToApp(request, { 'share-target-error': 'unavailable' })
  }
}

async function serveSharedFile(request: Request, url: URL) {
  const parts = url.pathname.slice(SHARE_CACHE_PATH.length).split('/')
  const shareToken = parts[0]
  if (!SHARE_TOKEN_PATTERN.test(shareToken)) return new Response(null, { status: 404 })
  const cache = await caches.open(SHARE_CACHE_NAME)
  if (request.method === 'DELETE' && parts.length === 1) {
    await deleteShare(cache, url.origin, shareToken)
    return new Response(null, { status: 204 })
  }
  if (request.method !== 'GET' || parts.length !== 2 || !/^\d{1,2}$/.test(parts[1])) return new Response(null, { status: 404 })
  return await cache.match(request) ?? new Response(null, { status: 404 })
}

worker.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== worker.location.origin) return
  if (event.request.method === 'POST' && url.pathname === SHARE_ACTION_PATH) {
    event.respondWith(receiveSharedFiles(event.request))
  } else if (url.pathname.startsWith(SHARE_CACHE_PATH)) {
    event.respondWith(serveSharedFile(event.request, url))
  }
})
worker.addEventListener('activate', (event) => {
  event.waitUntil(caches.open(SHARE_CACHE_NAME).then(pruneStaleShares))
})

worker.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute((self as unknown as ServiceWorkerGlobalScope & { __WB_MANIFEST: PrecacheEntry[] }).__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), {
  denylist: [/^\/api\//, /^\/share-target$/, /^\/__share-target\//]
}))
