// 手机端软键盘与底部导航的状态判断。
//
// 背景：软键盘收起之后，输入框常常还留着焦点。底部导航的 CSS 兜底
// （.app-shell:has(.composer textarea:focus) .mobile-nav{display:none}）只看焦点，
// 不看键盘状态，于是导航被一直藏住，用户必须点一下屏幕让输入框失焦才看得到。
//
// 这里只补一件事：判断「软键盘是否真的还占着屏幕底部」。
//   压缩：窗口被键盘顶小（Android adjustResize），可见高度变矮；
//   平移：窗口没变矮，只是被顶上去（adjustPan），可见区域发生偏移或页面被滚动；
// 两种都算「键盘在挡路」。确认键盘确实收起时主动让输入框失焦，
// CSS 兜底随之失效，底部导航自动回来。
//
// 全部在客户端完成，不引入任何只能在服务端运行的依赖。

export type KeyboardCoverSource = 'none' | 'resize' | 'pan';

export type KeyboardState = {
  /** 软键盘是否还占着屏幕底部 */
  up: boolean;
  /** 判定依据 */
  source: KeyboardCoverSource;
  /** 当前是否有输入框获得焦点 */
  focused: boolean;
  /** 诊断用：当前可见高度 */
  height: number;
  /** 诊断用：没有键盘时的基线高度 */
  baseline: number;
  /** 诊断用：视口偏移 */
  offsetTop: number;
  /** 诊断用：页面滚动位置 */
  scrollY: number;
};

export type KeyboardDiag = { at: number; label: string; detail: string };

export type WatchKeyboardOptions = {
  /** 每次判定之后回调 */
  onState: (state: KeyboardState) => void;
  /** 确认软键盘已经收起时回调：此时需要让输入框失焦，底部导航才会回来 */
  onDismissed: () => void;
  /** 诊断事件，用于真机排查 */
  onDiag?: (entry: KeyboardDiag) => void;
};

/** 可见高度比基线矮过这个数，算窗口被键盘顶小 */
const COMPRESS_DELTA = 120;
/** 视口偏移或页面滚动超过这个数，算窗口被顶上去 */
const PAN_DELTA = 24;
/** 连续几次判定为「键盘不在」才确认收起，避免键盘动画过程中的抖动 */
const CONFIRM_TICKS = 2;
/** 有焦点时的轮询间隔：事件被浏览器或套壳吞掉时靠它兜住 */
const POLL_MS = 200;
/** 最近一次输入距今超过这个毫秒数，才允许在确认键盘收起时让输入框失焦 */
const IDLE_BEFORE_BLUR = 600;

