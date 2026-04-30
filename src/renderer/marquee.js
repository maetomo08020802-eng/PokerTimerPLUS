// マーキー（テロップ）モジュール
// - 設定の読み書きは window.api.settings 経由（preload + IPC）
// - 改行は半角スペース3つで連結して1行表示
// - 速度は slow=30s / normal=20s / fast=12s

const SPEED_DURATION = Object.freeze({
  slow: '30s',
  normal: '20s',
  fast: '12s'
});

const dom = {
  marquee: null,
  content: null,
  dialog: null,
  enabledInput: null,
  textInput: null,
  speedRadios: null,
  previewBtn: null,
  closeBtn: null
};

// 現在の設定（メモリキャッシュ）
let currentSettings = { enabled: true, text: '', speed: 'normal' };

export function initMarquee(elements) {
  Object.assign(dom, elements);
}

// メイン画面のマーキーに設定を反映
export function applyMarquee(settings) {
  if (!dom.marquee || !dom.content) {
    console.warn('marquee 要素が初期化されていません');
    return;
  }
  currentSettings = { ...settings };
  const cleaned = cleanText(settings.text);
  const shouldShow = settings.enabled && cleaned.length > 0;

  if (!shouldShow) {
    // 表示制御は body.has-marquee クラス一本（hidden 属性は使わない）
    document.body.classList.remove('has-marquee');
    return;
  }

  // 表示前に duration を反映（アニメーション開始前に値が確定しているように）
  const duration = SPEED_DURATION[settings.speed] || SPEED_DURATION.normal;
  dom.marquee.style.setProperty('--marquee-duration', duration);

  // テキスト更新
  dom.content.textContent = cleaned;

  // 表示状態へ（CSS は body:not(.has-marquee) .marquee { display: none } で制御）
  document.body.classList.add('has-marquee');

  // アニメーション再起動: animation-name を一旦解除 → reflow → 再付与
  // これで display:none → 表示 への切替時もアニメーションが頭から流れる
  dom.content.style.animationName = 'none';
  // 強制リフロー（offsetHeight 取得で再計算）
  void dom.content.offsetHeight;
  dom.content.style.animationName = 'marquee-scroll';
}

// 改行を半角スペース3つで連結し、空行は除去
function cleanText(text) {
  if (typeof text !== 'string') return '';
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('   ');
}

// ダイアログを開いて現在値をフォームにロード
export function openMarqueeDialog() {
  if (!dom.dialog) return;
  dom.enabledInput.checked = Boolean(currentSettings.enabled);
  dom.textInput.value = currentSettings.text || '';
  for (const radio of dom.speedRadios) {
    radio.checked = radio.value === currentSettings.speed;
  }
  if (typeof dom.dialog.showModal === 'function') {
    dom.dialog.showModal();
    dom.textInput.focus();
  }
}

export function closeMarqueeDialog() {
  if (dom.dialog?.open) {
    dom.dialog.close();
  }
}

// フォームから値を吸い上げる
export function readMarqueeForm() {
  let speed = 'normal';
  for (const radio of dom.speedRadios) {
    if (radio.checked) {
      speed = radio.value;
      break;
    }
  }
  return {
    enabled: dom.enabledInput.checked,
    text: dom.textInput.value,
    speed
  };
}
