import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => indexedDB.deleteDatabase('local-ide'))
  await page.reload()
})

test('creates and restores a local file', async ({ page }) => {
  page.once('dialog', async (dialog) => dialog.accept('notes.md'))
  await page.getByRole('button', { name: /New file|新建文件/ }).first().click()
  await expect(page.locator('.document-title')).toContainText(/notes.md|untitled.txt/)
  const editor = page.locator('.cm-content')
  await editor.fill('# Offline note')
  await page.waitForTimeout(1200)
  await page.reload()
  await expect(page.locator('.document-title')).toContainText(/notes.md|untitled.txt/)
  await expect(page.locator('.cm-content')).toContainText('Offline note')
})

test('retries workspace restoration without reloading the page', async ({ page }) => {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('local-ide')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction('state', 'readwrite').objectStore('state').put({ schemaVersion: 5, broken: true }, 'current')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    db.close()
  })
  await page.reload()
  await expect(page.getByRole('alert')).toContainText(/could not be restored|无法恢复上次的工作区/)

  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('local-ide')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction('state', 'readwrite').objectStore('state').delete('current')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    db.close()
  })
  await page.getByRole('button', { name: /Retry|重试/ }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByTestId('no-file-state')).toBeVisible()
})

test('shows file type, line count, and character count in the document footer', async ({ page }) => {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'statistics.txt', mimeType: 'text/plain', buffer: Buffer.from('First line\nSecond') })
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await page.getByTestId('sidebar').getByText('statistics.txt', { exact: true }).click()
  const statusBar = page.getByTestId('editor-primary').getByTestId('document-status-bar')
  await expect(statusBar).toContainText(/Plain text|纯文本/)
  await expect(statusBar).toContainText(/Lines: 2|2 行/)
  await expect(statusBar).toContainText(/Characters: 17|17 个字符/)
  await page.locator('.cm-content').fill('One')
  await expect(statusBar).toContainText(/Lines: 1|1 行/)
  await expect(statusBar).toContainText(/Characters: 3|3 个字符/)
})

test('imports files through the browser fallback', async ({ page }) => {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'hello.ts', mimeType: 'text/typescript', buffer: Buffer.from('const hello = 1') })
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await expect(page.getByText('hello.ts')).toBeVisible()
})

test('uses the drawer layout at iPad portrait width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'ipad')
  await expect(page.getByTestId('sidebar')).toBeHidden()
  await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await expect(page.getByTestId('sidebar')).toBeVisible()
})

test('opens a file dropped on the editor', async ({ page }) => {
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.items.add(new File(['Dropped text'], 'dropped.txt', { type: 'text/plain' }))
    return data
  })
  const target = (page.viewportSize()?.width ?? 1000) < 900 ? page.locator('.mobile-editor') : page.locator('.editor-area')
  await target.dispatchEvent('drop', { dataTransfer: transfer })
  await expect(page.locator('.document-title')).toContainText('dropped.txt')
  await expect(page.locator('.cm-content')).toContainText('Dropped text')
})

test('reimports the same share link through the normal conflict flow', async ({ page }, testInfo) => {
  let uploadRequests = 0
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/api/shares/')) uploadRequests += 1
  })
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => { (window as Window & { __sharedFileUrl?: string }).__sharedFileUrl = String(data.url) }
    })
  })
  const alphabet = '我的你是了不们这一他么在有个好来人那要会就什没到说吗为想能上去道她很看可知得过吧还对里以都事子生时样也和下真现做大啊怎出点起天把开让给但谢着只些如家后儿多意别所话小自回然果发见心走定听觉太该当经妈用打地再因呢女告最手前找行快而死先像等被从明中哦情作跟面诉爱已之问错孩斯成它感干法电间哪西己候次信欢正实关进车年喜认克爸谁方老应比帮无晚动头机分特相全杀需放常直才美于带今力工许东名同长亲种者嘿白学安尔叫理本国第友高两保请非重公记身受住活加何伙题完接拿望解其离谈又新更钱马思部场嗯计任确吃始结利朋警士外件难位表刚希查拉'
  let randomState = 17
  let text = ''
  for (let index = 0; index < 2000; index += 1) {
    randomState = randomState * 48271 % 2147483647
    text += alphabet[randomState % alphabet.length]
  }
  await page.locator('input[type=file]').first().setInputFiles({ name: 'shared-note.txt', mimeType: 'text/plain', buffer: Buffer.from(text) })
  if (testInfo.project.name === 'ipad') await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await page.getByTestId('sidebar').getByText('shared-note.txt', { exact: true }).click()
  const shareLink = page.getByRole('button', { name: /Create share link|创建分享链接/ })
  if (await shareLink.isVisible()) await shareLink.click()
  else {
    await page.getByRole('button', { name: /More actions|更多操作/ }).click()
    await page.getByRole('menuitem', { name: /Create share link|创建分享链接/ }).click()
  }
  await expect(page.getByRole('dialog')).toContainText(/Create a share link|创建分享链接/i)
  expect(uploadRequests).toBe(0)
  await page.getByRole('button', { name: /^(Create link|创建链接)$/ }).click()
  await expect.poll(() => uploadRequests).toBe(1)
  const qrCode = page.getByRole('img', { name: /QR code for the share link|分享链接二维码/ })
  await expect(qrCode).toBeVisible()
  await expect.poll(() => qrCode.evaluate((canvas) => {
    const context = (canvas as HTMLCanvasElement).getContext('2d')
    if (!context) return false
    const pixels = context.getImageData(0, 0, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height).data
    let hasDark = false
    let hasLight = false
    for (let index = 0; index < pixels.length; index += 4) {
      const brightness = pixels[index] + pixels[index + 1] + pixels[index + 2]
      if (pixels[index + 3] > 0 && brightness < 96) hasDark = true
      if (pixels[index + 3] > 0 && brightness > 672) hasLight = true
      if (hasDark && hasLight) return true
    }
    return false
  })).toBe(true)
  await page.getByRole('button', { name: /^(Share link|分享链接)$/ }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __sharedFileUrl?: string }).__sharedFileUrl)).toContain('?share=')
  const url = await page.evaluate(() => (window as Window & { __sharedFileUrl?: string }).__sharedFileUrl)
  expect(url).toMatch(/\?share=[A-Za-z0-9_-]{16}#key=[A-Za-z0-9_-]{43}$/)
  expect(url!.length).toBeLessThan(150)
  expect(url).not.toContain(text.slice(0, 16))
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (request.method === 'GET' && new URL(request.url).pathname.startsWith('/api/shares/')) {
        await new Promise((resolve) => setTimeout(resolve, 1200))
      }
      return originalFetch(input, init)
    }
  })
  await page.goto(url!)
  await expect(page.locator('.transfer-status')).toContainText(/Opening shared file|正在打开分享文件/i)
  await expect(page.getByRole('dialog')).toContainText('shared-note.txt')
  await page.getByRole('button', { name: /Keep both|保留两份/ }).click()
  await expect(page.getByTestId('editor-primary').locator('.document-title')).toContainText('shared-note 2.txt')
  await expect(page.getByTestId('editor-primary').locator('.cm-content')).toContainText(text.slice(0, 32))
  if (testInfo.project.name === 'ipad') await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await expect(page.getByTestId('sidebar').locator('.tree-row')).toHaveCount(2)
  await expect.poll(() => page.url()).not.toContain('?share=')

  await page.goto(url!)
  await expect(page.getByRole('dialog')).toContainText('shared-note.txt')
  await page.getByRole('button', { name: /Keep both|保留两份/ }).click()
  await expect(page.getByTestId('editor-primary').locator('.document-title')).toContainText('shared-note 3.txt')
  await expect(page.getByTestId('editor-primary').locator('.cm-content')).toContainText(text.slice(0, 32))
  if (testInfo.project.name === 'ipad') await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await expect(page.getByTestId('sidebar').locator('.tree-row')).toHaveCount(3)
  await expect.poll(() => page.url()).not.toContain('?share=')
})

