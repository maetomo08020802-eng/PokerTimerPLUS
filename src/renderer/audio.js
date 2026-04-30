// 通知音モジュール（STEP 4 仕上げ② / mp3 サンプル方式）
//
// 設計方針:
//   - 実行時は AudioBuffer + AudioBufferSourceNode のみで再生（mp3/oggサンプルベース）
//   - 第一選択: ../audio/*.mp3 を fetch（index.html からの相対パス、実体は src/audio/）
//   - 第二選択（フォールバック）: ファイル取得失敗時、OfflineAudioContext で
//     合成エンジン（FM ベル等）から AudioBuffer を1回だけレンダ → メモリにキャッシュ
//     → 以後は通常の mp3 サンプルと同じ経路で再生される
//   - リバーブ等のリアルタイム処理は廃止（mp3 には残響が録音されている前提）
//   - 公開 API（playSound 等）は完全に維持
//
// 公開 API:
//   initAudio()                    AudioContext を準備
//   ensureAudioReady()             初回ユーザー操作で resume + サンプルロード
//   setMasterVolume(v)             0〜1
//   setEnabled(soundId, bool)      個別 ON/OFF
//   setVariant(soundId, variant)   音色バリアント切替（'default' | 'variant2'）
//   getVariant(soundId)            現在のバリアント取得
//   applyAudioSettings(settings)   設定一括反映
//   playSound(soundId)             音再生（OFF時は no-op）
//   playSoundForce(soundId)        試聴用（ON/OFF を無視）
//   toggleMute()                   ミュート切替
//   isMuted()                      ミュート状態
//   getMasterVolume()              現在の音量
//
// ※ setReverbEnabled は廃止（互換のため store の reverbEnabled キーは残置するが no-op）

let audioContext = null;
let isReady = false;
let masterVolume = 0.8;
let muted = false;
let savedVolumeBeforeMute = 0.8;
let samplesLoaded = false;
let samplesLoading = null;   // ロード中の Promise（重複呼出し防止）

// AudioBuffer キャッシュ。soundId → AudioBuffer
const audioBuffers = {};

// 各サウンドの ON/OFF 状態
const enabledMap = {
  'warning-1min':    true,
  'warning-10sec':   true,
  'countdown-tick':  true,
  'level-end':       true,
  'break-end':       true,
  'start':           true   // STEP 5 用（枠だけ確保）
};

// store キー名 ↔ soundId のマッピング
const STORE_KEY_TO_SOUND_ID = {
  warning1MinEnabled:   'warning-1min',
  warning10SecEnabled:  'warning-10sec',
  countdown5SecEnabled: 'countdown-tick',
  levelEndEnabled:      'level-end',
  breakEndEnabled:      'break-end',
  startEnabled:         'start'   // STEP 5: スタート音
};

// サンプルファイル定義
//
// パスは index.html（src/renderer/index.html）からの相対 → '../audio/...' で src/audio/*.mp3 を指す。
// 値は string（単一）または辞書（バリアント切替対応）。
// 辞書の場合は variantState[soundId] で 'default' / 'variant2' 等を選択する。
const SOUND_FILES = {
  'warning-1min':   '../audio/warning-1min.mp3',
  'warning-10sec':  '../audio/warning-10sec.mp3',
  'break-end':      '../audio/break-end.mp3',
  'level-end': {
    default:  '../audio/level-end.mp3',
    variant2: '../audio/level-end2.mp3'
  },
  'countdown-tick': {
    default:  '../audio/countdown-tick.mp3',
    variant2: '../audio/countdown-tick2.mp3'
  },
  // STEP 5 用の枠（現状 404 → フォールバック合成）
  'start':          '../audio/start.mp3'
};

// バリアント選択状態（applyAudioSettings / setVariant で更新）
const variantState = {
  'level-end':      'default',
  'countdown-tick': 'default'
};

function getSoundPath(soundId) {
  const entry = SOUND_FILES[soundId];
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return null;
  const v = variantState[soundId] || 'default';
  return entry[v] || entry.default;
}

