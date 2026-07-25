import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Languages, MonitorCog, Moon, Settings, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '../store/useWorkspace'
import type { Locale, ThemeMode } from '../types'
import { IconButton } from './IconButton'

export function SettingsMenu() {
  const { t } = useTranslation()
  const settings = useWorkspace((state) => state.settings)
  const setTheme = useWorkspace((state) => state.setTheme)
  const setLocale = useWorkspace((state) => state.setLocale)
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><IconButton icon={Settings} label={t('settings')} /></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="menu-content settings-menu" align="end">
      <DropdownMenu.Label className="menu-label">{t('theme')}</DropdownMenu.Label>
      {([['system', MonitorCog], ['light', Sun], ['dark', Moon]] as const).map(([value, Icon]) => <DropdownMenu.Item key={value} className="menu-item with-icon" onSelect={() => setTheme(value as ThemeMode)}><Icon size={18} />{t(value)}{settings.theme === value && <Check size={17} className="menu-check" />}</DropdownMenu.Item>)}
      <DropdownMenu.Separator className="menu-separator" />
      <DropdownMenu.Label className="menu-label">{t('language')}</DropdownMenu.Label>
      {([['zh-CN', '简体中文'], ['en', 'English']] as const).map(([value, label]) => <DropdownMenu.Item key={value} className="menu-item with-icon" onSelect={() => setLocale(value as Locale)}><Languages size={18} />{label}{settings.locale === value && <Check size={17} className="menu-check" />}</DropdownMenu.Item>)}
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>
}