test('can overwrite an existing file when importing a share link', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => { (window as Window & { __sharedFileUrl?: string }).__sharedFileUrl = String(data.url) }
    })
  })
  await page.locator('input[type=file]').first().setInputFiles({ name: 'replace-me.txt', mimeType: 'text/plain', buffer: Buffer.from('Original shared text') })
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await page.getByTestId('sidebar').getByText('replace-me.txt', { exact: true }).click()
  const shareLink = page.getByRole('button', { name: /Create share link|创建分享链接/ })
  if (await shareLink.isVisible()) await shareLink.click()
  else {
    await page.getByRole('button', { name: /More actions|更多操作/ }).click()
    await page.getByRole('menuitem', { name: /Create share link|创建分享链接/ }).click()
  }
  await page.getByRole('button', { name: /^(Create link|创建链接)$/ }).click()
  await page.getByRole('button', { name: /^(Share link|分享链接)$/ }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __sharedFileUrl?: string }).__sharedFileUrl)).toContain('?share=')
  const url = await page.evaluate(() => (window as Window & { __sharedFileUrl?: string }).__sharedFileUrl)
  await page.locator('.cm-content').fill('Locally changed text')
  await page.goto(url!)
  await expect(page.getByRole('dialog')).toContainText('replace-me.txt')
  await page.getByRole('button', { name: /^(Replace|覆盖)$/ }).click()
  await expect(page.locator('.cm-content')).toContainText('Original shared text')
  await expect(page.locator('.cm-content')).not.toContainText('Locally changed text')
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await expect(page.getByTestId('sidebar').locator('.tree-row')).toHaveCount(1)
})

test('explains missing and corrupt shared file data', async ({ page }) => {
  await page.goto('/?share=AAAAAAAAAAAAAAAA')
  await expect(page.getByRole('alert')).toContainText(/missing|incomplete|缺少|不完整/i)
  await expect.poll(() => page.url()).not.toContain('?share=')
  await page.goto('/?share=AAAAAAAAAAAAAAAA#key=invalid')
  await expect(page.getByRole('alert')).toContainText(/invalid|无效|损坏/i)
  await expect.poll(() => page.url()).not.toContain('?share=')
})

test('offers split and single-view targets for external editor drops', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'current.txt', mimeType: 'text/plain', buffer: Buffer.from('Current') })
  await page.getByTestId('sidebar').getByText('current.txt', { exact: true }).click()
  const editor = page.locator('.editor-area')
  const dropFile = async (name: string, target: string) => {
    const transfer = await page.evaluateHandle((fileName) => {
      const data = new DataTransfer()
      data.items.add(new File([fileName], fileName, { type: 'text/plain' }))
      return data
    }, name)
    await editor.dispatchEvent('dragenter', { dataTransfer: transfer })
    await expect(page.locator('.external-editor-drop-zones')).toBeVisible()
    await page.locator(target).dispatchEvent('drop', { dataTransfer: transfer })
  }

  await dropFile('left.txt', '.external-drop-left')
  await expect(page.getByTestId('editor-primary')).toContainText('left.txt')
  await expect(page.getByTestId('editor-secondary')).toContainText('current.txt')

  await dropFile('right.txt', '.external-drop-right')
  await expect(page.getByTestId('editor-primary')).toContainText('left.txt')
  await expect(page.getByTestId('editor-secondary')).toContainText('right.txt')

  await dropFile('single.txt', '.external-drop-single')
  await expect(page.getByTestId('editor-primary')).toContainText('single.txt')
  await expect(page.getByTestId('editor-secondary')).toHaveCount(0)
})

