/* v13.5 画面（業者・顧客）→ GASウェブアプリ の通信部品。画面部品（photo_report_ui.js・追加項目）が使う backend と同じ形の関数を持つ。
   - 通信は POST（本文はJSON・Content-Type は text/plain＝ブラウザの事前確認を起こさない）。トークンは、本文にだけ入れる（URLには入れない）。
   - 業者：最初の呼び出しで、LIFFのIDトークンを送って lineLogin → セッションを得る。期限前は再利用。UNAUTHENTICATED なら、1回だけ再ログインして再試行。
   - 顧客：顧客閲覧トークン（案件ごと・URLの中ではなく、起動時に渡される値）を、本文に入れる。ログインは無い。
   - 通信の失敗・壊れた応答は、{status:'ERROR', errorCode:'NETWORK'|'BAD_RESPONSE'} にそろえる（画面は「送れませんでした」と出し、選び直せる）。秘密の値は、ログに出さない。 */
var KKD135Gas = (function () {
  'use strict';

  function create(opts) {
    var o = opts || {};
    var doFetch = o.fetch || (typeof fetch === 'function' ? fetch.bind(window) : null);
    var timeoutMs = o.timeoutMs || 60000;
    var session = null, expiresAt = 0, loginPromise = null;

    function post(body) {
      if (!doFetch || !o.url) return Promise.resolve({ status: 'ERROR', errorCode: 'NETWORK' });
      var timer, timedOut = new Promise(function (resolve) { timer = setTimeout(function () { resolve({ status: 'ERROR', errorCode: 'NETWORK' }); }, timeoutMs); });
      var req = doFetch(o.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' })
        .then(function (r) { return r.text(); })
        .then(function (t) { try { var j = JSON.parse(t); return (j && typeof j === 'object') ? j : { status: 'ERROR', errorCode: 'BAD_RESPONSE' }; } catch (e) { return { status: 'ERROR', errorCode: 'BAD_RESPONSE' }; } })
        .catch(function () { return { status: 'ERROR', errorCode: 'NETWORK' }; });
      return Promise.race([req, timedOut]).then(function (r) { clearTimeout(timer); return r; });
    }

    // 同時に何度呼ばれても、ログインは1回だけ
    function login() {
      if (loginPromise) return loginPromise;
      loginPromise = Promise.resolve().then(function () { return o.getIdToken ? o.getIdToken() : ''; }).then(function (tok) {
        if (!tok) return { status: 'ERROR', errorCode: 'TOKEN_INVALID' };
        var b = { action: o.loginAction || 'lineLogin', idToken: tok }; // 業者は lineLogin、顧客は customerLogin
        var n = o.getNonce ? o.getNonce() : ''; if (n) b.nonce = n;
        return post(b);
      }).then(function (r) {
        if (r && r.status === 'OK' && r.sessionToken) { session = r.sessionToken; expiresAt = Date.now() + Math.max(30, (Number(r.expiresIn) || 600) - 30) * 1000; }
        else { session = null; expiresAt = 0; }
        loginPromise = null;
        return r;
      }, function () { loginPromise = null; session = null; return { status: 'ERROR', errorCode: 'NETWORK' }; });
      return loginPromise;
    }
    function ensureSession() {
      if (session && Date.now() < expiresAt) return Promise.resolve({ status: 'OK' });
      return login();
    }
    // 業者の動作：セッションを付けて送る。UNAUTHENTICATED なら、1回だけ再ログインして再試行
    function vendor(body) {
      return ensureSession().then(function (l) {
        if (!l || l.status !== 'OK') return l;
        return post(Object.assign({}, body, { sessionToken: session })).then(function (r) {
          if (r && r.errorCode === 'UNAUTHENTICATED') {
            session = null; expiresAt = 0;
            return login().then(function (l2) { if (!l2 || l2.status !== 'OK') return l2; return post(Object.assign({}, body, { sessionToken: session })); });
          }
          return r;
        });
      });
    }
    function customer(body) { return post(Object.assign({}, body, { customerToken: o.customerToken || '' })); }

    return {
      // --- 写真報告（業者） ---
      upload: function (caseId, unitNo, stepNo, rawB64, webB64, requestId) { return vendor({ action: 'uploadStepPhoto', caseId: caseId, unitNo: unitNo, stepNo: stepNo, rawBase64: rawB64, webBase64: webB64, requestId: requestId }); },
      report: function (caseId) { return vendor({ action: 'submitPhotoReport', caseId: caseId }); },
      // --- 写真の閲覧（顧客） ---
      list: function (caseId) { return customer({ action: 'getCustomerPhotos', caseId: caseId }); },
      file: function (caseId, photoId) { return customer({ action: 'getCustomerPhotoFile', caseId: caseId, photoId: photoId }); },
      // --- 価格（誰でも・読むだけ） ---
      getPricing: function () { return post({ action: 'getPricing' }); },
      // --- 追加項目（業者） ---
      setAdditional: function (caseId, phase, payload) { return vendor(Object.assign({ action: 'setAdditionalItems', caseId: caseId, phase: phase }, payload || {})); },
      getAdditional: function (caseId) { return vendor({ action: 'getAdditionalItems', caseId: caseId }); },
      // --- 予約（顧客）：作成・自分の予約の取得 ---
      createBooking: function (payload) { return vendor(Object.assign({ action: 'createBooking' }, payload || {})); },
      listMyBookings: function () { return vendor({ action: 'listMyBookings' }); },
      getBusySlots: function () { return vendor({ action: 'getBusySlots' }); },
      getAvailableSupply: function (address) { return vendor({ action: 'getAvailableSupply', address: address }); },
      getMyAvailability: function () { return vendor({ action: 'getMyAvailability' }); },
      saveMyAvailability: function (date, times) { return vendor({ action: 'saveMyAvailability', date: date, times: times }); },
      checkArea: function (address) { return vendor({ action: 'checkArea', address: address }); },
      submitAddressDetail: function (p) { return vendor(Object.assign({ action: 'submitAddressDetail' }, p || {})); },
      uploadBookingPhoto: function (caseId, kind, webB64, requestId) { return vendor({ action: 'uploadBookingPhoto', caseId: caseId, kind: kind, webBase64: webB64, requestId: requestId }); },
      getBookingPhotoFile: function (caseId, kind) { return vendor({ action: 'getBookingPhotoFile', caseId: caseId, kind: kind }); },
      // --- 担当案件（業者） ---
      listMyJobs: function () { return vendor({ action: 'listMyJobs' }); },
      getAreaMaster: function () { return vendor({ action: 'getAreaMaster' }); },
      getMyProfile: function () { return vendor({ action: 'getMyProfile' }); },
      saveMyProfile: function (p) { return vendor(Object.assign({ action: 'saveMyProfile' }, p || {})); },
      saveCompletionInfo: function (caseId, p) { return vendor(Object.assign({ action: 'saveCompletionInfo', caseId: caseId }, p || {})); },
      saveMyAreas: function (areas) { return vendor({ action: 'saveMyAreas', areas: areas }); },
      startWork: function (caseId) { return vendor({ action: 'startWork', caseId: caseId }); },
      sendTodayNotice: function (caseId, time) { return vendor({ action: 'sendTodayNotice', caseId: caseId, time: time }); },
      completeWork: function (caseId) { return vendor({ action: 'completeWork', caseId: caseId }); },
      confirmVisit: function (caseId, choice) { return vendor({ action: 'confirmVisit', caseId: caseId, choice: choice }); },
      checkPhotos: function (caseId) { return vendor({ action: 'checkPhotos', caseId: caseId }); },
      respondRequest: function (caseId, accept, choice) { return vendor({ action: 'respondRequest', caseId: caseId, accept: accept === true, choice: choice === 2 ? 2 : 1 }); },
      // 試験・診断用
      _hasSession: function () { return !!session && Date.now() < expiresAt; }
    };
  }

  return { create: create };
})();
