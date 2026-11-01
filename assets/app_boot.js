/* v13.5 公開用の起動部品（業者・顧客のLIFFの画面）。window.KKD135_ENV = { role, liffId, gasUrl } は、公開用の生成物（checks/build_site.py）が入れる。
   - role が決まっていれば、他の役の切替バーを消し、その役の画面だけを出す（業者は業者、顧客は顧客の画面だけ）。
   - gasUrl と LIFF があれば、LIFFを初期化し、通信部品（gas_backend.js）に差し替える（写真報告・価格）。無ければ、単体のモックのまま動く。
   - IDやURLは、公開しても問題ない値だけ（秘密の値は、ここにも、どこにも入れない）。 */
(function () {
  'use strict';
  var env = window.KKD135_ENV || {};

  if (env.build) { // 版の表示（どの版の画面が開いているかを、確かめられるように）
    var ver = document.createElement('div'); ver.textContent = '版 ' + env.build; ver.style.cssText = 'position:fixed;left:6px;bottom:2px;z-index:99998;font-size:9px;color:#94a3b8;pointer-events:none;'; document.body.appendChild(ver);
  }
  if (env.role && typeof switchRole === 'function') {
    var bar = document.getElementById('mobileRoleBar');
    if (bar) bar.style.display = 'none';
    switchRole(env.role);
  }
  if (!env.gasUrl || !env.liffId || typeof liff === 'undefined' || typeof KKD135Gas === 'undefined') return;

  // 顧客：LINEのメッセージのリンクに付いた閲覧トークン（?t=…）を受け取り、アドレス欄からは消す（履歴・共有に残さない）
  var customerToken = '';
  try {
    var q = new URLSearchParams(window.location.search);
    customerToken = q.get('t') || '';
    if (customerToken) { q.delete('t'); history.replaceState(null, '', window.location.pathname + (q.toString() ? '?' + q.toString() : '') + window.location.hash); }
  } catch (e) {}

  liff.init({ liffId: env.liffId }).then(function () {
    if (!liff.isLoggedIn()) { liff.login(); return; }
    var backend = KKD135Gas.create({ url: env.gasUrl, getIdToken: function () { return liff.getIDToken(); }, customerToken: customerToken, loginAction: env.role === 'customer' ? 'customerLogin' : 'lineLogin' });
    window.KKD135_BACKEND = backend;
    // 価格の取込み（料金マスタ）。オプション名（コード→名前）は、案件の取得と並行して取り、案件の変換に使う
    var pricingDone = backend.getPricing().then(function (r) { if (r && r.status === 'OK' && typeof applyPricing === 'function') applyPricing(r.pricing); });
    var namesP = pricingDone.then(function () { var names = {}; ((window.KKD135_PRICING && KKD135_PRICING.options) || []).forEach(function (o) { names[o.code] = o.name; }); return names; });
    // 案件を読み込んでいる間の表示（数秒かかる。何も出ないと、案件が無いように見えるため）
    function loading(on, msg) {
      var el = document.getElementById('kkd135Loading');
      if (!on && !msg) { if (el) el.parentNode.removeChild(el); return; }
      if (!el) { el = document.createElement('div'); el.id = 'kkd135Loading'; el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;padding:8px 12px;background:#0d6b57;color:#fff;font-size:12px;text-align:center;'; document.body.appendChild(el); }
      el.style.background = on ? '#0d6b57' : '#b45309'; el.textContent = msg;
    }
    function finished(r) {
      if (r && r.status === 'OK') loading(false);
      else loading(false, '案件を読み込めませんでした（' + ((r && r.errorCode) || 'NETWORK') + '）。画面を開き直してください。');
    }
    if (env.role === 'vendor' && typeof KKD135Jobs !== 'undefined' && typeof state !== 'undefined') {
      // 本番の案件は、GASが持つ。保存（localStorage）は、試験用（モック）の案件だけ（GASの案件は保存しない）
      window.saveAndSync = function () {
        try {
          localStorage.setItem('kkd_state_jobs', JSON.stringify(state.jobs.filter(function (j) { return !j.gas; })));
          localStorage.setItem('kkd_state_vendor_avail', JSON.stringify(state.vendorAvailable));
          if (state.vendorTab) localStorage.setItem('kkd_vendor_tab', state.vendorTab);
        } catch (e) {}
      };
      loading(true, '案件を読み込み中…');
      KKD135Jobs.load(backend, state, function () { try { switchRole('vendor'); if (typeof renderSide === 'function') renderSide(); } catch (e) {} }, namesP).then(finished, function () { finished(null); });
    }
    if (env.role === 'customer' && typeof kkd135RefreshBusy === 'function') kkd135RefreshBusy();
    if (env.role === 'customer' && typeof KKD135Jobs !== 'undefined' && typeof state !== 'undefined') {
      // 顧客：予約はGASが持つ。保存（localStorage）は、試験用（モック）の案件だけ
      window.saveAndSync = function () {
        try { localStorage.setItem('kkd_state_jobs', JSON.stringify(state.jobs.filter(function (j) { return !j.gas; }))); localStorage.setItem('kkd_state_vendor_avail', JSON.stringify(state.vendorAvailable)); if (state.customerTab) localStorage.setItem('kkd_customer_tab', state.customerTab); } catch (e) {}
      };
      loading(true, '予約を読み込み中…');
      KKD135Jobs.loadCustomer(backend, state, function () { try { if (typeof openCustomerCases === 'function') openCustomerCases(state.customerTab || 'before'); if (typeof renderSide === 'function') renderSide(); } catch (e) {} }, namesP).then(finished, function () { finished(null); });
    }
    return pricingDone;
  }).catch(function () { /* LIFFが使えない場合は、単体のモックのまま */ });
})();