test('keeps undo history isolated between files', async ({ page }) => {
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'alpha.txt', mimeType: 'text/plain', buffer: Buffer.from('Alpha') },
    { name: 'beta.txt', mimeType: 'text/plain', buffer: Buffer.from('Beta') }
  ])
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  const sidebar = page.getByTestId('sidebar')
  await sidebar.getByText('alpha.txt', { exact: true }).click()
  await page.locator('.cm-content').fill('Alpha changed')
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await sidebar.getByText('beta.txt', { exact: true }).click()
  await page.locator('.cm-content').press('ControlOrMeta+z')
  await expect(page.locator('.cm-content')).toContainText('Beta')
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await sidebar.getByText('alpha.txt', { exact: true }).click()
  await page.locator('.cm-content').press('ControlOrMeta+z')
  await expect(page.locator('.cm-content')).toContainText('Alpha')
})

test('renames the selected file with Enter', async ({ page }) => {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'draft.txt', mimeType: 'text/plain', buffer: Buffer.from('Draft') })
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  const row = page.getByTestId('sidebar').locator('.tree-row', { hasText: 'draft.txt' })
  page.once('dialog', async (dialog) => dialog.accept('renamed.txt'))
  await row.press('Enter')
  await expect(page.getByTestId('sidebar').getByText('renamed.txt', { exact: true })).toBeVisible()
})

test('can close the last open document and start another from the editor', async ({ page }) => {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'close-me.txt', mimeType: 'text/plain', buffer: Buffer.from('Close me') })
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await page.getByTestId('sidebar').getByText('close-me.txt', { exact: true }).click()
  await page.getByRole('button', { name: /Close document|关闭文档/ }).click()
  await expect(page.getByTestId('no-file-state')).toBeVisible()
  await page.getByTestId('no-file-state').getByRole('button', { name: /New file|新建文件/ }).click()
  await expect(page.locator('.document-title')).toContainText('untitled')
})

test('renames a document directly from its title', async ({ page }) => {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'quick-name.txt', mimeType: 'text/plain', buffer: Buffer.from('Text') })
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await page.getByTestId('sidebar').getByText('quick-name.txt', { exact: true }).click()
  await page.locator('.title-button').click()
  await page.locator('.title-rename').fill('renamed-inline.txt')
  await page.locator('.title-rename').press('Enter')
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await expect(page.getByTestId('sidebar').getByText('renamed-inline.txt', { exact: true })).toBeVisible()
})

test('preserves the file name and expands document actions when space returns', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 440, height: 720 })
  await page.locator('input[type=file]').first().setInputFiles({ name: 'untitled.txt', mimeType: 'text/plain', buffer: Buffer.from('Text') })
  await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await page.getByTestId('sidebar').getByText('untitled.txt', { exact: true }).click()
  const bar = page.locator('.document-bar')
  const actions = bar.locator('.editor-actions')
  const more = actions.getByRole('button', { name: /More actions|更多操作/ })
  const close = actions.getByRole('button', { name: /Close document|关闭文档/ })
  await expect(more).toBeVisible()
  await expect(close).toBeVisible()
  await expect(actions.getByRole('button', { name: /Editing timeline|编辑时间线/ })).toHaveCount(0)
  const moreBox = await more.boundingBox()
  const closeBox = await close.boundingBox()
  expect(moreBox).not.toBeNull()
  expect(closeBox).not.toBeNull()
  expect(closeBox!.x).toBeGreaterThan(moreBox!.x)
  await expect(bar.locator('.title-button span')).toHaveText('untitled.txt')
  expect(await bar.locator('.title-button span').evaluate((title) => title.scrollWidth <= title.clientWidth)).toBe(true)

  await page.setViewportSize({ width: 1100, height: 720 })
  await expect(actions.getByRole('button', { name: /Editing timeline|编辑时间线/ })).toBeVisible()
  await expect(actions.getByRole('button', { name: /Increase text size|增大文字/ })).toBeVisible()
  await expect(actions.getByRole('button', { name: /Decrease text size|减小文字/ })).toBeVisible()
  const fontSize = actions.getByRole('button', { name: /Reset text size.*16 px|重置字号.*16 px/ })
  await expect(fontSize).toHaveText('16')
  await actions.getByRole('button', { name: /Increase text size|增大文字/ }).click()
  await expect(actions.getByRole('button', { name: /Reset text size.*17 px|重置字号.*17 px/ })).toHaveText('17')
  await actions.getByRole('button', { name: /Reset text size.*17 px|重置字号.*17 px/ }).click()
  await expect(actions.getByRole('button', { name: /Reset text size.*16 px|重置字号.*16 px/ })).toHaveText('16')
  if (testInfo.project.name !== 'ipad') await expect(actions.getByRole('button', { name: /Download|下载/ })).toBeVisible()
  await expect(actions.getByRole('button', { name: /More actions|更多操作/ })).toHaveCount(0)
  const sidebarActions = page.getByTestId('sidebar').locator('.sidebar-actions')
  await expect(sidebarActions.getByRole('button', { name: /New folder|新建文件夹/ })).toBeVisible()
})

