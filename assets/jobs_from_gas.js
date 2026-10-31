/* GASの担当案件（listMyJobs）・追加項目（getAdditionalItems）を、画面（v13.4のモックの案件の形）に変換して読み込む部品。
   画面に出すのは、GASが返す必要最小限の項目だけ（案件番号・日付・開始時刻・台数・地域・状態・写真報告の済み）。顧客の氏名・住所・電話は、GASが返さない。
   state は、画面の状態（state.jobs）。render は、読み込み後に画面を描き直す関数（省略可）。 */
var KKD135Jobs = (function () {
  'use strict';
  var SERVICE = 'エアコン脱着分解クリーニング';

  function isDone(status) {
    var s = String(status || '').toLowerCase();
    return s === 'done' || s === 'completed' || /^完了/.test(s);
  }

  // GASの1件 → 画面の案件
  function fromGas(r) {
    if (!r || typeof r !== 'object' || !r.caseId) return null;
    var done = isDone(r.status), units = Math.max(1, Number(r.units) || 1), reported = r.photoReported === true;
    return {
      id: String(r.caseId), gas: true, service: SERVICE, category: 'メンテナンス', units: units, unitOptions: {},
      date1: String(r.date || ''), time1: String(r.startTime || ''), date2: '', time2: '', name: 'お客様', zip: '', address: String(r.areaName || ''), note: '',
      photos: { install: true, model: true, outdoor: true, other: false },
      vendorChoice: done ? '第1希望' : '第1希望', vendorId: 'V-001', adminNote: '', vendorMemo: '',
      additionalFlag: '', additionalItems: [], customerDetailed: true,
      todayTime: '', scheduledDate: String(r.date || ''), scheduledTime: String(r.startTime || ''),
      completed: done, completedDate: done ? String(r.date || '') : '', completedAt: '',
      completionPhotos: { before: reported, after: reported }, photoReported: reported,
      rating: 0, ratingComment: '', ratingSubmitted: false, createdAt: '', receiptDateYmd: '', chatMessages: [], isStarted: false
    };
  }

  // 追加項目（GASの保存形）→ 画面の形。現場確認（onsite）があればそれを、無ければ写真確認後（review）を使う
  function applyAdditional(job, additional) {
    if (additional && additional.review && Array.isArray(additional.review.items)) { // 訪問前の見積（固定）：現場で変えても、残す
      job.reviewItems = additional.review.items.map(function (x) { return { id: x.code, name: x.name, qty: x.qty, mins: 0, price: x.unitPrice }; });
    }
    if (additional && additional.explain && Array.isArray(additional.explain.items)) job.freeItems = additional.explain.items.map(function (x) { return x.code; });
    var a = additional && (additional.onsite || additional.review);
    if (!a) return job;
    if (a.none === true) { job.additionalFlag = 'なし'; job.additionalItems = []; return job; }
    var items = Array.isArray(a.items) ? a.items : [];
    job.additionalItems = items.map(function (x) { return { id: x.code, name: x.name, qty: x.qty, mins: 0, price: x.unitPrice }; });
    job.additionalFlag = job.additionalItems.length ? 'あり' : '';
    return job;
  }

  // 読み込み：担当案件を取り、案件の追加項目も取り、state.jobs を置き換える（失敗したら、置き換えない）
  function load(backend, state, render) {
    if (!backend || typeof backend.listMyJobs !== 'function') return Promise.resolve({ status: 'ERROR', errorCode: 'NO_BACKEND' });
    return backend.listMyJobs().then(function (r) {
      if (!r || r.status !== 'OK' || !Array.isArray(r.jobs)) return r || { status: 'ERROR', errorCode: 'NETWORK' };
      var jobs = r.jobs.map(fromGas).filter(Boolean);
      return Promise.all(jobs.map(function (j) {
        if (typeof backend.getAdditional !== 'function') return j;
        return backend.getAdditional(j.id).then(function (g) { return (g && g.status === 'OK') ? applyAdditional(j, g.additional) : j; }, function () { return j; });
      })).then(function (list) {
        // GASの案件に置き換える。画面の試験用（モック）の案件（gas でないもの）は、消さずに残す（同じ案件番号は、GASを優先）
        var ids = {}; list.forEach(function (j) { ids[j.id] = 1; });
        var keep = state.jobs.filter(function (j) { return j && !j.gas && !ids[j.id]; });
        state.jobs.length = 0;
        list.concat(keep).forEach(function (j) { state.jobs.push(j); });
        if (typeof render === 'function') render();
        return { status: 'OK', count: list.length, kept: keep.length };
      });
    });
  }

  return { fromGas: fromGas, applyAdditional: applyAdditional, load: load };
})();
