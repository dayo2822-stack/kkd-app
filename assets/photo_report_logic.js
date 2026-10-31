/* v13.5 写真報告画面の純関数（枠の組立・進み具合・再送しても二重にならない要求ID・表示用の寸法）。
   画面（HTML）とは分け、ここだけを試験する。DOM・ネットワーク・時刻に触れない。入力を書き換えない。 */
var KKD135UI = (function () {
  'use strict';
  var SAFE = /^[A-Za-z0-9_-]{1,64}$/;

  // 枠＝台数 × 工程。台数が1以上の整数でない・工程が空なら、空の配列（画面は「報告できません」と出す）
  function buildSlots(units, steps) {
    var slots = [];
    if (typeof units !== 'number' || units < 1 || Math.floor(units) !== units || units > 20) return slots;
    if (!Array.isArray(steps)) return slots;
    var clean = steps.filter(function (s) { return typeof s === 'string' && SAFE.test(s); });
    for (var u = 1; u <= units; u++) {
      for (var i = 0; i < clean.length; i++) slots.push({ key: u + ':' + clean[i], unitNo: u, stepNo: clean[i] });
    }
    return slots;
  }

  // picked：{ 'unit:step': { name, size, lastModified, status:'selected'|'uploading'|'uploaded'|'failed' } }
  function progress(slots, picked) {
    var total = slots.length, filled = 0, uploaded = 0, failed = 0, missing = [];
    var p = picked && typeof picked === 'object' ? picked : {};
    slots.forEach(function (s) {
      var x = p[s.key];
      if (x && typeof x === 'object') {
        filled++;
        if (x.status === 'uploaded') uploaded++;
        if (x.status === 'failed') failed++;
      } else missing.push(s.key);
    });
    // 報告できるのは、全枠が選ばれ、全部が送信済みのとき（送信中・失敗があれば不可）
    var canReport = total > 0 && filled === total && uploaded === total;
    return { total: total, filled: filled, uploaded: uploaded, failed: failed, missing: missing, canReport: canReport };
  }

  function hash32(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // 同じ枠・同じ写真（名前・大きさ・更新時刻が同じ）なら、何度送っても同じ要求ID（GAS側が二重に保存しない）
  function requestIdFor(slot, file) {
    if (!slot || !file) return '';
    var sig = hash32([file.name, file.size, file.lastModified].join('|'));
    var id = 'u' + slot.unitNo + 's' + String(slot.stepNo).replace(/[^A-Za-z0-9_-]/g, '') + 'f' + sig;
    return SAFE.test(id) ? id : '';
  }

  // 送るべきものを、枠の順に並べる（送信済みは飛ばす。失敗・選択だけのものは送る）
  function pendingUploads(slots, picked) {
    var p = picked && typeof picked === 'object' ? picked : {};
    var out = [];
    slots.forEach(function (s) {
      var x = p[s.key];
      if (x && x.status !== 'uploaded' && x.status !== 'uploading') out.push({ slot: s, requestId: requestIdFor(s, x) });
    });
    return out;
  }

  // 表示用の寸法：長辺をmaxEdgeに収める（拡大しない）。原寸は別に、そのまま送る
  function fitSize(w, h, maxEdge) {
    if (!(w > 0) || !(h > 0) || !(maxEdge > 0)) return { w: 0, h: 0 };
    var m = Math.max(w, h);
    if (m <= maxEdge) return { w: Math.round(w), h: Math.round(h) };
    var k = maxEdge / m;
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  // 画面の状態文：枠が足りない時の案内（業者に難しい言葉を使わない）
  function guideText(pr) {
    if (pr.total === 0) return '写真の枠を表示できません。管理者にご連絡ください。';
    if (pr.canReport) return 'すべて選べました。[報告]を押してください。';
    if (pr.failed > 0) return '送れなかった写真があります。もう一度、送信してください。';
    if (pr.filled < pr.total) return 'あと' + (pr.total - pr.filled) + '枠、写真を選んでください。';
    return '写真を送信しています…';
  }

  return { buildSlots: buildSlots, progress: progress, requestIdFor: requestIdFor, pendingUploads: pendingUploads, fitSize: fitSize, guideText: guideText };
})();
