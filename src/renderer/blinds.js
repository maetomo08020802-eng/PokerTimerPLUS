// ブラインド構造管理
// STEP 3b: 編集 API（setStructure / validateStructure / cloneStructure）を追加。
// 編集系の CRUD（add/insert/remove/move/update）は renderer.js 側の draft（独立クローン）に対して
// 行い、最終的に setStructure(draft) で active 構造へ commit する設計。

let currentStructure = null;

// プリセットJSONを fetch で読み込み、構造を保持する（起動時の初回ロード用）
export async function loadPreset(relativePath) {
  const response = await fetch(relativePath);
  if (!response.ok) {
    throw new Error(`プリセット読み込み失敗: ${relativePath} (${response.status})`);
  }
  currentStructure = await response.json();
  return currentStructure;
}

// active 構造を差し替える（編集の「適用」ボタン用）
// caller は呼び出し後に state.reset() を実行してタイマーを再起動すること
export function setStructure(structure) {
  if (!validateStructure(structure)) {
    throw new Error('無効なブラインド構造です');
  }
  currentStructure = structure;
  return currentStructure;
}

// 現在の構造（全レベル含む）
export function getStructure() {
  return currentStructure;
}

// 指定インデックスのレベル定義
export function getLevel(index) {
  if (!currentStructure) return null;
  return currentStructure.levels[index] ?? null;
}

// 次のレベル定義（プレビュー表示用）。最終レベル時は null。
export function getNextLevel(index) {
  return getLevel(index + 1);
}

// レベル総数
export function getLevelCount() {
  return currentStructure ? currentStructure.levels.length : 0;
}

// 指定レベルがブレイクか判定
export function isBreakLevel(index) {
  const level = getLevel(index);
  return Boolean(level?.isBreak);
}

// ===== STEP 3b: 編集系ユーティリティ =====

// 構造の deep clone（編集時にメイン構造を汚染しないため）
export function cloneStructure(structure) {
  if (!structure) return null;
  return JSON.parse(JSON.stringify(structure));
}

// STEP 10 フェーズB: 構造型ごとのフィールド検証
//   structureType がプリセットに付与されていれば、その fields を必須に。
//   無ければ 'BLIND' とみなして sb/bb/bbAnte を必須にする（マイグレーション後の standard）。
// STEP 10 フェーズC.2.3: MIX 追加（fields: 動的、各レベルの subStructureType を参照）
const STRUCTURE_FIELDS_RENDERER = Object.freeze({
  BLIND:        ['sb', 'bb', 'bbAnte'],
  LIMIT_BLIND:  ['sb', 'bb', 'smallBet', 'bigBet'],
  SHORT_DECK:   ['ante', 'buttonBlind'],
  STUD:         ['ante', 'bringIn', 'smallBet', 'bigBet'],
  MIX:          []   // 動的、各レベルの subStructureType を参照
});
function _fieldsForStructure(st) {
  return STRUCTURE_FIELDS_RENDERER[st] || STRUCTURE_FIELDS_RENDERER.BLIND;
}

