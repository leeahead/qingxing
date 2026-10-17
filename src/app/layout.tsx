import './globals.css';

export const metadata = {
  title: '清醒 | 个人记忆',
  description: '人们忘掉的不是事实，而是当初的清醒。',
  applicationName: '清醒',
  manifest: './manifest.webmanifest',
  appleWebApp: { capable: true, title: '清醒', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" dir="ltr"><body>{children}</body></html>;
}