test('expands every sidebar command when the sidebar is wide enough', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium')
  await page.setViewportSize({ width: 1400, height: 720 })
  await page.locator('input[type=file]').first().setInputFiles({ name: 'sidebar.txt', mimeType: 'text/plain', buffer: Buffer.from('Text') })
  const handle = page.locator('.workbench .resize-handle')
  await expect(handle).toHaveCount(1)
  const handleBox = await handle.boundingBox()
  expect(handleBox).not.toBeNull()
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox!.x + 220, handleBox!.y + handleBox!.height / 2)
  await page.mouse.up()

  const sidebarActions = page.getByTestId('sidebar').locator('.sidebar-actions')
  for (const name of [/Hide file list|隐藏文件列表/, /New file|新建文件/, /New folder|新建文件夹/, /Search documents|搜索文档/, /Settings|设置/, /Import files|导入文件/, /Import folder|导入文件夹/, /Export workspace|导出工作区/]) {
    await expect(sidebarActions.getByRole('button', { name })).toBeVisible()
  }
  await expect(sidebarActions.getByRole('button', { name: /More actions|更多操作/ })).toHaveCount(0)
  const expandedHandle = page.locator('.sidebar-resize')
  const expandedHandleBox = await expandedHandle.boundingBox()
  expect(expandedHandleBox).not.toBeNull()
  await page.mouse.move(expandedHandleBox!.x + expandedHandleBox!.width / 2, expandedHandleBox!.y + expandedHandleBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(60, expandedHandleBox!.y + expandedHandleBox!.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('aside.sidebar')).toBeHidden()
  const showSidebar = page.getByRole('button', { name: /Show file list|显示文件列表/ })
  await expect(showSidebar).toBeVisible()
  await showSidebar.click()
  await expect(page.locator('aside.sidebar')).toBeVisible()
})

test('starts resizing from the expanded separator hit target', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium')
  await page.setViewportSize({ width: 1400, height: 720 })
  const sidebar = page.locator('#sidebar[data-panel]')
  const handle = page.locator('.sidebar-resize')
  const before = await sidebar.boundingBox()
  const handleBox = await handle.boundingBox()
  expect(before).not.toBeNull()
  expect(handleBox).not.toBeNull()
  await page.mouse.move(handleBox!.x - 8, handleBox!.y + handleBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox!.x + 72, handleBox!.y + handleBox!.height / 2)
  await page.mouse.up()
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(before!.width + 50)
})

test('switches a Markdown file between its text and preview providers', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'ipad')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'README.md', mimeType: 'text/markdown', buffer: Buffer.from('# Preview') })
  await page.getByTestId('sidebar').getByText('README.md', { exact: true }).click()
  await page.getByRole('tab', { name: /Markdown preview|Markdown 预览/ }).click()
  await expect(page.getByTestId('markdown-preview')).toBeVisible()
  await expect(page.locator('.document-bar')).toHaveCount(1)
  await page.getByRole('tab', { name: /Text editor|文本编辑/ }).click()
  await expect(page.getByTestId('markdown-preview')).toHaveCount(0)
  await expect(page.locator('.cm-content')).toBeVisible()
})

test('closes the secondary pane when the viewport becomes narrow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium')
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.locator('input[type=file]').first().setInputFiles({ name: 'responsive.md', mimeType: 'text/markdown', buffer: Buffer.from('# Responsive') })
  await page.getByTestId('sidebar').getByText('responsive.md', { exact: true }).click()
  await page.getByRole('button', { name: /Show side by side|并排显示/ }).click()
  await expect(page.getByTestId('editor-secondary')).toBeVisible()

  await page.setViewportSize({ width: 768, height: 1024 })
  await expect(page.getByTestId('editor-secondary')).toHaveCount(0)
  await expect(page.locator('.group-switch')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /Text editor|文本编辑/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Markdown preview|Markdown 预览/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Show side by side|并排显示/ })).toHaveCount(0)

  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(page.getByTestId('editor-secondary')).toHaveCount(0)
})

test('opens a file-list selection full screen from a split document', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'ipad')
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'note.md', mimeType: 'text/markdown', buffer: Buffer.from('# Note') },
    { name: 'plain.txt', mimeType: 'text/plain', buffer: Buffer.from('Plain') }
  ])
  const sidebar = page.getByTestId('sidebar')
  await sidebar.getByText('note.md', { exact: true }).click()
  await page.getByRole('button', { name: /Show side by side|并排显示/ }).click()
  await expect(page.getByTestId('editor-secondary').getByTestId('markdown-preview')).toBeVisible()
  await expect(page.getByTestId('shared-document-bar')).toHaveCount(1)
  await expect(page.locator('.pane-view-bar')).toHaveCount(2)
  await expect(page.getByTestId('shared-document-status')).toHaveCount(1)
  await expect(page.locator('.document-title')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Download|下载/ })).toHaveCount(1)
  await sidebar.getByText('plain.txt', { exact: true }).click()
  await expect(page.getByTestId('shared-document-bar')).toHaveCount(0)
  await expect(page.locator('.pane-view-bar')).toHaveCount(0)
  await expect(page.locator('.document-bar')).toHaveCount(1)
  await expect(page.getByTestId('editor-primary').locator('.document-title')).toContainText('plain.txt')
  await expect(page.getByTestId('editor-secondary')).toHaveCount(0)
  await expect(page.getByTestId('markdown-preview')).toHaveCount(0)
  expect(await page.locator('.editor-area').evaluate((editor) => editor.scrollWidth <= editor.clientWidth)).toBe(true)

  await sidebar.locator('.tree-row', { hasText: 'note.md' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Open on left|在左侧打开/ }).click()
  await expect(page.getByTestId('editor-primary').locator('.document-title')).toContainText('note.md')
  await expect(page.getByTestId('editor-secondary').locator('.document-title')).toContainText('plain.txt')
})

