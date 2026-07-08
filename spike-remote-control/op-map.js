'use strict';
// remote-control Phase 0 スパイク — 操作名 → dispatchClockShortcut が受け付ける eventLike 写像。
//
// 対応元: src/renderer/renderer.js:7577 の switch(event.code) と :7592-7684 の修飾キー分岐。
// この写像1本を「真実源」とし、Phase 1 本実装でもそのまま流用する想定（server / phone / harness で共有）。
// dispatchClockShortcut は主に event.code を見る（event.key はほぼ不参照）ため key は空でよい。

const OPS = Object.freeze({
  // タイマー系
  startPause:      { code: 'Space' },                          // 開始/一時停止トグル
  plus30:          { code: 'ArrowRight' },                     // +30秒（早送り）
  minus30:         { code: 'ArrowLeft' },                      // -30秒（巻き戻し）
  // 人数・エントリー系（runtime）
  entryAdd:        { code: 'ArrowUp' },                        // 新規エントリー追加
  entryCancel:     { code: 'ArrowUp', shift: true },           // 直前エントリー取消
  eliminate:       { code: 'ArrowDown' },                      // 脱落
  revive:          { code: 'ArrowDown', shift: true },         // 脱落取消（復活）
  reentryPlus:     { code: 'KeyR', control: true },            // リエントリー +1
  reentryMinus:    { code: 'KeyR', control: true, shift: true },// リエントリー -1
  addOnPlus:       { code: 'KeyA', control: true },            // アドオン +1
  addOnMinus:      { code: 'KeyA', control: true, shift: true },// アドオン -1
  specialPlus:     { code: 'KeyE', control: true },            // 特殊スタック +1
  specialMinus:    { code: 'KeyE', control: true, shift: true },// 特殊スタック -1
  // 表示・その他
  toggleTelop:     { code: 'KeyT' },                           // テロップ表示トグル
  toggleBottomBar: { code: 'KeyH' },                           // ボトムバー表示トグル
  mute:            { code: 'KeyM' },                           // ミュートトグル
  // 危険操作（Phase 1 = スマホ側にも確認ダイアログ＝前原決定(a)）
  resetDialog:     { code: 'KeyR' }                            // 単独R = リセット確認ダイアログを開く
  // ※ トーナメント切替/削除/設定はキー割当が無い or S=設定ダイアログのため、
  //   Phase 1 で個別の op として設計する（Phase 0 スコープ外）。
});

// 破壊的操作。Phase 1 でスマホ UI 側に確認を挟む対象（前原決定 (a): PC限定にはしない）。
const DANGEROUS = Object.freeze(new Set(['resetDialog', 'reentryMinus', 'addOnMinus', 'specialMinus', 'entryCancel']));

// 操作名 → hall:forwarded-key と同型の payload（renderer.js:7717-7726 が受ける形）。
function toForwardedKey(op) {
  const m = OPS[op];
  if (!m) return null;
  return {
    code: m.code,
    key: m.key || '',
    control: !!m.control,
    shift: !!m.shift,
    alt: !!m.alt,
    meta: !!m.meta
  };
}

module.exports = { OPS, DANGEROUS, toForwardedKey };
