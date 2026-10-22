// 浏览器原生语音输入（zh-CN）。不引入任何第三方服务：
// 能用就用，不能用就返回 null，界面直接不显示麦克风。
//
// 注意：套壳 WebView 常常没有这个能力，所以调用方必须先看 speechSupported()。

type SpeechResultAlternative = { transcript: string };
type SpeechResult = { isFinal: boolean; 0: SpeechResultAlternative };
type SpeechResultEvent = { resultIndex: number; results: { length: number; [index: number]: SpeechResult } };
type SpeechErrorEvent = { error?: string };

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

const getConstructor = (): SpeechRecognitionConstructor | null => {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  return scope.SpeechRecognition || scope.webkitSpeechRecognition || null;
};

export const speechSupported = () => Boolean(getConstructor());

export type Dictation = { stop: () => void; abort: () => void };

export type DictationHandlers = {
  /** final=false 是临时结果，调用方应覆盖上一次临时结果 */
  onTranscript: (text: string, final: boolean) => void;
  onEnd: () => void;
  onError: (message: string) => void;
};

export function startDictation(handlers: DictationHandlers): Dictation | null {
  const Constructor = getConstructor();
  if (!Constructor) return null;
  const recognition = new Constructor();
  recognition.lang = 'zh-CN';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onresult = event => {
    let interim = '';
    let final = '';
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index];
      const text = result?.[0]?.transcript || '';
      if (result.isFinal) final += text;
      else interim += text;
    }
    if (final) handlers.onTranscript(final, true);
    else if (interim) handlers.onTranscript(interim, false);
  };
  recognition.onerror = event => {
    const reasons: Record<string, string> = {
      'not-allowed': '没有拿到麦克风权限，请在浏览器设置里允许后重试。',
      'service-not-allowed': '这个环境不允许语音识别。',
      'no-speech': '没有听到声音，再试一次。',
      network: '语音识别需要联网，当前网络不可用。',
    };
    handlers.onError(reasons[event.error || ''] || '语音识别暂时不可用，先手写也可以。');
  };
  recognition.onend = handlers.onEnd;
  try {
    recognition.start();
  } catch {
    handlers.onError('语音识别没有启动，先手写也可以。');
    return null;
  }
  return { stop: () => recognition.stop(), abort: () => recognition.abort() };
}
