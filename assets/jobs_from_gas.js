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

  // 選んだオプション（{OPT_コード: 数}）を、台ごとの形（{台番号: [項目名]}）に直す。数は台数の若い順に付ける。names：{OPT_コード: 項目名}（無ければ空）
  function unitOptionsFrom(sel, units, names) {
    var uo = {}; if (!sel || typeof sel !== 'object') return uo;
    Object.keys(sel).forEach(function (code) {
      var n = Math.min(units, Number(sel[code]) || 0), nm = names && names[code];
      if (!nm) return;
      for (var i = 1; i <= n; i++) { uo[i] = uo[i] || []; uo[i].push(nm); }
    });
    return uo;
  }

  // 訪問先の写真（駐車位置・進入経路）の有無
  function visitPhotosOf(p) { return { parking: !!(p && p.parking === true), entrance: !!(p && p.entrance === true) }; }
  // 詳細住所（顧客の入力）を、画面の案件に入れる。d：{block, building, room, memo}
  function applyDetail(job, d) {
    if (!d || typeof d !== 'object') return job;
    job.addressBlock = String(d.block || ''); job.buildingName = String(d.building || ''); job.roomNumber = String(d.room || '');
    job.detailAddress = [job.addressBlock, job.buildingName, job.roomNumber].filter(Boolean).join(' ');
    job.visitInfo = { routeMemo: String(d.memo || '') };
    return job;
  }

  // 写真の状況（GASの {install, model, outdoor, other}）。GASが返さない（予約の無い旧の案件）なら、既定値
  function photosOf(p, dflt) {
    if (!p || typeof p !== 'object') return dflt;
    return { install: p.install === true, model: p.model === true, outdoor: p.outdoor === true, other: p.other === true };
  }

  // 訪問日時が確定済みなら、第1・第2希望のどちらか（希望日時の無い案件は、第1希望）。未確定（日時が空）なら、空
  function choiceOf(r) {
    var d = String(r.date || ''); if (!d) return '';
    if (r.date2 && d === String(r.date2) && String(r.startTime || '') === String(r.time2 || '')) return '第2希望';
    return '第1希望';
  }

  function isWorking(status) { return String(status || '').toLowerCase() === 'working'; }

  // GASの1件 → 画面の案件
  function fromGas(r, names) {
    var j = fromGasBase(r, names);
    if (j && r && r.completion && typeof r.completion === 'object') {
      j.compShowReview = r.completion.showReview !== false; j.compShowInvoice = r.completion.showInvoice !== false; j.compShowInstaller = r.completion.showInstaller === true;
      j.compInstallers = Array.isArray(r.completion.installers) ? r.completion.installers.map(String) : [];
      j.profileHas = { review: !!(r.profileHas && r.profileHas.review), invoice: !!(r.profileHas && r.profileHas.invoice) };
      j.compRoster = Array.isArray(r.roster) ? r.roster.map(function (x) { return String(x.name); }) : [];
    }
    return (j && r && r.visitInfo) ? applyVisitInfo(j, r.visitInfo) : j;
  }
  function fromGasBase(r, names) {
    if (!r || typeof r !== 'object' || !r.caseId) return null;
    var done = isDone(r.status), units = Math.max(1, Number(r.units) || 1), reported = r.photoReported === true;
    return {
      id: String(r.caseId), gas: true, service: SERVICE, category: 'メンテナンス', units: units, unitOptions: unitOptionsFrom(r.selections, units, names),
      date1: String(r.date1 || r.date || ''), time1: String(r.time1 || r.startTime || ''), date2: String(r.date2 || ''), time2: String(r.time2 || ''), name: 'お客様', zip: '', address: String(r.areaName || ''), note: '',
      photos: photosOf(r.photos, { install: true, model: true, outdoor: true, other: false }), visitPhotos: visitPhotosOf(r.photos),
      vendorChoice: choiceOf(r), vendorId: 'V-001', adminNote: '', vendorMemo: '',
      additionalFlag: '', additionalItems: [], customerDetailed: r.detailed !== false,
      todayTime: '', noticeEta: String(r.noticeTime || ''), noticeAt: String(r.noticeAt || ''), scheduledDate: String(r.date || ''), scheduledTime: String(r.startTime || ''),
      completed: done, completedDate: done ? String(r.date || '') : '', completedAt: done ? String(r.completedAt || '') : '', isStarted: isWorking(r.status) || done, startedAt: String(r.startedAt || ''),
      completionPhotos: { before: reported, after: reported }, photoReported: reported,
      rating: 0, ratingComment: '', ratingSubmitted: false, createdAt: '', receiptDateYmd: '', chatMessages: []
    };
  }

  function applyVisitInfo(job, v) {
    if (!v || typeof v !== 'object') return job;
    job.name = String(v.name || 'お客様'); job.zip = String(v.zip || ''); job.address = String(v.address || job.address);
    return applyDetail(job, { block: v.block, building: v.building, room: v.room, memo: v.memo });
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
  // namesP：{OPT_コード: 項目名} か、それを返す Promise（価格の取得を待たずに、案件の取得を並行して始められる）
  // opts.onlyIfChanged：前回と同じ内容なら、入れ替えも描き直しもしない（定期的な取り直し用）
  function load(backend, state, render, namesP, opts) {
    if (!backend || typeof backend.listMyJobs !== 'function') return Promise.resolve({ status: 'ERROR', errorCode: 'NO_BACKEND' });
    return Promise.all([backend.listMyJobs(), Promise.resolve(namesP).then(function (x) { return x; }, function () { return null; })]).then(function (both) {
      var r = both[0], names = both[1];
      if (!r || r.status !== 'OK' || !Array.isArray(r.jobs)) return r || { status: 'ERROR', errorCode: 'NETWORK' };
      var jobs = r.jobs.map(function (x) { return fromGas(x, names); }).filter(Boolean);
      var embedded = {}; r.jobs.forEach(function (x) { if (x && x.caseId && x.additional && typeof x.additional === 'object') embedded[String(x.caseId)] = x.additional; });
      return Promise.all(jobs.map(function (j) {
        if (embedded[j.id]) return applyAdditional(j, embedded[j.id]); // 一覧に同梱されている分は、追加の問い合わせをしない
        if (typeof backend.getAdditional !== 'function') return j;
        return backend.getAdditional(j.id).then(function (g) { return (g && g.status === 'OK') ? applyAdditional(j, g.additional) : j; }, function () { return j; });
      })).then(function (list) {
        // GASの案件に置き換える。画面の試験用（モック）の案件（gas でないもの）は、消さずに残す（同じ案件番号は、GASを優先）
        var sig = JSON.stringify(list);
        if (opts && opts.onlyIfChanged && state.__gasSig === sig) return { status: 'OK', count: list.length, unchanged: true };
        state.__gasSig = sig;
        var prev = {}; state.jobs.forEach(function (j) { if (j && j.gas) prev[j.id] = j; });
        list.forEach(function (j) { if (prev[j.id] && prev[j.id]._addOpen) j._addOpen = true; }); // 画面だけの状態は引き継ぐ
        var ids = {}; list.forEach(function (j) { ids[j.id] = 1; });
        var keep = state.jobs.filter(function (j) { return j && !j.gas && !ids[j.id]; });
        state.jobs.length = 0;
        list.concat(keep).forEach(function (j) { state.jobs.push(j); });
        if (typeof render === 'function') render();
        return { status: 'OK', count: list.length, kept: keep.length };
      });
    });
  }

  // ---- 顧客：自分の予約（GASの listMyBookings）→ 画面の案件 ----
  // names：{OPT_コード: 項目名}（料金マスタから）。選んだオプションは、台数の若い順に付ける（台ごとの選択は、予約画面の形に合わせる）
  function fromBooking(b, names) {
    var j = fromBookingBase(b, names);
    if (j && b && b.detail) { applyDetail(j, b.detail); j.customerDetailed = true; }
    if (j && b && b.additional) applyAdditional(j, b.additional); // 業者が選んだ追加項目（見積・内訳を、業者の画面と同じにする）
    return j;
  }
  function fromBookingBase(b, names) {
    if (!b || typeof b !== 'object' || !b.caseId) return null;
    var done = isDone(b.status), units = Math.max(1, Number(b.units) || 1), uo = unitOptionsFrom(b.selections, units, names);
    var visitDate = String(b.date || ''), chosen = '';
    if (visitDate) chosen = (visitDate === String(b.date1 || '') && String(b.startTime || '') === String(b.time1 || '')) ? '第1希望' : '第2希望';
    return {
      id: String(b.caseId), gas: true, service: SERVICE, category: 'メンテナンス', units: units, unitOptions: uo, options: [],
      date1: String(b.date1 || ''), time1: String(b.time1 || ''), date2: String(b.date2 || ''), time2: String(b.time2 || ''),
      name: String(b.name || ''), zip: String(b.zip || ''), address: String(b.address || ''), note: String(b.note || ''),
      photos: photosOf(b.photos, { install: false, model: false, outdoor: false, other: false }), visitPhotos: visitPhotosOf(b.photos),
      vendorChoice: chosen, vendorId: 'V-001', adminNote: '', vendorMemo: '', additionalFlag: '', additionalItems: [], customerDetailed: false,
      todayTime: '', noticeEta: String(b.noticeTime || ''), noticeAt: String(b.noticeAt || ''), scheduledDate: visitDate, scheduledTime: String(b.startTime || ''),
      reviewUrl: String(b.reviewUrl || ''), invoiceNo: String(b.invoiceNo || ''), installers: Array.isArray(b.installers) ? b.installers.map(String) : [],
      completed: done, completedDate: done ? visitDate : '', completedAt: done ? String(b.completedAt || '') : '', completionPhotos: { before: false, after: false },
      rating: 5, ratingComment: '', ratingSubmitted: false, createdAt: '', receiptDateYmd: '', chatMessages: [], isStarted: isWorking(b.status) || done, startedAt: String(b.startedAt || '')
    };
  }
  function loadCustomer(backend, state, render, names, opts) {
    if (!backend || typeof backend.listMyBookings !== 'function') return Promise.resolve({ status: 'ERROR', errorCode: 'NO_BACKEND' });
    return Promise.all([backend.listMyBookings(), Promise.resolve(names).then(function (x) { return x; }, function () { return null; })]).then(function (both) {
      var r = both[0], nm = both[1];
      if (!r || r.status !== 'OK' || !Array.isArray(r.bookings)) return r || { status: 'ERROR', errorCode: 'NETWORK' };
      var list = r.bookings.map(function (b) { return fromBooking(b, nm); }).filter(Boolean);
      var sig = JSON.stringify(list);
      if (opts && opts.onlyIfChanged && state.__gasSig === sig) return { status: 'OK', count: list.length, unchanged: true };
      state.__gasSig = sig;
      var ids = {}; list.forEach(function (j) { ids[j.id] = 1; });
      var keep = state.jobs.filter(function (j) { return j && !j.gas && !ids[j.id]; });
      state.jobs.length = 0;
      list.concat(keep).forEach(function (j) { state.jobs.push(j); });
      if (typeof render === 'function') render();
      return { status: 'OK', count: list.length, kept: keep.length };
    });
  }

  return { visitPhotosOf: visitPhotosOf, fromGas: fromGas, applyAdditional: applyAdditional, load: load, fromBooking: fromBooking, loadCustomer: loadCustomer };
})();