export function isInputField(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

export function watchKeyboard({ onState, onDismissed, onDiag }: WatchKeyboardOptions): () => void {
  const viewport = window.visualViewport;
  let baseline = Math.max(window.innerHeight, viewport?.height || 0);
  let baseOffset = viewport?.offsetTop || 0;
  let baseScroll = window.scrollY || 0;
  let focused = false;
  let up = false;
  let source: KeyboardCoverSource = 'none';
  /** 见过「窗口被顶小」就以它为准，不再依赖平移信号 */
  let sawResizeCover = false;
  /** 本次聚焦期间是否真的见过键盘挡住底部 */
  let seenCover = false;
  let downTicks = 0;
  let lastInputAt = 0;
  let timer: number | null = null;

  const diag = (label: string, detail: string) => onDiag?.({ at: Date.now(), label, detail });

  const measure = () => ({
    height: Math.min(window.innerHeight, viewport?.height || window.innerHeight),
    offsetTop: viewport?.offsetTop || 0,
    scrollY: window.scrollY || 0,
  });

  const publish = () => {
    const { height, offsetTop, scrollY } = measure();
    onState({ up, source, focused, height, baseline, offsetTop, scrollY });
  };

  const stopTimer = () => {
    if (timer !== null) { window.clearInterval(timer); timer = null; }
  };

  const startTimer = () => {
    if (timer === null) timer = window.setInterval(() => evaluate('轮询'), POLL_MS);
  };

  const evaluate = (trigger: string) => {
    const { height, offsetTop, scrollY } = measure();
    // 没有输入框获得焦点时，视口大小与键盘无关：转屏、窗口缩放都不该被当成键盘。
    if (!focused) {
      up = false;
      source = 'none';
      seenCover = false;
      downTicks = 0;
      baseline = height;
      baseOffset = offsetTop;
      baseScroll = scrollY;
      publish();
      return;
    }
    const compressed = height < baseline - COMPRESS_DELTA;
    const panned = Math.abs(offsetTop - baseOffset) > PAN_DELTA || Math.abs(scrollY - baseScroll) > PAN_DELTA;
    if (compressed) sawResizeCover = true;
    const covered = compressed || (!sawResizeCover && panned);
    const nextSource: KeyboardCoverSource = compressed ? 'resize' : (covered ? 'pan' : 'none');

    if (covered) {
      downTicks = 0;
      if (!seenCover) {
        seenCover = true;
        diag('键盘挡住底部', `${nextSource} 高度 ${Math.round(height)} / 基线 ${Math.round(baseline)}`);
      }
      if (!up) { up = true; source = nextSource; }
    } else if (up && seenCover) {
      downTicks += 1;
      if (downTicks >= CONFIRM_TICKS) {
        up = false;
        source = 'none';
        downTicks = 0;
        baseline = height;
        baseOffset = offsetTop;
        baseScroll = scrollY;
        const idle = Date.now() - lastInputAt > IDLE_BEFORE_BLUR;
        diag('键盘收起', `${trigger} 高度 ${Math.round(height)} / 基线 ${Math.round(baseline)}${idle ? '' : '（刚刚还在输入，暂不失焦）'}`);
        if (idle) onDismissed();
      }
    }
    publish();
  };

  const onFocus = (event: FocusEvent) => {
    if (!isInputField(event.target)) return;
    focused = true;
    // 先乐观认为键盘已弹起，底部导航立刻收起；随后由几何信号确认。
    up = true;
    source = 'none';
    seenCover = false;
    downTicks = 0;
    startTimer();
    diag('输入框聚焦', '');
    evaluate('聚焦');
  };

  const onBlur = () => {
    window.setTimeout(() => {
      if (isInputField(document.activeElement)) return;
      focused = false;
      up = false;
      source = 'none';
      seenCover = false;
      downTicks = 0;
      stopTimer();
      const { height, offsetTop, scrollY } = measure();
      baseline = height;
      baseOffset = offsetTop;
      baseScroll = scrollY;
      diag('输入框失焦', `高度 ${Math.round(height)}`);
      publish();
    }, 250);
  };

  // 点到输入框以外的地方就失焦：这是键盘收起后最可靠的兜底。
  const onPointerDown = (event: PointerEvent) => {
    if (!isInputField(event.target) && isInputField(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
  };

  const onInput = () => { lastInputAt = Date.now(); };
  const onViewportChange = () => evaluate('视口变化');
  const onOrientation = () => window.setTimeout(() => {
    const { height, offsetTop, scrollY } = measure();
    baseline = height;
    baseOffset = offsetTop;
    baseScroll = scrollY;
    up = false;
    source = 'none';
    seenCover = false;
    downTicks = 0;
    diag('屏幕方向变化', `高度 ${Math.round(height)}`);
    publish();
  }, 400);

  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', onBlur);
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('input', onInput, true);
  document.addEventListener('compositionstart', onInput, true);
  viewport?.addEventListener('resize', onViewportChange);
  viewport?.addEventListener('scroll', onViewportChange);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, { passive: true });
  window.addEventListener('orientationchange', onOrientation);
  publish();

  return () => {
    stopTimer();
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('focusout', onBlur);
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('compositionstart', onInput, true);
    viewport?.removeEventListener('resize', onViewportChange);
    viewport?.removeEventListener('scroll', onViewportChange);
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('scroll', onViewportChange);
    window.removeEventListener('orientationchange', onOrientation);
  };
}