// ============================================================
// フォールバック合成レシピ（mp3 取得失敗時のみ使用）
// ============================================================
//
// type 駆動で OfflineAudioContext にレンダリングする。
// 合成パラメータは STEP 4 仕上げ① の FM 合成版から流用、
// ただしリバーブは IR を含めて事前に焼き込む（renderWetSignal）。
//
const SYNTH_DEFS = {
  'level-end': {
    type: 'fm-triple-bell',
    duration: 2.5,
    reverb: true,
    voices: [
      { freq: 523.25, modRatio: Math.SQRT2, modIndex: 3.0, gain: 0.5,  duration: 2.5 },
      { freq: 659.25, modRatio: 1.5,         modIndex: 2.5, gain: 0.4,  duration: 2.0 },
      { freq: 783.99, modRatio: 1.618,       modIndex: 2.0, gain: 0.3,  duration: 1.5 }
    ]
  },
  'warning-1min': {
    type: 'fm-bell',
    duration: 1.2,
    reverb: true,
    voice: { freq: 880, modRatio: Math.SQRT2, modIndex: 2.5, gain: 0.45, duration: 1.2 }
  },
  'warning-10sec': {
    type: 'fm-bell-bright',
    duration: 1.0,
    reverb: true,
    filter: { type: 'highpass', freq: 600 },
    voice: { freq: 1318.51, modRatio: Math.E / 2, modIndex: 4.0, gain: 0.5, duration: 1.0 }
  },
  'countdown-tick': {
    type: 'pure-tone',
    duration: 0.15,
    reverb: false,
    filter: { type: 'bandpass', freq: 1500, Q: 5 },
    voice: { freq: 1500, gain: 0.4, duration: 0.12, attack: 0.001, decay: 0.11 }
  },
  'break-end': {
    type: 'soft-rise-chord',
    duration: 1.8,
    reverb: true,
    voices: [
      { freq: 659.25,  type: 'sine', gain: 0.30 },
      { freq: 987.77,  type: 'sine', gain: 0.25 },
      { freq: 1318.51, type: 'sine', gain: 0.20 }
    ],
    envelope: { attack: 0.15, sustain: 1.0, decay: 1.5 }
  }
};

// ============================================================
// AudioContext 初期化
// ============================================================

export function initAudio() {
  if (audioContext) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      console.warn('AudioContext が利用できません');
      return;
    }
    audioContext = new Ctx();
  } catch (err) {
    console.warn('AudioContext 初期化失敗:', err);
  }
}

export async function ensureAudioReady() {
  if (!audioContext) initAudio();
  if (!audioContext) return false;
  try {
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    isReady = true;
    // 初回 resume 時にサンプルを並行ロード（再呼出しは1回しか走らない）
    if (!samplesLoaded && !samplesLoading) {
      samplesLoading = loadAllSamples().finally(() => { samplesLoading = null; });
    }
    return true;
  } catch (err) {
    console.warn('AudioContext.resume 失敗:', err);
    return false;
  }
}

// ============================================================
// 設定 setter
// ============================================================

export function setMasterVolume(v) {
  const n = Number(v);
  if (Number.isFinite(n)) masterVolume = Math.max(0, Math.min(1, n));
}

export function getMasterVolume() {
  return masterVolume;
}

export function setEnabled(soundId, enabled) {
  if (soundId in enabledMap) enabledMap[soundId] = Boolean(enabled);
}

// バリアント切替: variantState を更新し、該当サウンドの AudioBuffer を再ロード。
// 同期的に終わらないため Promise を返す（renderer 側は await しなくても次再生時に新 buffer が反映される）。
export async function setVariant(soundId, variant) {
  const entry = SOUND_FILES[soundId];
  if (!entry || typeof entry !== 'object') return;   // 単一パスはバリアント無し
  const valid = Object.keys(entry);
  const v = valid.includes(variant) ? variant : 'default';
  if (variantState[soundId] === v && audioBuffers[soundId]) return;   // 変更なし
  variantState[soundId] = v;
  // AudioContext 未初期化なら次回 ensureAudioReady で正しいパスからロードされる
  if (!audioContext) return;
  try {
    const buffer = await loadOrSynthesize(soundId);
    if (buffer) audioBuffers[soundId] = buffer;
  } catch (err) {
    console.warn(`[audio] setVariant(${soundId}, ${v}) ロード失敗:`, err);
  }
}

export function getVariant(soundId) {
  return variantState[soundId] || 'default';
}

export function applyAudioSettings(settings) {
  if (!settings || typeof settings !== 'object') return;
  if (typeof settings.masterVolume === 'number') setMasterVolume(settings.masterVolume);
  for (const [storeKey, soundId] of Object.entries(STORE_KEY_TO_SOUND_ID)) {
    if (typeof settings[storeKey] === 'boolean') enabledMap[soundId] = settings[storeKey];
  }
  // バリアント設定（renderer が apply するときは fire-and-forget で OK、
  // 次のロード機会に正しいパスが使われる）
  if (typeof settings.levelEndVariant === 'string') {
    variantState['level-end'] = settings.levelEndVariant === 'variant2' ? 'variant2' : 'default';
  }
  if (typeof settings.countdownTickVariant === 'string') {
    variantState['countdown-tick'] = settings.countdownTickVariant === 'variant2' ? 'variant2' : 'default';
  }
  // settings.reverbEnabled は互換のため受け入れるが、無視する（mp3 サンプル方式）
}

