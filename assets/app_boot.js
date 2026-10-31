/* v13.5 公開用の起動部品（業者・顧客のLIFFの画面）。window.KKD135_ENV = { role, liffId, gasUrl } は、公開用の生成物（checks/build_site.py）が入れる。
   - role が決まっていれば、他の役の切替バーを消し、その役の画面だけを出す（業者は業者、顧客は顧客の画面だけ）。
   - gasUrl と LIFF があれば、LIFFを初期化し、通信部品（gas_backend.js）に差し替える（写真報告・価格）。無ければ、単体のモックのまま動く。
   - IDやURLは、公開しても問題ない値だけ（秘密の値は、ここにも、どこにも入れない）。 */
(function () {
  'use strict';
  var env = window.KKD135_ENV || {};

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
    var backend = KKD135Gas.create({ url: env.gasUrl, getIdToken: function () { return liff.getIDToken(); }, customerToken: customerToken });
    window.KKD135_BACKEND = backend;
    if (env.role === 'vendor' && typeof KKD135Jobs !== 'undefined' && typeof state !== 'undefined') {
      // 本番の案件は、GASが持つ。保存（localStorage）は、試験用（モック）の案件だけ（GASの案件は保存しない）
      window.saveAndSync = function () {
        try {
          localStorage.setItem('kkd_state_jobs', JSON.stringify(state.jobs.filter(function (j) { return !j.gas; })));
          localStorage.setItem('kkd_state_vendor_avail', JSON.stringify(state.vendorAvailable));
          if (state.vendorTab) localStorage.setItem('kkd_vendor_tab', state.vendorTab);
        } catch (e) {}
      };
      KKD135Jobs.load(backend, state, function () { try { switchRole('vendor'); if (typeof renderSide === 'function') renderSide(); } catch (e) {} });
    }
    return backend.getPricing().then(function (r) { if (r && r.status === 'OK' && typeof applyPricing === 'function') applyPricing(r.pricing); });
  }).catch(function () { /* LIFFが使えない場合は、単体のモックのまま */ });
})();