// スキーマ検証（最小限）。invalid なら false を返す
// STEP 10 フェーズC.2 中 8: 通常レベル（!isBreak）が 0 件のプリセットは invalid
export function validateStructure(structure) {
  if (!structure || typeof structure !== 'object') return false;
  if (typeof structure.id !== 'string' || !structure.id) return false;
  if (typeof structure.name !== 'string' || !structure.name) return false;
  if (!Array.isArray(structure.levels) || structure.levels.length === 0) return false;
  const structureType = (typeof structure.structureType === 'string' && STRUCTURE_FIELDS_RENDERER[structure.structureType])
    ? structure.structureType : 'BLIND';
  const fields = _fieldsForStructure(structureType);
  let regularLevelCount = 0;
  const isMix = (structureType === 'MIX');
  for (const lv of structure.levels) {
    if (!lv || typeof lv !== 'object') return false;
    if (typeof lv.durationMinutes !== 'number' || lv.durationMinutes <= 0) return false;
    if (lv.isBreak === true) {
      // ブレイク行: 構造型のフィールドは不要、label は任意
      continue;
    }
    regularLevelCount += 1;
    if (isMix) {
      // STEP 10 フェーズC.2.3: MIX は各レベルが subStructureType を持ち、対応する fields を検証
      // STEP 10 フェーズC.2.5: subGameType も必須化（編集 UI 経由で必ず設定される前提）
      if (typeof lv.subGameType !== 'string' || !lv.subGameType) return false;
      const sub = (typeof lv.subStructureType === 'string' && STRUCTURE_FIELDS_RENDERER[lv.subStructureType])
        ? lv.subStructureType : null;
      if (!sub || sub === 'MIX') return false;   // MIX 内の MIX はネスト不可
      const subFields = STRUCTURE_FIELDS_RENDERER[sub];
      for (const f of subFields) {
        if (typeof lv[f] !== 'number' || lv[f] < 0) return false;
      }
    } else {
      for (const f of fields) {
        if (typeof lv[f] !== 'number' || lv[f] < 0) return false;
      }
    }
  }
  // STEP 10 フェーズC.2 中 8: 通常レベル 0 件はタイマーが意味を成さないため reject
  if (regularLevelCount === 0) return false;
  return true;
}

// STEP 10 フェーズC.2 中 9: ソフト警告チェック（保存可だが運用上の不整合を検出）
//   - BLIND/LIMIT_BLIND: SB > BB の不整合
//   - LIMIT_BLIND/STUD: SmallBet > BigBet の不整合
//   - 戻り値: { ok: true } または { ok: false, warnings: [文字列, ...] }
//   呼び出し側で setBlindsHint 等で表示する。validateStructure とは別ガード（こちらは保存阻止しない）
export function checkStructureSoftWarnings(structure) {
  const warnings = [];
  if (!structure || !Array.isArray(structure.levels)) return { ok: true, warnings };
  for (const lv of structure.levels) {
    if (!lv || lv.isBreak) continue;
    if (typeof lv.sb === 'number' && typeof lv.bb === 'number' && lv.sb > lv.bb) {
      warnings.push(`Lv${lv.level ?? '?'}: SB(${lv.sb}) が BB(${lv.bb}) を超えています`);
    }
    if (typeof lv.smallBet === 'number' && typeof lv.bigBet === 'number' && lv.smallBet > lv.bigBet) {
      warnings.push(`Lv${lv.level ?? '?'}: Small Bet(${lv.smallBet}) が Big Bet(${lv.bigBet}) を超えています`);
    }
  }
  return { ok: warnings.length === 0, warnings };
}

// STEP 10 フェーズB: 構造型に応じたフィールド一覧を返す（renderer.js から再利用）
export function getStructureFieldsForRenderer(structureType) {
  return _fieldsForStructure(structureType);
}

// 構造を JSON 文字列にシリアライズ（エクスポート用、整形あり）
export function exportToJSON(structure) {
  return JSON.stringify(structure, null, 2);
}

// JSON 文字列をパースしてスキーマ検証（インポート用）
// 失敗時は null を返す
export function importFromJSON(jsonString) {
  try {
    const parsed = JSON.parse(jsonString);
    if (!validateStructure(parsed)) return null;
    return parsed;
  } catch (err) {
    console.warn('JSON パースに失敗:', err);
    return null;
  }
}

// レベル番号の自動採番（ブレイクをスキップ）
// 与えられた構造の `levels` 配列に対し、各 non-break 行の level に連番を振り直して返す
export function renumberLevels(levels) {
  let counter = 0;
  return levels.map((lv) => {
    if (lv.isBreak) {
      return { ...lv, level: null };
    }
    counter += 1;
    return { ...lv, level: counter };
  });
}
