import { isOfficialUrl } from '@siilvana/catalog';
import { reactive } from 'vue';

export const officialBrowser = reactive({ open: false, requestedUrl: '', location: '', title: '官方网站', serial: 0, expectedSha256: undefined as string | undefined });
export function openOfficialUrl(value: string, expectedSha256?: string) {
  const url = new URL(value);
  if (!isOfficialUrl(value)) throw new Error('仅支持 HTTPS 官方网站');
  if ('__TAURI_INTERNALS__' in window) {
    officialBrowser.expectedSha256 = expectedSha256;
    officialBrowser.requestedUrl = url.href; officialBrowser.location = url.href; officialBrowser.open = true; officialBrowser.serial++;
  } else window.open(url.href, '_blank', 'noopener,noreferrer');
}
