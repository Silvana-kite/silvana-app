import { reactive } from 'vue';

export const officialBrowser = reactive({ open: false, requestedUrl: '', location: '', title: '官方网站', serial: 0 });
export function openOfficialUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('仅支持 HTTPS 官方网站');
  if ('__TAURI_INTERNALS__' in window) {
    officialBrowser.requestedUrl = url.href; officialBrowser.location = url.href; officialBrowser.open = true; officialBrowser.serial++;
  } else window.open(url.href, '_blank', 'noopener,noreferrer');
}
