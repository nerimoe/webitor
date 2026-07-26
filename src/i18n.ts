import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

export const resources = {
  en: { translation: {
    files: 'FILES', workspace: 'Documents', newFile: 'New file', newFolder: 'New folder', collapseSidebar: 'Hide file list', showSidebar: 'Show file list',
    importFiles: 'Import files', importFolder: 'Import folder', exportWorkspace: 'Export workspace',
    rename: 'Rename', delete: 'Delete', open: 'Open', openOther: 'Open in other group', openRight: 'Open “{{name}}” on the right', replaceRight: 'Replace right pane with “{{name}}”', closePane: 'Close pane',
    moveOther: 'Open in split view', close: 'Close', save: 'Save', download: 'Download', saveAs: 'Save as', share: 'Share', shareWorkspace: 'Share documents',
    undo: 'Undo', redo: 'Redo', search: 'Find and replace', preview: 'Markdown preview',
    editor: 'Editor', primary: 'Group 1', secondary: 'Group 2', settings: 'Settings', moreActions: 'More actions', zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit image', timeline: 'Editing timeline', openLeft: 'Open on left', openRightDrop: 'Open on right',
    globalSearch: 'Search documents', searchDocuments: 'Search names and document content', clearSearch: 'Clear search', noResults: 'No matching documents', searchHint: 'Use arrow keys to move and Enter to open',
    timelineDescription: 'Local snapshots created as your document is saved.', timelineEmpty: 'No saved versions yet', versionNumber: 'Version {{version}}', restore: 'Restore this version',
    theme: 'Theme', system: 'System', light: 'Light', dark: 'Dark', language: 'Language',
    emptyTitle: 'Start with a document', emptyBody: 'Create a plain text note or open existing files. Everything stays on this device.',
    dropTree: 'Add to workspace', dropEditor: 'Add and open', dropOpenSingle: 'Import and open here', unsupported: 'This looks like a binary file and was not imported.',
    cached: 'Cached', saving: 'Saving…', synced: 'Saved to device', 'local-only': 'Cached locally', error: 'Save failed',
    cacheUnavailable: 'Browser storage is unavailable. Export your work before closing this page.',
    quotaExceeded: 'Browser storage is full. Export your workspace to keep a copy.',
    saveFailed: 'The file could not be saved. Your cached copy is still available.', retry: 'Retry', dismiss: 'Dismiss',
    confirmDelete: 'Delete “{{name}}” and its contents?', fileName: 'File name', folderName: 'Folder name',
    collisionTitle: 'A file already exists', collisionBody: '“{{name}}” already exists in this folder.', overwrite: 'Replace', keepBoth: 'Keep both', skip: 'Skip', applyAll: 'Use for all conflicts',
    install: 'Install app', offline: 'Offline ready', noFile: 'Select a file to start editing', noFileTitle: 'No document open', noFileBody: 'Choose a document from the list, or start a new one here.', closeFile: 'Close document', renameFile: 'Rename document', increaseTextSize: 'Increase text size', decreaseTextSize: 'Decrease text size', resetTextSize: 'Reset text size (current: {{size}} px)',
    touchHint: 'Long-press files for more actions', copied: 'Copied', importFailed: 'Some files could not be imported.'
  } },
  'zh-CN': { translation: {
    files: '文件', workspace: '文档', newFile: '新建文件', newFolder: '新建文件夹', collapseSidebar: '隐藏文件列表', showSidebar: '显示文件列表',
    importFiles: '导入文件', importFolder: '导入文件夹', exportWorkspace: '导出工作区',
    rename: '重命名', delete: '删除', open: '打开', openOther: '在另一编辑组打开', openRight: '在右侧打开“{{name}}”', replaceRight: '将右侧替换为“{{name}}”', closePane: '关闭此栏',
    moveOther: '在分屏中打开', close: '关闭', save: '保存', download: '下载', saveAs: '另存为', share: '分享', shareWorkspace: '分享文档',
    undo: '撤销', redo: '重做', search: '查找和替换', preview: 'Markdown 预览',
    editor: '编辑器', primary: '编辑组 1', secondary: '编辑组 2', settings: '设置', moreActions: '更多操作', zoomIn: '放大', zoomOut: '缩小', fit: '适应窗口', timeline: '编辑时间线', openLeft: '在左侧打开', openRightDrop: '在右侧打开',
    globalSearch: '搜索文档', searchDocuments: '搜索文件名和文档内容', clearSearch: '清空搜索', noResults: '没有匹配的文档', searchHint: '使用方向键移动，按 Enter 打开',
    timelineDescription: '文档保存时自动生成的本地快照。', timelineEmpty: '还没有已保存的版本', versionNumber: '版本 {{version}}', restore: '恢复此版本',
    theme: '主题', system: '跟随系统', light: '浅色', dark: '深色', language: '语言',
    emptyTitle: '从一份文档开始', emptyBody: '新建纯文本文档或打开已有文件，所有内容都只保留在此设备上。',
    dropTree: '添加到工作区', dropEditor: '添加并打开', dropOpenSingle: '导入并在此单栏打开', unsupported: '文件可能是二进制格式，未导入。',
    cached: '已缓存', saving: '正在保存…', synced: '已保存到设备', 'local-only': '仅本地缓存', error: '保存失败',
    cacheUnavailable: '浏览器存储不可用，请在关闭页面前导出工作区。',
    quotaExceeded: '浏览器存储空间已满，请导出工作区以保留副本。',
    saveFailed: '无法保存此文件，缓存副本仍然可用。', retry: '重试', dismiss: '关闭',
    confirmDelete: '删除“{{name}}”及其中全部内容？', fileName: '文件名', folderName: '文件夹名',
    collisionTitle: '文件已存在', collisionBody: '此文件夹中已经存在“{{name}}”。', overwrite: '覆盖', keepBoth: '保留两份', skip: '跳过', applyAll: '应用到本批次全部冲突',
    install: '安装应用', offline: '已可离线使用', noFile: '选择一个文件开始编辑', noFileTitle: '没有打开的文档', noFileBody: '从左侧选择一份文档，或直接在这里开始新建。', closeFile: '关闭文档', renameFile: '重命名文档', increaseTextSize: '增大文字', decreaseTextSize: '减小文字', resetTextSize: '重置字号（当前 {{size}} px）',
    touchHint: '长按文件可查看更多操作', copied: '已复制', importFailed: '部分文件无法导入。'
  } }
} as const

void i18n.use(initReactI18next).init({
  resources,
  lng: navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18n
