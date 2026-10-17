import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '清醒｜个人记忆',
    short_name: '清醒',
    description: '把你曾经说过的东西，准确地拼回来。',
    start_url: './latest/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#111714',
    theme_color: '#111714',
    lang: 'zh-CN',
    categories: ['productivity', 'lifestyle'],
    icons: [{ src: './icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
