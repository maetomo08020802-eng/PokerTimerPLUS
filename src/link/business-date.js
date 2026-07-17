'use strict';

/**
 * 外部DB連携 STEP2a: 営業日（朝 8:00 JST 境界）の日付文字列を返す純関数。
 *
 * ★customer-app `web/src/lib/business-date.ts` の `currentBusinessDate` の逐語移植（連携先と同じ式で
 *   営業日を判定しないと「当日大会一覧」がズレるため、式を変えない・独自解釈しない）。
 *   式の正本は customer-app migration 0090 `attendance_business_date`（DB 側）と同一:
 *   - JST 壁時計（UTC + 9h）に変換し、そこから 8h 引いた日付を「営業日」とする。
 *   - JST は DST（夏時間）なしで +09:00 固定ゆえタイムゾーンライブラリ不要。
 *   - 例: 2026-06-16 03:00 JST（営業日 = 6/15 の深夜）→ "2026-06-15"
 *         2026-06-16 09:00 JST（営業日 = 6/16）→ "2026-06-16"
 *
 * ★plan review 指摘A: **UTC 算術を逐語維持**する。`getHours()` / `getDate()` 等の**ローカルタイム
 *   getter は使用禁止**（PC の OS タイムゾーン設定に結果が依存してしまう）。UTC getter のみ使う。
 *
 * 依存ゼロ・main/renderer どちらからも require 可能（現状は main の db-link.js のみが使う）。
 *
 * @param {Date} [now] 判定基準時刻（既定 = 現在）。テスト用に注入可能。
 * @returns {string} 'YYYY-MM-DD'（営業日）
 */
function currentBusinessDate(now = new Date()) {
  const jstMs = now.getTime() + 9 * 3_600_000; // UTC → JST 壁時計
  const biz = new Date(jstMs - 8 * 3_600_000); // 8h 引いて営業日（日付）を確定
  const y = biz.getUTCFullYear();
  const m = String(biz.getUTCMonth() + 1).padStart(2, '0');
  const d = String(biz.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = { currentBusinessDate };