test('uses the next provider when a file is dragged into the other pane', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'dragged.md', mimeType: 'text/markdown', buffer: Buffer.from('# Dragged') })
  const sidebar = page.getByTestId('sidebar')
  await sidebar.getByText('dragged.md', { exact: true }).click()
  const source = sidebar.locator('.tree-row', { hasText: 'dragged.md' })
  const sourceBox = await source.boundingBox()
  const editorBox = await page.locator('.editor-area').boundingBox()
  expect(sourceBox).not.toBeNull()
  expect(editorBox).not.toBeNull()
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(sourceBox!.x + sourceBox!.width + 20, sourceBox!.y + sourceBox!.height / 2, { steps: 4 })
  await page.mouse.move(editorBox!.x + editorBox!.width * .75, editorBox!.y + editorBox!.height / 2, { steps: 12 })
  await expect(page.locator('.editor-split-zones > div:nth-child(2)')).toHaveClass(/active/)
  await page.mouse.up()

  await expect(page.getByTestId('editor-primary').locator('.cm-content')).toBeVisible()
  await expect(page.getByTestId('editor-secondary').getByTestId('markdown-preview')).toBeVisible()
  await expect(page.getByRole('button', { name: /Show side by side|并排显示/ })).toHaveCount(0)
  await expect(page.locator('.view-mode-label')).toHaveCount(2)

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(sourceBox!.x + sourceBox!.width + 20, sourceBox!.y + sourceBox!.height / 2, { steps: 4 })
  await page.mouse.move(editorBox!.x + editorBox!.width * .25, editorBox!.y + editorBox!.height / 2, { steps: 12 })
  await expect(page.locator('.editor-split-zones > div:nth-child(1)')).toHaveClass(/active/)
  await page.mouse.up()
  await expect(page.getByTestId('editor-primary').getByTestId('markdown-preview')).toBeVisible()
  await expect(page.getByTestId('editor-secondary').locator('.cm-content')).toBeVisible()

  const primaryBeforeSwap = await page.getByTestId('editor-primary').boundingBox()
  const secondaryBeforeSwap = await page.getByTestId('editor-secondary').boundingBox()
  const separator = page.locator('.editor-resize')
  const separatorBox = await separator.boundingBox()
  expect(primaryBeforeSwap).not.toBeNull()
  expect(secondaryBeforeSwap).not.toBeNull()
  expect(separatorBox).not.toBeNull()
  await page.mouse.dblclick(separatorBox!.x + separatorBox!.width / 2, separatorBox!.y + 180)
  await expect(page.getByTestId('editor-primary').locator('.cm-content')).toBeVisible()
  await expect(page.getByTestId('editor-secondary').getByTestId('markdown-preview')).toBeVisible()
  const primaryAfterSwap = await page.getByTestId('editor-primary').boundingBox()
  const secondaryAfterSwap = await page.getByTestId('editor-secondary').boundingBox()
  expect(Math.abs(primaryAfterSwap!.width - primaryBeforeSwap!.width)).toBeLessThan(2)
  expect(Math.abs(secondaryAfterSwap!.width - secondaryBeforeSwap!.width)).toBeLessThan(2)
  expect(await page.locator('.editor-area').evaluate((editor) => editor.scrollWidth <= editor.clientWidth)).toBe(true)
})

test('moves a listed file into an existing folder', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'move-me.txt', mimeType: 'text/plain', buffer: Buffer.from('Move me') })
  const sidebar = page.getByTestId('sidebar')
  page.once('dialog', async (dialog) => dialog.accept('Archive'))
  await sidebar.getByRole('button', { name: /New folder|新建文件夹/ }).click()
  const source = sidebar.locator('.tree-row', { hasText: 'move-me.txt' })
  const folder = sidebar.locator('.tree-row', { hasText: 'Archive' })
  const sourceBox = await source.boundingBox()
  const folderBox = await folder.boundingBox()
  expect(sourceBox).not.toBeNull()
  expect(folderBox).not.toBeNull()
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(folderBox!.x + folderBox!.width / 2, folderBox!.y + folderBox!.height / 2, { steps: 12 })
  await expect(folder).toHaveClass(/drop-inside/)
  await page.mouse.up()
  const folderId = await folder.getAttribute('data-node-id')
  await expect(source).toHaveAttribute('data-parent-id', folderId!)
})

test('drops documents on either editor half and closes either pane', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium')
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'left.txt', mimeType: 'text/plain', buffer: Buffer.from('Left content') },
    { name: 'right.txt', mimeType: 'text/plain', buffer: Buffer.from('Right content') }
  ])
  const sidebar = page.getByTestId('sidebar')
  await sidebar.getByText('left.txt', { exact: true }).click()

  const dragToHalf = async (name: string, side: 'left' | 'right') => {
    const source = sidebar.locator('.tree-row', { hasText: name })
    const sourceBox = await source.boundingBox()
    const editorBox = await page.locator('.editor-area').boundingBox()
    expect(sourceBox).not.toBeNull()
    expect(editorBox).not.toBeNull()
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(sourceBox!.x + sourceBox!.width + 20, sourceBox!.y + sourceBox!.height / 2, { steps: 4 })
    await page.mouse.move(editorBox!.x + editorBox!.width * (side === 'left' ? .25 : .75), editorBox!.y + editorBox!.height / 2, { steps: 12 })
    await expect(page.locator(`.editor-split-zones > div:nth-child(${side === 'left' ? 1 : 2})`)).toHaveClass(/active/)
    await page.mouse.up()
  }

  await dragToHalf('right.txt', 'right')
  await expect(page.getByTestId('editor-primary')).toContainText('left.txt')
  await expect(page.getByTestId('editor-secondary')).toContainText('right.txt')
  await expect(page.locator('.editor-split-zones')).not.toHaveClass(/visible/)

  await page.getByTestId('editor-secondary').getByRole('button', { name: /Close pane|关闭此栏/ }).click()
  await expect(page.getByTestId('editor-secondary')).toHaveCount(0)
  await expect(page.getByTestId('editor-primary')).toContainText('left.txt')

  await dragToHalf('right.txt', 'right')
  await page.getByTestId('editor-primary').getByRole('button', { name: /Close pane|关闭此栏/ }).click()
  await expect(page.getByTestId('editor-secondary')).toHaveCount(0)
  await expect(page.getByTestId('editor-primary')).toContainText('right.txt')

  await dragToHalf('left.txt', 'left')
  await expect(page.getByTestId('editor-primary')).toContainText('left.txt')
  await expect(page.getByTestId('editor-secondary')).toContainText('right.txt')
})

