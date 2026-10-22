'use client';

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Entry } from '@/lib/types';
import { speechSupported, startDictation } from '@/lib/speech';
import type { Dictation } from '@/lib/speech';
import { Icon } from '@/components/Icon';

export type QuickCaptureProps = {
  draft: string;
  editing: Entry | null;
  ready: boolean;
  todayCount: number;
  setDraft: (value: string) => void;
  setEditing: (value: Entry | null) => void;
  saveEntry: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  setTyping: (value: boolean) => void;
};

/**
 * 快速记录框。洞察流首页顶部固定这一件事：想到就记，不用切页。
 * 语音直接用浏览器自带能力，不经过第三方服务；设备不支持就不显示。
 */
export function QuickCapture(props: QuickCaptureProps) {
  const { draft, editing, ready, todayCount, setDraft, setEditing, saveEntry, composerRef, setTyping } = props;
  const [voiceReady, setVoiceReady] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const dictationRef = useRef<Dictation | null>(null);
  const voiceBaseRef = useRef('');
  const voiceInterimRef = useRef('');
  const discardVoiceRef = useRef(false);

  useEffect(() => setVoiceReady(speechSupported()), []);
  useEffect(() => () => { discardVoiceRef.current = true; dictationRef.current?.abort(); }, []);

  function toggleDictation() {
    if (listening) { dictationRef.current?.stop(); return; }
    setVoiceError('');
    voiceBaseRef.current = draft.trim() ? `${draft.trimEnd()} ` : '';
    voiceInterimRef.current = '';
    discardVoiceRef.current = false;
    const session = startDictation({
      onTranscript: (text, final) => {
        if (final) {
          voiceBaseRef.current += text;
          voiceInterimRef.current = '';
          setDraft(voiceBaseRef.current);
        } else {
          voiceInterimRef.current = text;
          setDraft(`${voiceBaseRef.current}${text}`);
        }
      },
      onEnd: () => {
        // 手动停止时保留最后一段还没定稿的话；直接按保存时就不要把它写回输入框。
        if (!discardVoiceRef.current && voiceInterimRef.current) setDraft(`${voiceBaseRef.current}${voiceInterimRef.current}`);
        discardVoiceRef.current = false;
        voiceInterimRef.current = '';
        dictationRef.current = null;
        setListening(false);
      },
      onError: message => { setVoiceError(message); dictationRef.current = null; setListening(false); },
    });
    if (session) { dictationRef.current = session; setListening(true); }
    else setVoiceError('这个浏览器不支持语音输入，先手写也可以。');
  }

  function submitEntry() {
    if (!draft.trim() || !ready) return;
    if (listening) {
      discardVoiceRef.current = true;
      dictationRef.current?.stop();
      setListening(false);
    }
    saveEntry();
  }

  return <form className="composer quick-capture card" onSubmit={event => { event.preventDefault(); submitEntry(); }}>
    <textarea id="composer" ref={composerRef} rows={2} placeholder={editing ? '正在改一条记录……' : '想到什么，直接写下来……'} aria-label="记下来" value={draft} onChange={event => setDraft(event.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); submitEntry(); } }}/>
    <footer>
      <span className="muted">{listening ? '正在听写 · 说到这里就好' : editing ? '正在修改一条记录' : todayCount ? `今天已记 ${todayCount} 条` : '只存在这台设备上'}</span>
      <div className="button-row">
        {voiceReady && <button type="button" className={`mic-button${listening ? ' listening' : ''}`} aria-label={listening ? '停止语音输入' : '用语音记录'} aria-pressed={listening} onClick={toggleDictation}><Icon name={listening ? 'stop' : 'mic'} size={17}/><span>{listening ? '停止' : '语音'}</span></button>}
        {editing && <button type="button" className="quiet-button" onClick={() => { setEditing(null); setDraft(''); }}>取消修改</button>}
        <button className="primary-button" type="submit" disabled={!draft.trim() || !ready}>{editing ? '保存修改' : '记下来'}</button>
      </div>
    </footer>
    {listening && <p className="voice-hint">说完点“停止”，或者直接点“记下来”。识别结果只写入这台设备。</p>}
    {voiceError && <p className="voice-hint error">{voiceError}</p>}
  </form>;
}
