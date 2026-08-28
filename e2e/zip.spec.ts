import { expect, test } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => indexedDB.deleteDatabase('local-ide'))
  await page.reload()
})

test('imports zip archive, explores files, previews, and extracts to workspace', async ({ page }) => {
  // Create a mock zip archive
  const zipBuffer = zipSync({
    'hello.txt': strToU8('Hello from inside the ZIP file!'),
    'docs/guide.md': strToU8('# User Guide\n\nThis is a markdown document inside the ZIP archive.'),
    'src/main.ts': strToU8('export const greet = () => "Hello Webitor";'),
    'assets/sample.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])
  })

  // 1. Import zip archive into Webitor
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'sample-project.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zipBuffer)
  })

  // Check that the zip file appears in the sidebar file tree
  const sidebar = page.getByTestId('sidebar')
  await expect(sidebar.getByText('sample-project.zip')).toBeVisible()

  // Click the zip file to open it in the editor
  await sidebar.getByText('sample-project.zip').click()

  // Check that the Zip document view is rendered
  const zipView = page.getByTestId('zip-document-view')
  await expect(zipView).toBeVisible()

  // Check entries are listed
  await expect(zipView.getByText('hello.txt')).toBeVisible()
  await expect(zipView.getByText('docs')).toBeVisible()
  await expect(zipView.getByText('src')).toBeVisible()

  // Take a screenshot of the initial zip view
  await page.screenshot({ path: 'test-results/zip-document-view.png', fullPage: true })

  // 2. Preview text file
  await zipView.getByText('hello.txt').click()
  await expect(zipView.getByText('Hello from inside the ZIP file!')).toBeVisible()

  // 3. Preview markdown file
  await zipView.getByText('guide.md').click()
  await expect(zipView.getByText('User Guide')).toBeVisible()
  await expect(zipView.getByText('This is a markdown document inside the ZIP archive.')).toBeVisible()

  // Take a screenshot of markdown preview
  await page.screenshot({ path: 'test-results/zip-markdown-preview.png', fullPage: true })

  // 4. Test search filter inside archive
  const searchInput = zipView.getByPlaceholder(/Filter files in archive…|筛选压缩包内的文件…/)
  await searchInput.fill('main.ts')
  await expect(zipView.getByText('main.ts')).toBeVisible()
  await expect(zipView.getByText('hello.txt')).not.toBeVisible()
  await searchInput.fill('')

  // 5. Test extracting a file to workspace (into a folder named after the zip archive)
  await zipView.getByText('hello.txt').click()
  const extractBtn = zipView.locator('.zip-preview-actions').getByRole('button', { name: /Extract to workspace|解压到工作区/ })
  await extractBtn.click()

  // Verify that the folder named after the zip archive and hello.txt are in the workspace sidebar
  await expect(sidebar.getByText('sample-project', { exact: true })).toBeVisible()
  await expect(sidebar.getByText('hello.txt', { exact: true })).toBeVisible()

  // 6. Test importing arbitrary binary file without restriction
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'device-firmware.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([0, 1, 2, 3, 4, 5])
  })

  await expect(sidebar.getByText('device-firmware.bin')).toBeVisible()
  await sidebar.getByText('device-firmware.bin').click()

  // Binary file should display unsupported viewer message
  await expect(page.getByText(/No viewer is available for this file type|暂不支持查看这种文件/)).toBeVisible()

  // Take a screenshot of binary file unsupported view
  await page.screenshot({ path: 'test-results/unsupported-binary-view.png', fullPage: true })
})

test('renders ZipDocumentView in Chinese locale with code preview and batch selection', async ({ page }) => {
  // Set Chinese locale in localStorage/settings
  await page.evaluate(() => {
    localStorage.setItem('webitor-locale', 'zh-CN')
  })

  const zipBuffer = zipSync({
    'src/main.ts': strToU8('export function calculateSum(a: number, b: number): number {\n  return a + b;\n}'),
    'package.json': strToU8('{\n  "name": "demo-app",\n  "version": "1.0.0"\n}'),
    'README.md': strToU8('# 项目说明\n\n这是一个测试项目压缩包。')
  })

  await page.locator('input[type=file]').first().setInputFiles({
    name: 'demo-app.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zipBuffer)
  })

  const sidebar = page.getByTestId('sidebar')
  await sidebar.getByText('demo-app.zip').click()

  const zipView = page.getByTestId('zip-document-view')
  await expect(zipView).toBeVisible()

  // Click main.ts to see code preview
  await zipView.locator('.zip-entry-row').getByText('main.ts').click()
  await expect(zipView.getByText('export function calculateSum')).toBeVisible()

  // Select all checkbox
  await zipView.getByRole('button', { name: /Select all|全选/ }).click()
  await expect(zipView.getByText(/Extract \(\d+\)|解压选中 \(\d+\)/)).toBeVisible()

  // Take screenshot of Chinese code preview with batch buttons
  await page.screenshot({ path: 'test-results/zip-code-preview-zh.png', fullPage: true })
})