test('searches across documents and opens the matching result', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'ipad')
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'alpha.txt', mimeType: 'text/plain', buffer: Buffer.from('ordinary text') },
    { name: 'meeting.md', mimeType: 'text/markdown', buffer: Buffer.from('Project Aurora decision') }
  ])
  const sidebar = page.getByTestId('sidebar')
  const searchButton = sidebar.getByRole('button', { name: /Search documents|搜索文档/ })
  if (await searchButton.isVisible()) await searchButton.click()
  else {
    await sidebar.getByRole('button', { name: /More actions|更多操作/ }).click()
    await page.getByRole('menuitem', { name: /Search documents|搜索文档/ }).click()
  }
  await page.getByPlaceholder(/Search names|搜索文件名/).fill('Aurora')
  await page.getByRole('button', { name: /meeting\.md.*Aurora/i }).click()
  await expect(page.locator('.document-title')).toContainText('meeting.md')
  await expect(page.locator('.cm-content')).toContainText('Project Aurora decision')
})

test('clears global search with X and dismisses it with Escape', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'ipad')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'searchable.txt', mimeType: 'text/plain', buffer: Buffer.from('Needle') })
  const sidebar = page.getByTestId('sidebar')
  const searchButton = sidebar.getByRole('button', { name: /Search documents|搜索文档/ })
  if (await searchButton.isVisible()) await searchButton.click()
  else {
    await sidebar.getByRole('button', { name: /More actions|更多操作/ }).click()
    await page.getByRole('menuitem', { name: /Search documents|搜索文档/ }).click()
  }
  const input = page.getByPlaceholder(/Search names|搜索文件名/)
  await input.fill('Needle')
  await page.getByRole('button', { name: /Clear search|清空搜索/ }).click()
  await expect(input).toHaveValue('')
  await expect(page.locator('.search-dialog')).toBeVisible()
  await page.locator('.dialog-overlay').click({ position: { x: 4, y: 4 } })
  await expect(page.locator('.search-dialog')).toHaveCount(0)
  if (await searchButton.isVisible()) await searchButton.click()
  else {
    await sidebar.getByRole('button', { name: /More actions|更多操作/ }).click()
    await page.getByRole('menuitem', { name: /Search documents|搜索文档/ }).click()
  }
  await page.getByPlaceholder(/Search names|搜索文件名/).press('Escape')
  await expect(page.locator('.search-dialog')).toHaveCount(0)
})

test('shows document find at the top of the editor', async ({ page }) => {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'find.txt', mimeType: 'text/plain', buffer: Buffer.from('Find this text') })
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await page.getByTestId('sidebar').getByText('find.txt', { exact: true }).click()
  await page.locator('.cm-content').press('ControlOrMeta+f')
  const editor = page.locator('.code-editor')
  const panel = page.locator('.cm-panels-top .cm-search')
  await expect(panel).toBeVisible()
  const editorBox = await editor.boundingBox()
  const panelBox = await panel.boundingBox()
  expect(editorBox).not.toBeNull()
  expect(panelBox).not.toBeNull()
  expect(panelBox!.y - editorBox!.y).toBeLessThan(24)
})

test('opens global search by pulling past the top of the file list', async ({ page }) => {
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  const treeScroll = page.locator('.tree-scroll')
  const pullContent = page.locator('.tree-pull-content')
  await treeScroll.dispatchEvent('wheel', { deltaY: -100, deltaX: 0 })
  await expect(pullContent).not.toHaveCSS('transform', 'none')
  await treeScroll.dispatchEvent('wheel', { deltaY: -100, deltaX: 0 })
  await expect(page.getByPlaceholder(/Search names|搜索文件名/)).toBeVisible()
})

test('uses touch elasticity to open search on iPad', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'ipad')
  await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  const treeScroll = page.locator('.tree-scroll')
  await treeScroll.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 20, clientY: 100 }] })
  await treeScroll.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: 20, clientY: 310 }] })
  await treeScroll.dispatchEvent('touchend', { touches: [] })
  await expect(page.getByPlaceholder(/Search names|搜索文件名/)).toBeVisible()
})

test('keeps an editing timeline and restores the original text', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'ipad')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'history.txt', mimeType: 'text/plain', buffer: Buffer.from('Original text') })
  await page.getByTestId('sidebar').getByText('history.txt', { exact: true }).click()
  await page.locator('.cm-content').fill('Changed text')
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: /Editing timeline|编辑时间线/ }).click()
  const dialog = page.locator('.timeline-dialog')
  await expect(dialog.locator('.timeline-list button')).toHaveCount(2)
  await dialog.locator('.timeline-list button').nth(1).click()
  await expect(dialog.locator('.timeline-preview')).toContainText('Original text')
  await dialog.getByRole('button', { name: /Restore this version|恢复此版本/ }).click()
  await expect(page.locator('.cm-content')).toContainText('Original text')
})

test('imports and previews an image document', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'ipad')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png })
  await page.getByTestId('sidebar').getByText('pixel.png', { exact: true }).click()
  await expect(page.locator('.image-preview img')).toBeVisible()
  await expect.poll(() => page.locator('.image-preview img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  const stage = page.locator('.image-stage')
  const stageBox = await stage.boundingBox()
  expect(stageBox).not.toBeNull()
  const localAnchor = { x: stageBox!.width * .72, y: stageBox!.height * .64 }
  const pointer = { x: stageBox!.x + localAnchor.x, y: stageBox!.y + localAnchor.y }
  const imagePointAtPointer = () => page.locator('.image-stage img').evaluate((image, point) => {
    const rect = image.getBoundingClientRect()
    return { x: (point.x - rect.left) / rect.width, y: (point.y - rect.top) / rect.height }
  }, pointer)
  const beforeAnchor = await imagePointAtPointer()
  for (const expectedZoom of [110, 120, 130, 140]) {
    await stage.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100, clientX: pointer.x, clientY: pointer.y })
    await expect(page.locator('.image-toolbar')).toContainText(`${expectedZoom}%`)
    const afterAnchor = await imagePointAtPointer()
    expect(Math.abs(afterAnchor.x - beforeAnchor.x)).toBeLessThan(.015)
    expect(Math.abs(afterAnchor.y - beforeAnchor.y)).toBeLessThan(.015)
  }
})

