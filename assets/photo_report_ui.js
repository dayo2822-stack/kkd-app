/* v13.5 写真報告の画面部品（業者：枠に写真を選んで[報告]／顧客：公開された写真の閲覧）。
   純関数は photo_report_logic.js（KKD135UI）。通信は backend（差し替え可能）：
   backend.upload(caseId, unitNo, stepNo, rawB64, webB64, requestId) → Promise<{status,errorCode?}>
   backend.report(caseId) → Promise<{status,errorCode?,missing?}>
   backend.list(caseId) → Promise<{status,photos:[{photoId,unitNo,stepNo}]}>   backend.file(caseId, photoId) → Promise<{status,base64}>
   選んだら、すぐ送る（送信のための別のタップは無い）。送れなかった枠は、枠をタップして選び直す。 */
var KKD135PhotoUI = (function () {
  'use strict';
  var U = KKD135UI;
  var WEB_EDGE = 1600, WEB_QUALITY = 0.82;

  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function labelOf(ctx, step) { return (ctx.labels && ctx.labels[step]) || step; }
  function readB64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result), i = s.indexOf(','); resolve(i >= 0 ? s.slice(i + 1) : s); };
      fr.onerror = function () { reject(new Error('読み込めません')); };
      fr.readAsDataURL(file);
    });
  }
  // 表示用（長辺1600px・JPEG）。原寸は別に、そのまま送る
  function makeWebB64(file) {
    return createImageBitmap(file).then(function (bmp) {
      var d = U.fitSize(bmp.width, bmp.height, WEB_EDGE);
      var c = document.createElement('canvas'); c.width = d.w; c.height = d.h;
      c.getContext('2d').drawImage(bmp, 0, 0, d.w, d.h);
      return new Promise(function (resolve, reject) {
        c.toBlob(function (b) { if (!b) return reject(new Error('変換できません')); readB64(b).then(resolve, reject); }, 'image/jpeg', WEB_QUALITY);
      });
    });
  }

  // ---- 業者：写真報告 ----
  function renderVendor(root, ctx) {
    var slots = U.buildSlots(ctx.units, ctx.steps), picked = {}, reported = !!ctx.alreadyReported, busy = Promise.resolve();
    var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
    var current = null;
    input.addEventListener('change', function () { var f = input.files && input.files[0]; if (f && current) ctrl.pick(current, f); input.value = ''; });

    function draw() {
      var pr = U.progress(slots, picked);
      var tiles = slots.map(function (s) {
        var x = picked[s.key], st = x ? x.status : '';
        var badge = !x ? '未選択' : st === 'uploaded' ? '✓ 送信済' : st === 'uploading' ? '送信中…' : st === 'failed' ? '⚠ 送れませんでした' : '選択済';
        var thumb = x && x.url ? '<img alt="" src="' + esc(x.url) + '" style="width:100%;height:70px;object-fit:cover;border-radius:4px;">' : '<div style="height:70px;display:flex;align-items:center;justify-content:center;font-size:20px;">📷</div>';
        return '<button type="button" class="photo-slot' + (x ? ' has-photo' : '') + '" data-slot="' + esc(s.key) + '" ' + (reported ? 'disabled' : '') + ' style="text-align:left;padding:4px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;">' +
          thumb + '<div style="font-size:9.5px;font-weight:bold;">' + (ctx.units > 1 ? '台' + s.unitNo + ' ' : '') + esc(labelOf(ctx, s.stepNo)) + '</div><div class="slot-badge" style="font-size:8.5px;color:var(--muted);">' + badge + '</div></button>';
      }).join('');
      root.innerHTML = '<div class="photo-report">' +
        '<div class="guide" style="font-size:10px;margin-bottom:6px;">' + esc(reported ? '報告済みです。' : U.guideText(pr)) + '</div>' +
        '<div class="photo-slots" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">' + tiles + '</div>' +
        '<div style="margin-top:8px;"><button type="button" class="btn primary report-btn" style="width:100%;" ' + ((pr.canReport && !reported) ? '' : 'disabled') + '>' + (reported ? '報告済み' : '報告') + '</button></div>' +
        '<div class="report-msg mini" style="margin-top:4px;color:var(--muted);"></div></div>';
      root.appendChild(input);
      Array.prototype.forEach.call(root.querySelectorAll('.photo-slot'), function (b) { b.addEventListener('click', function () { current = b.getAttribute('data-slot'); input.click(); }); });
      var rb = root.querySelector('.report-btn');
      if (rb) rb.addEventListener('click', function () { ctrl.report(); });
    }
    function upload(key) {
      var x = picked[key], s = slots.filter(function (q) { return q.key === key; })[0];
      x.status = 'uploading'; draw();
      var rid = U.requestIdFor(s, x);
      return Promise.all([readB64(x.file), makeWebB64(x.file)]).then(function (b) {
        return ctx.backend.upload(ctx.caseId, s.unitNo, s.stepNo, b[0], b[1], rid);
      }).then(function (r) { x.status = (r && r.status === 'OK') ? 'uploaded' : 'failed'; x.errorCode = r && r.errorCode; }, function () { x.status = 'failed'; }).then(draw);
    }
    var ctrl = {
      slots: slots, picked: picked,
      // 枠に写真を入れる。すぐ送る（順番に1枚ずつ）
      pick: function (key, file) {
        if (reported || !slots.some(function (s) { return s.key === key; })) return Promise.resolve();
        if (picked[key] && picked[key].url) { try { URL.revokeObjectURL(picked[key].url); } catch (e) {} }
        picked[key] = { name: file.name, size: file.size, lastModified: file.lastModified, status: 'selected', file: file, url: URL.createObjectURL(file) };
        draw();
        busy = busy.then(function () { return upload(key); });
        return busy;
      },
      report: function () {
        var pr = U.progress(slots, picked);
        if (!pr.canReport || reported) return Promise.resolve();
        return ctx.backend.report(ctx.caseId).then(function (r) {
          if (r && r.status === 'OK') { reported = true; draw(); if (ctx.onReported) ctx.onReported(r); }
          else { draw(); root.querySelector('.report-msg').textContent = '報告できませんでした。もう一度お試しください。'; }
          return r;
        });
      },
      isReported: function () { return reported; }
    };
    draw();
    return ctrl;
  }

  // ---- 顧客：公開された写真の閲覧（見た目は v13.4 の「施工写真の確認」と同じカード） ----
  function renderCustomer(root, ctx) {
    root.innerHTML = '<div class="photo-viewer-grid"></div><div class="cust-msg"></div>';
    var grid = root.querySelector('.photo-viewer-grid'), msg = root.querySelector('.cust-msg');
    return ctx.backend.list(ctx.caseId).then(function (r) {
      var list = (r && r.status === 'OK' && r.photos) || [];
      if (list.length === 0) { msg.innerHTML = '<div class="notice warn" style="margin:8px 0;font-size:9.5px;">⚠️ 業者が現場写真の登録作業を行っています。登録完了次第、即座に反映されます。</div>'; return { count: 0 }; }
      return Promise.all(list.map(function (p) {
        return ctx.backend.file(ctx.caseId, p.photoId).then(function (f) {
          var card = document.createElement('div'); card.className = 'photo-viewer-card has-photo';
          var ok = f && f.status === 'OK' && f.base64;
          card.innerHTML = '<div class="photo-preview">' + (ok ? '<img alt="" style="width:100%;height:80px;object-fit:cover;" src="data:image/jpeg;base64,' + f.base64 + '">' : '読み込めません') + '</div>' +
            '<div class="photo-label">【' + (ctx.unitsTotal > 1 ? '台' + esc(p.unitNo) + ' ' : '') + esc(labelOf(ctx, p.stepNo)) + '】</div>';
          grid.appendChild(card);
        });
      })).then(function () { msg.innerHTML = '<div class="notice ok" style="margin:8px 0;font-size:9.5px;">✓ 施工写真を確認できます。</div>'; return { count: list.length }; });
    });
  }

  return { renderVendor: renderVendor, renderCustomer: renderCustomer, makeWebB64: makeWebB64, readB64: readB64 };
})();