// ============================================================
// サンプルロード（第一選択: fetch、第二選択: OfflineAudioContext レンダ）
// ============================================================

async function loadAllSamples() {
  const ids = Object.keys(SOUND_FILES);
  const results = await Promise.all(ids.map((id) => loadOrSynthesize(id)));
  results.forEach((buffer, i) => { if (buffer) audioBuffers[ids[i]] = buffer; });
  samplesLoaded = true;
}

async function loadOrSynthesize(soundId) {
  // 1. mp3 ファイル取得を試行（バリアント考慮）
  // ※ TODO(STEP 8 仕上げ): 動作確認後にデバッグログを削除する
  const path = getSoundPath(soundId);
  console.log(`[audio] loading ${soundId} from ${path}`);
  try {
    if (!path) throw new Error('no path');
    const response = await fetch(path);
    if (!response.ok) {
      console.warn(`[audio] ${soundId} fetch failed (${response.status}), falling back to synthesis`);
      return await renderSynthToBuffer(soundId);
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      console.warn(`[audio] ${soundId} 0-byte response, falling back to synthesis`);
      return await renderSynthToBuffer(soundId);
    }
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    console.log(`[audio] ${soundId} loaded successfully`);
    return decoded;
  } catch (err) {
    console.warn(`[audio] ${soundId} error:`, err.message || err);
    try {
      return await renderSynthToBuffer(soundId);
    } catch (innerErr) {
      console.warn(`[audio] ${soundId} の合成レンダリングにも失敗:`, innerErr);
      return null;
    }
  }
}

async function renderSynthToBuffer(soundId) {
  const def = SYNTH_DEFS[soundId];
  if (!def) return null;
  const sampleRate = audioContext.sampleRate;
  // 残響余韻を含めて少し余分に確保
  const tailSec = def.reverb ? 1.2 : 0.1;
  const total = def.duration + tailSec;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) return null;
  const offline = new Offline(2, Math.ceil(total * sampleRate), sampleRate);

  // マスター段
  const master = offline.createGain();
  master.gain.value = 1.0;
  master.connect(offline.destination);

  // ボイス構築
  const voices = buildVoicesForDef(offline, def);

  if (def.reverb) {
    // ドライ/ウェット混合（IR を生成して適用）
    const convolver = offline.createConvolver();
    convolver.buffer = createReverbIR(offline, 1.5, 2.0);
    const dryGain = offline.createGain(); dryGain.gain.value = 0.7;
    const wetGain = offline.createGain(); wetGain.gain.value = 0.3;
    for (const v of voices) {
      v.output.connect(dryGain);
      v.output.connect(convolver);
    }
    convolver.connect(wetGain);
    dryGain.connect(master);
    wetGain.connect(master);
  } else {
    for (const v of voices) v.output.connect(master);
  }

  for (const v of voices) {
    for (const src of v.sources) {
      src.start(v.startAt);
      src.stop(v.stopAt);
    }
  }

  return await offline.startRendering();
}

// ============================================================
// 合成ヘルパ（OfflineAudioContext 用）
// ============================================================

function createReverbIR(ctx, duration = 1.5, decay = 2.0) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const ir = ctx.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return ir;
}

function createFMBell(ctx, opts) {
  const { freq, modRatio, modIndex, duration } = opts;
  const gain = opts.gain ?? 0.5;
  const attack = opts.attack ?? 0.002;
  const decay = opts.decay ?? duration * 0.95;
  const now = 0;

  const carrier = ctx.createOscillator();
  const modulator = ctx.createOscillator();
  const modGain = ctx.createGain();
  const ampGain = ctx.createGain();

  carrier.type = 'sine';
  carrier.frequency.value = freq;
  modulator.type = 'sine';
  modulator.frequency.value = freq * modRatio;

  modGain.gain.value = modIndex * freq;
  modulator.connect(modGain);
  modGain.connect(carrier.frequency);

  modGain.gain.setValueAtTime(modIndex * freq, now);
  modGain.gain.exponentialRampToValueAtTime(0.01, now + duration * 0.7);

  ampGain.gain.setValueAtTime(0.0001, now);
  ampGain.gain.exponentialRampToValueAtTime(gain, now + attack);
  ampGain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);

  carrier.connect(ampGain);

  return {
    output: ampGain,
    sources: [carrier, modulator],
    startAt: now,
    stopAt: now + duration + 0.05
  };
}

