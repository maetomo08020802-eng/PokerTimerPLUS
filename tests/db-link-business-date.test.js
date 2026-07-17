'use strict';

/**
 * 外部DB連携 STEP2a: 営業日（朝 8:00 JST 境界）純関数の実値検証。
 * customer-app `web/src/lib/business-date.ts` の逐語移植が同じ値を返すことを固定ケースで担保する。
 *
 * ★plan review 指摘A: 実装が **UTC 算術のみ**であること（ローカルタイム getter 不使用＝
 *   PC の OS タイムゾーン設定に依存しない）も静的に検査する。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { currentBusinessDate } = require('../src/link/business-date');

let count = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  count++;
}
function eq(a, b, msg) {
  assert.equal(a, b, msg);
  count++;
}

// ---- 実値検証（Date は UTC instant で与える＝実行環境の TZ に依存しない） ----
// 2026-06-16 03:00 JST = 2026-06-15T18:00Z → 営業日 6/15（深夜帯は前営業日）
eq(currentBusinessDate(new Date('2026-06-15T18:00:00Z')), '2026-06-15', '03:00 JST は前営業日');
// 2026-06-16 09:00 JST = 2026-06-16T00:00Z → 営業日 6/16
eq(currentBusinessDate(new Date('2026-06-16T00:00:00Z')), '2026-06-16', '09:00 JST は当日');
// 境界: 07:59:59 JST → 前営業日
eq(currentBusinessDate(new Date('2026-06-15T22:59:59Z')), '2026-06-15', '07:59:59 JST は前営業日');
// 境界: 08:00:00 JST ちょうど → 当日
eq(currentBusinessDate(new Date('2026-06-15T23:00:00Z')), '2026-06-16', '08:00:00 JST は当日');
// 月跨ぎ: 7/1 02:00 JST = 6/30T17:00Z → 営業日 6/30
eq(currentBusinessDate(new Date('2026-06-30T17:00:00Z')), '2026-06-30', '月初深夜は前月末の営業日');
// 年跨ぎ: 1/1 03:00 JST = 前年12/31T18:00Z → 営業日 12/31
eq(currentBusinessDate(new Date('2026-12-31T18:00:00Z')), '2026-12-31', '元日深夜は大晦日の営業日');
// 引数なしでも 'YYYY-MM-DD' 形式を返す
ok(/^\d{4}-\d{2}-\d{2}$/.test(currentBusinessDate()), '既定引数で YYYY-MM-DD');

// ---- 静的検査: ローカルタイム getter 禁止（UTC 算術の逐語維持） ----
// コメントには説明として getter 名が現れ得るため、コメントを除去した「コードのみ」を検査する。
const raw = fs.readFileSync(path.join(__dirname, '..', 'src', 'link', 'business-date.js'), 'utf8');
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, '') // ブロックコメント除去
  .replace(/^\s*\/\/.*$/gm, '');    // 行コメント除去
for (const banned of ['getHours(', 'getDate(', 'getFullYear(', 'getMonth(', 'getMinutes(', 'toLocale']) {
  ok(!code.includes(banned), `business-date.js のコードはローカルタイム getter「${banned}」を使わない`);
}
ok(code.includes('getUTCFullYear'), 'UTC getter を使用している');

console.log(`db-link-business-date.test.js: ${count} assertions passed`);
