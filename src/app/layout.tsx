import './globals.css';

export const metadata = {
  title: '清醒 | 个人记忆',
  description: '人们忘掉的不是事实，而是当初的清醒。',
  applicationName: '清醒',
  manifest: './manifest.webmanifest?v=64be1cd',
  appleWebApp: { capable: true, title: '清醒', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};

/**
 * 主题要在第一帧之前就定下来。
 * 数据是异步从 IndexedDB 读的，等应用自己 setState 再换主题，
 * 用白色主题的人会先看到一屏深色——手机上一闪尤其明显。
 */
const themeBootstrap = `try{var t=localStorage.getItem('qingxing.theme.v1');document.documentElement.dataset.theme=(t==='light'||t==='mono')?'light':'dark';}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 不在 html 标签上写死 data-theme：那样会先被解析成深色，几毫秒后才被下面的脚本改回来。
  // 缺省就是 CSS 里的深色变量，白色主题由脚本在首帧之前加上属性，颜色只会被设一次。
  return <html lang="zh-CN" dir="ltr"><head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head><body>{children}</body></html>;
}