test('decodes HEIC when native preview is unavailable and keeps video out of the text editor', async ({ page }) => {
  const heic = await readFile(new URL('./fixtures/sample.heic', import.meta.url))
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'photo.heic', mimeType: 'image/heic', buffer: heic },
    { name: 'clip.mov', mimeType: 'video/quicktime', buffer: Buffer.from([0, 0, 0, 20]) }
  ])
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  const sidebar = page.getByTestId('sidebar')
  await sidebar.getByText('photo.heic', { exact: true }).click()
  await expect(page.locator('.image-preview')).toBeVisible()
  await expect(page.locator('.image-preview img')).toHaveJSProperty('complete', true)
  await expect.poll(() => page.locator('.image-preview img').evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0)
  await expect(page.locator('.cm-content')).toHaveCount(0)

  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await sidebar.getByText('clip.mov', { exact: true }).click()
  await expect(page.locator('.video-preview, .media-preview-unavailable')).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveCount(0)
})

test('zooms an image around the midpoint of two touches', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'pinch.png', mimeType: 'image/png', buffer: png })
  await page.getByTestId('sidebar').getByText('pinch.png', { exact: true }).click()
  const stage = page.locator('.image-stage')
  const box = await stage.boundingBox()
  expect(box).not.toBeNull()
  const center = { x: box!.width * .68, y: box!.height * .62 }
  const point = (offset: number) => ({ clientX: box!.x + center.x + offset, clientY: box!.y + center.y, pointerType: 'touch' })
  const before = await stage.evaluate((element, anchor) => ({
    x: (element.scrollLeft + anchor.x) / element.scrollWidth,
    y: (element.scrollTop + anchor.y) / element.scrollHeight
  }), center)
  await stage.dispatchEvent('pointerdown', { ...point(-40), pointerId: 1 })
  await stage.dispatchEvent('pointerdown', { ...point(40), pointerId: 2 })
  for (let offset = 42; offset <= 70; offset += 2) {
    await stage.dispatchEvent('pointermove', { ...point(-offset), pointerId: 1 })
    await stage.dispatchEvent('pointermove', { ...point(offset), pointerId: 2 })
  }
  await expect(page.locator('.image-toolbar')).toContainText('100%')
  await expect(page.locator('.image-stage img')).toHaveAttribute('style', /matrix/)
  await stage.dispatchEvent('pointerup', { ...point(-70), pointerId: 1 })
  await stage.dispatchEvent('pointerup', { ...point(70), pointerId: 2 })
  await expect(page.locator('.image-toolbar')).not.toContainText('100%')
  await expect(page.locator('.image-stage img')).not.toHaveAttribute('style', /matrix/)
  const after = await stage.evaluate((element, anchor) => ({
    x: (element.scrollLeft + anchor.x) / element.scrollWidth,
    y: (element.scrollTop + anchor.y) / element.scrollHeight
  }), center)
  expect(Math.abs(after.x - before.x)).toBeLessThan(.04)
  expect(Math.abs(after.y - before.y)).toBeLessThan(.04)
})

test('uses the last pointer position for trackpad gesture zoom', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'trackpad.png', mimeType: 'image/png', buffer: png })
  await page.getByTestId('sidebar').getByText('trackpad.png', { exact: true }).click()
  const stage = page.locator('.image-stage')
  const box = await stage.boundingBox()
  expect(box).not.toBeNull()
  const pointer = { x: box!.x + box!.width * .74, y: box!.y + box!.height * .58 }
  const imagePointAtPointer = () => page.locator('.image-stage img').evaluate((image, point) => {
    const rect = image.getBoundingClientRect()
    return { x: (point.x - rect.left) / rect.width, y: (point.y - rect.top) / rect.height }
  }, pointer)
  const before = await imagePointAtPointer()
  await page.mouse.move(pointer.x, pointer.y)
  await stage.evaluate((element) => {
    element.dispatchEvent(new Event('gesturestart', { bubbles: true, cancelable: true }))
    const change = new Event('gesturechange', { bubbles: true, cancelable: true })
    Object.defineProperty(change, 'scale', { value: 1.2 })
    element.dispatchEvent(change)
    element.dispatchEvent(new Event('gestureend', { bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.image-toolbar')).toContainText('120%')
  const after = await imagePointAtPointer()
  expect(Math.abs(after.x - before.x)).toBeLessThan(.015)
  expect(Math.abs(after.y - before.y)).toBeLessThan(.015)
})

test('can pan to every side of a zoomed image', async ({ page }, testInfo) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: png })
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await page.getByTestId('sidebar').getByText('large.png', { exact: true }).click()
  const stage = page.locator('.image-stage')
  for (let index = 0; index < 4; index += 1) await page.getByRole('button', { name: /Zoom in|放大/ }).click()
  await expect(page.locator('.image-toolbar')).toContainText('200%')
  const overflow = await stage.evaluate((element) => ({
    horizontal: element.scrollWidth > element.clientWidth,
    vertical: element.scrollHeight > element.clientHeight
  }))
  expect(overflow.horizontal).toBe(true)
  expect(overflow.vertical).toBe(true)
  await expect.poll(() => stage.evaluate((element) => element.scrollLeft > 0 && element.scrollTop > 0)).toBe(true)
  const centered = await stage.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
    maxLeft: element.scrollWidth - element.clientWidth,
    maxTop: element.scrollHeight - element.clientHeight
  }))
  expect(centered.left).toBeGreaterThan(0)
  expect(centered.top).toBeGreaterThan(0)
  expect(centered.left).toBeLessThan(centered.maxLeft)
  expect(centered.top).toBeLessThan(centered.maxTop)
  const box = await stage.boundingBox()
  expect(box).not.toBeNull()
  if (testInfo.project.name === 'ipad') {
    await stage.evaluate((element) => element.scrollTo({ left: 0, top: 0 }))
  } else {
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.wheel(-320, -320)
  }
  await expect.poll(() => stage.evaluate((element, center) => element.scrollLeft < center.left && element.scrollTop < center.top, centered)).toBe(true)
  if (testInfo.project.name === 'ipad') {
    await stage.evaluate((element) => element.scrollTo({ left: element.scrollWidth, top: element.scrollHeight }))
  } else {
    await page.mouse.wheel(640, 640)
  }
  await expect.poll(() => stage.evaluate((element, center) => element.scrollLeft > center.left && element.scrollTop > center.top, centered)).toBe(true)
})

