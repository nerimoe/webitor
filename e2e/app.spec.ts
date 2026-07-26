import { expect, test } from '@playwright/test'

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

  await page.setViewportSize({ width: 1000, height: 720 })
  await expect(actions.getByRole('button', { name: /Editing timeline|编辑时间线/ })).toBeVisible()
  await expect(actions.getByRole('button', { name: /Increase text size|增大文字/ })).toBeVisible()
  await expect(actions.getByRole('button', { name: /Decrease text size|减小文字/ })).toBeVisible()
  const fontSize = actions.getByRole('button', { name: /Reset text size.*16 px|重置字号.*16 px/ })
  await expect(fontSize).toHaveText('16')
  await actions.getByRole('button', { name: /Increase text size|增大文字/ }).click()
  await expect(actions.getByRole('button', { name: /Reset text size.*17 px|重置字号.*17 px/ })).toHaveText('17')
  await actions.getByRole('button', { name: /Reset text size.*17 px|重置字号.*17 px/ }).click()
  await expect(actions.getByRole('button', { name: /Reset text size.*16 px|重置字号.*16 px/ })).toHaveText('16')
  if (testInfo.project.name !== 'ipad') await expect(actions.getByRole('button', { name: /Save as|另存为/ })).toBeVisible()
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
  for (const name of [/Hide file list|隐藏文件列表/, /New file|新建文件/, /New folder|新建文件夹/, /Search documents|搜索文档/, /Settings|设置/, /Import files|导入文件/, /Import folder|导入文件夹/, /Export workspace|导出工作区/, /Share documents|分享文档/]) {
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

test('shows Markdown preview without a duplicate editor toolbar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'ipad')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'README.md', mimeType: 'text/markdown', buffer: Buffer.from('# Preview') })
  await page.getByTestId('sidebar').getByText('README.md', { exact: true }).click()
  await page.getByRole('button', { name: /Markdown preview|Markdown 预览/ }).click()
  await expect(page.getByTestId('markdown-preview')).toBeVisible()
  await expect(page.locator('.document-bar')).toHaveCount(1)
})

test('closes Markdown preview when switching documents', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'ipad')
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'note.md', mimeType: 'text/markdown', buffer: Buffer.from('# Note') },
    { name: 'plain.txt', mimeType: 'text/plain', buffer: Buffer.from('Plain') }
  ])
  const sidebar = page.getByTestId('sidebar')
  await sidebar.getByText('note.md', { exact: true }).click()
  await page.getByRole('button', { name: /Markdown preview|Markdown 预览/ }).click()
  await expect(page.getByTestId('markdown-preview')).toBeVisible()
  await sidebar.getByText('plain.txt', { exact: true }).click()
  await expect(page.getByTestId('markdown-preview')).toHaveCount(0)
  await expect(page.locator('.document-title')).toContainText('plain.txt')
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
  await stage.dispatchEvent('pointermove', { ...point(-65), pointerId: 1 })
  await stage.dispatchEvent('pointermove', { ...point(65), pointerId: 2 })
  await stage.dispatchEvent('pointerup', { ...point(-65), pointerId: 1 })
  await stage.dispatchEvent('pointerup', { ...point(65), pointerId: 2 })
  await expect(page.locator('.image-toolbar')).not.toContainText('100%')
  const after = await stage.evaluate((element, anchor) => ({
    x: (element.scrollLeft + anchor.x) / element.scrollWidth,
    y: (element.scrollTop + anchor.y) / element.scrollHeight
  }), center)
  expect(Math.abs(after.x - before.x)).toBeLessThan(.04)
  expect(Math.abs(after.y - before.y)).toBeLessThan(.04)
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