function createPureTone(ctx, opts) {
  const { freq, duration } = opts;
  const gain = opts.gain ?? 0.4;
  const attack = opts.attack ?? 0.001;
  const decay = opts.decay ?? duration * 0.92;
  const now = 0;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;

  const ampGain = ctx.createGain();
  ampGain.gain.setValueAtTime(0.0001, now);
  ampGain.gain.exponentialRampToValueAtTime(gain, now + attack);
  ampGain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);

  osc.connect(ampGain);

  return {
    output: ampGain,
    sources: [osc],
    startAt: now,
    stopAt: now + duration + 0.05
  };
}

function createSoftRiseChord(ctx, opts) {
  const { voices, duration } = opts;
  const env = opts.envelope || {};
  const attack = env.attack ?? 0.15;
  const sustain = env.sustain ?? 1.0;
  const decay = env.decay ?? duration * 0.83;
  const now = 0;

  const ampGain = ctx.createGain();
  ampGain.gain.setValueAtTime(0.0001, now);
  ampGain.gain.exponentialRampToValueAtTime(sustain, now + attack);
  ampGain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);

  const sources = [];
  for (const v of voices) {
    const osc = ctx.createOscillator();
    osc.type = v.type || 'sine';
    osc.frequency.value = v.freq;
    const voiceGain = ctx.createGain();
    voiceGain.gain.value = v.gain ?? 0.3;
    osc.connect(voiceGain);
    voiceGain.connect(ampGain);
    sources.push(osc);
  }

  return {
    output: ampGain,
    sources,
    startAt: now,
    stopAt: now + duration + 0.1
  };
}

function chainFilter(ctx, voice, filterDef) {
  if (!filterDef) return voice;
  const f = ctx.createBiquadFilter();
  f.type = filterDef.type || 'lowpass';
  f.frequency.value = filterDef.freq;
  if (typeof filterDef.Q === 'number') f.Q.value = filterDef.Q;
  voice.output.connect(f);
  voice.output = f;
  return voice;
}

function buildVoicesForDef(ctx, def) {
  const voices = [];
  switch (def.type) {
    case 'fm-bell':
      voices.push(createFMBell(ctx, def.voice));
      break;
    case 'fm-bell-bright': {
      const v = createFMBell(ctx, def.voice);
      voices.push(chainFilter(ctx, v, def.filter));
      break;
    }
    case 'fm-triple-bell':
      for (const voiceDef of def.voices) voices.push(createFMBell(ctx, voiceDef));
      break;
    case 'pure-tone': {
      const v = createPureTone(ctx, def.voice);
      voices.push(chainFilter(ctx, v, def.filter));
      break;
    }
    case 'soft-rise-chord':
      voices.push(createSoftRiseChord(ctx, {
        voices: def.voices,
        duration: def.duration,
        envelope: def.envelope
      }));
      break;
  }
  return voices;
}

// ============================================================
// 再生（BufferSource 一本化）
// ============================================================

function _play(soundId) {
  if (!audioContext || !isReady) return;
  const effectiveVolume = muted ? 0 : masterVolume;
  if (effectiveVolume <= 0) return;

  const buffer = audioBuffers[soundId];
  if (!buffer) {
    // ロード未完 / 失敗は静かに無視（試聴 UI 側でヒント表示も検討）
    return;
  }

  // STEP 10 フェーズC.1.7: AudioContext suspend 防御。
  //   長時間 PAUSED（5 分以上）/ 別ウィンドウフォーカス / PC スリープ等で
  //   AudioContext が suspended 状態に遷移する可能性。その状態で source.start() を呼んでも
  //   音は再生されない。playSound の都度 state を確認し、suspended なら resume を試みる
  //   （fire-and-forget で待たない、軽量）。
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => { /* resume 失敗時は static に音なし、致命ではない */ });
  }

  try {
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    const gain = audioContext.createGain();
    gain.gain.value = effectiveVolume;
    source.connect(gain);
    gain.connect(audioContext.destination);
    source.start();
  } catch (err) {
    console.warn(`playSound(${soundId}) 失敗:`, err);
  }
}

// ============================================================
// 公開再生 API
// ============================================================

export function playSound(soundId) {
  if (!enabledMap[soundId]) return;
  _play(soundId);
}

export function playSoundForce(soundId) {
  _play(soundId);
}

export function toggleMute() {
  if (muted) {
    muted = false;
    masterVolume = savedVolumeBeforeMute;
  } else {
    savedVolumeBeforeMute = masterVolume;
    muted = true;
  }
  return muted;
}

export function isMuted() {
  return muted;
}