test('deletes a file with a trackpad-style left swipe', async ({ page }) => {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'swipe-away.txt', mimeType: 'text/plain', buffer: Buffer.from('Delete me') })
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  const row = page.getByTestId('sidebar').locator('.tree-row', { hasText: 'swipe-away.txt' })
  page.once('dialog', async (dialog) => dialog.accept())
  await row.dispatchEvent('wheel', { deltaX: 96, deltaY: 0 })
  await expect(row).toHaveCount(0)
})

test('deletes a focused file with Command-Backspace', async ({ page }) => {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'keyboard-delete.txt', mimeType: 'text/plain', buffer: Buffer.from('Delete me') })
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  const row = page.getByTestId('sidebar').locator('.tree-row', { hasText: 'keyboard-delete.txt' })
  await row.focus()
  page.once('dialog', async (dialog) => dialog.accept())
  await row.press('Meta+Backspace')
  await expect(row).toHaveCount(0)
})

test('keeps pinch-style zoom local to the text editor', async ({ page }) => {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'zoom.txt', mimeType: 'text/plain', buffer: Buffer.from('Zoom') })
  if ((page.viewportSize()?.width ?? 1000) < 900) await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await page.getByTestId('sidebar').getByText('zoom.txt', { exact: true }).click()
  const editor = page.locator('.code-editor')
  const before = await page.locator('.cm-scroller').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  await editor.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 })
  await expect.poll(() => page.locator('.cm-scroller').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(before)
  await expect.poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1)
})

test('uses one share action for file output on iPad', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'ipad')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'share.txt', mimeType: 'text/plain', buffer: Buffer.from('Share') })
  await page.getByRole('button', { name: /^(FILES|文件)$/i }).click()
  await page.getByTestId('sidebar').getByText('share.txt', { exact: true }).click()
  const editor = page.getByTestId('editor-primary')
  await expect(editor.getByRole('button', { name: /Share|分享/ })).toBeVisible()
  await expect(editor.getByRole('button', { name: /^Save$|^保存$/ })).toHaveCount(0)
  await expect(editor.getByRole('button', { name: /Download|下载/ })).toHaveCount(0)
})

test('downloads a document without opening a path picker', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'download.txt', mimeType: 'text/plain', buffer: Buffer.from('Download') })
  await page.getByTestId('sidebar').getByText('download.txt', { exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('editor-primary').getByRole('button', { name: /Download|下载/ }).click()
  expect((await downloadPromise).suggestedFilename()).toBe('download.txt')
})

test('uses the system share API instead of downloading', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => { (window as Window & { sharedName?: string }).sharedName = data.files?.[0]?.name } })
  })
  await page.locator('input[type=file]').first().setInputFiles({ name: 'shared.txt', mimeType: 'text/plain', buffer: Buffer.from('Shared') })
  await page.getByTestId('sidebar').getByText('shared.txt', { exact: true }).click()
  await page.getByTestId('editor-primary').getByRole('button', { name: /Share|分享/ }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { sharedName?: string }).sharedName)).toBe('shared.txt')
})

test('opens the system path picker only for save as', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium')
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async ({ suggestedName }: { suggestedName: string }) => {
      (window as Window & { savedAsName?: string }).savedAsName = suggestedName
      return { kind: 'file', name: suggestedName, requestPermission: async () => 'granted', queryPermission: async () => 'granted', createWritable: async () => ({ write: async () => { const target = window as Window & { savedWriteCount?: number }; target.savedWriteCount = (target.savedWriteCount ?? 0) + 1 }, close: async () => undefined }), getFile: async () => new File([], suggestedName) }
    } })
  })
  await page.locator('input[type=file]').first().setInputFiles({ name: 'save-as.txt', mimeType: 'text/plain', buffer: Buffer.from('Save as') })
  await page.getByTestId('sidebar').getByText('save-as.txt', { exact: true }).click()
  await page.getByTestId('editor-primary').getByRole('button', { name: /Save as|另存为/ }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { savedAsName?: string }).savedAsName)).toBe('save-as.txt')
  const save = page.getByTestId('editor-primary').getByRole('button', { name: /^Save$|^保存$/ })
  await expect(save).toBeVisible()
  await save.click()
  await expect.poll(() => page.evaluate(() => (window as Window & { savedWriteCount?: number }).savedWriteCount)).toBe(2)
})

test('reorders documents by dropping above another document', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium')
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('First') },
    { name: 'second.txt', mimeType: 'text/plain', buffer: Buffer.from('Second') },
    { name: 'third.txt', mimeType: 'text/plain', buffer: Buffer.from('Third') }
  ])
  const rows = page.getByTestId('sidebar').locator('.tree-row')
  const source = rows.filter({ hasText: 'third.txt' })
  const target = rows.filter({ hasText: 'first.txt' })
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  expect(sourceBox).not.toBeNull()
  expect(targetBox).not.toBeNull()
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + 4, { steps: 12 })
  await expect(target).toHaveClass(/drop-before/)
  await page.mouse.up()
  await expect(rows.nth(0)).toContainText('third.txt')
})
