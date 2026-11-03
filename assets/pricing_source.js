/* v13.5 価格の唯一の元（スプレッドシート「料金マスタ」）を、価格マスターに変換し、金額を計算する純関数。
   画面・LP・会計は、ここで得た値だけを使う（金額を、画面やLPの中に直接書かない）。
   オプションは「行」で持つ：行を足せば増え、消せば減る（コードの変更は要らない）。項目コードは OPT_ で始める。
   壊れた表からは、価格を作らない（一部だけ出さない）：errors を返し、呼び出し側は、価格を表示しない／前回の正しい値を使う。 */
var KKD135PRICE = (function () {
  'use strict';
  var FEE_CODES = { FEE_TRAVEL: 'travelFee', FEE_PARKING: 'parkingFee' };
  var REQUIRED = ['UNIT_PRICE', 'MIN_UNITS', 'MAX_UNITS'];
  var OPT_CODE = /^OPT_[A-Z0-9_]{1,40}$/;
  var FREE_CODE = /^FREE_[A-Z0-9_]{1,40}$/; // 無償の選択項目（作業完了後の顧客説明で選ぶ。金額は必ず0）

  // 所要時間（分）：空欄は0（未設定）。0以上の整数以外は、0とみなす（時間は表示用で、価格の計算には使わない）
  function toMins(v) { var n = (typeof v === 'string') ? Number(v.replace(/[,\s]/g, '')) : v; return (typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n) ? n : 0; }
  function toAmount(v) {
    if (typeof v === 'number') return (isFinite(v) && v >= 0 && Math.floor(v) === v) ? v : NaN;
    if (typeof v === 'string' && /^\d{1,9}$/.test(v.replace(/[,\s]/g, ''))) return Number(v.replace(/[,\s]/g, ''));
    return NaN;
  }

  // rows：[{code, amount, name?, unit?}]（code＝項目コード、amount＝金額または台数、unit＝「台」か「件」。省略は「台」）。同じ項目コードが2行あれば、あいまいなのでエラー
  function fromRows(rows) {
    var errors = [], seen = {}, got = {}, ignored = [], options = [], freeOptions = [], unitMins = 0;
    if (!Array.isArray(rows)) return { ok: false, errors: [{ code: '', reason: 'ROWS_INVALID' }] };
    rows.forEach(function (r) {
      var code = r && typeof r.code === 'string' ? r.code.trim() : '';
      if (!code) return;
      var isOpt = code.indexOf('OPT_') === 0, isFree = code.indexOf('FREE_') === 0;
      var known = code === 'UNIT_PRICE' || code === 'MIN_UNITS' || code === 'MAX_UNITS' || FEE_CODES[code] || isOpt || isFree;
      if (!known) { ignored.push(code); return; } // 旧のサンプル行など。価格には使わない
      if (seen[code]) { errors.push({ code: code, reason: 'DUPLICATE' }); return; }
      seen[code] = true;
      var a = toAmount(r.amount);
      if (isNaN(a)) { errors.push({ code: code, reason: 'AMOUNT_INVALID' }); return; }
      if (isFree) {
        if (!FREE_CODE.test(code)) { errors.push({ code: code, reason: 'CODE_INVALID' }); return; }
        if (a !== 0) { errors.push({ code: code, reason: 'FREE_MUST_BE_ZERO' }); return; }
        freeOptions.push({ code: code, name: (typeof r.name === 'string' && r.name.trim()) ? r.name.trim() : code });
        return;
      }
      if (isOpt) {
        if (!OPT_CODE.test(code)) { errors.push({ code: code, reason: 'CODE_INVALID' }); return; }
        var unit = (typeof r.unit === 'string' && r.unit.trim()) ? r.unit.trim() : '台';
        if (unit !== '台' && unit !== '件' && unit !== '箇所') { errors.push({ code: code, reason: 'UNIT_INVALID' }); return; }
        options.push({ code: code, name: (typeof r.name === 'string' && r.name.trim()) ? r.name.trim() : code, price: a, unit: unit, mins: toMins(r.mins) });
        return;
      }
      got[code] = a;
      if (code === 'UNIT_PRICE') unitMins = toMins(r.mins);
    });
    REQUIRED.forEach(function (c) { if (got[c] === undefined && !seen[c]) errors.push({ code: c, reason: 'MISSING' }); });
    if (got.UNIT_PRICE !== undefined && got.UNIT_PRICE <= 0) errors.push({ code: 'UNIT_PRICE', reason: 'MUST_BE_POSITIVE' });
    if (got.MIN_UNITS !== undefined && got.MAX_UNITS !== undefined && (got.MIN_UNITS < 1 || got.MIN_UNITS > got.MAX_UNITS)) errors.push({ code: 'MIN_UNITS', reason: 'RANGE_INVALID' });
    if (errors.length) return { ok: false, errors: errors };
    var extraFees = { travelFee: 0, parkingFee: 0 };
    Object.keys(FEE_CODES).forEach(function (c) { if (got[c] !== undefined) extraFees[FEE_CODES[c]] = got[c]; });
    return { ok: true, master: { unitPrice: got.UNIT_PRICE, unitMins: unitMins, minUnits: got.MIN_UNITS, maxUnits: got.MAX_UNITS, options: options, freeOptions: freeOptions, extraFees: extraFees }, ignored: ignored };
  }

  // 金額の計算（税込の価格を足すだけ）。input：{units, selections:{OPT_コード: 数}}。
  // 「台」のオプションは、台数以内の数（その機種に付く台数）。「件」のオプションは、0か1。
  function calc(input, master) {
    if (!master || typeof master !== 'object' || !Array.isArray(master.options)) return { ok: false, errorCode: 'MASTER_INVALID' };
    if (!input || typeof input !== 'object') return { ok: false, errorCode: 'INVALID_INPUT' };
    var u = input.units;
    if (typeof u !== 'number' || Math.floor(u) !== u || u < master.minUnits || u > master.maxUnits) return { ok: false, errorCode: 'UNITS_OUT_OF_RANGE' };
    var sel = input.selections === undefined ? {} : input.selections;
    if (!sel || typeof sel !== 'object' || Array.isArray(sel)) return { ok: false, errorCode: 'INVALID_INPUT' };
    var byCode = {}; master.options.forEach(function (o) { byCode[o.code] = o; });
    var lines = [{ code: 'UNIT_PRICE', label: 'エアコン脱着クリーニング', qty: u, unitPrice: master.unitPrice, amount: master.unitPrice * u }];
    var codes = Object.keys(sel);
    for (var i = 0; i < codes.length; i++) {
      var c = codes[i], n = sel[c], o = byCode[c];
      if (!o) return { ok: false, errorCode: 'UNKNOWN_OPTION', code: c };
      if (typeof n !== 'number' || Math.floor(n) !== n || n < 0) return { ok: false, errorCode: 'INVALID_INPUT', code: c };
      if (n === 0) continue;
      if (o.unit === '件' ? n > 1 : n > u) return { ok: false, errorCode: 'OPTION_COUNT_INVALID', code: c };
      lines.push({ code: c, label: o.name, qty: n, unitPrice: o.price, amount: o.price * n });
    }
    var fee = (master.extraFees && (master.extraFees.travelFee || 0) + (master.extraFees.parkingFee || 0)) || 0;
    var total = lines.reduce(function (s, l) { return s + l.amount; }, 0) + fee;
    return { ok: true, total: total, fee: fee, lines: lines };
  }

  // 2つの価格マスターの差（どこが食い違うか）。一致なら空の配列
  function diff(a, b) {
    var out = [];
    function walk(x, y, path) {
      if (x && typeof x === 'object' && y && typeof y === 'object') {
        var keys = {}; Object.keys(x).concat(Object.keys(y)).forEach(function (k) { keys[k] = 1; });
        Object.keys(keys).sort().forEach(function (k) { walk(x[k], y[k], path ? path + '.' + k : k); });
      } else if (x !== y) out.push({ path: path, a: x, b: y });
    }
    walk(a, b, '');
    return out;
  }

  // ---- 作業時間（分）：PMの計算式（2026-11-03）。工程ごとに「1台あたりの分×台数」。2台以上は、割引（1/3・1/6）を引く。移動は、台数に関わらず固定 ----
  //   1台：取り外し30＋移動30＋分解組立洗浄30＋移動30＋取付60＝180分
  //   n台（2以上）：取り外し 30n−30n×1/3（＝20n）＋移動30＋分解組立洗浄 30n−30n×1/6（＝25n）＋移動30＋取付 60n−60n×1/3（＝40n）＝ 85n＋60分
  var WORK_STEPS = [
    { name: '取り外し', perUnit: 30, off: [1, 3] },
    { name: '移動', fixed: 30 },
    { name: '分解組立洗浄', perUnit: 30, off: [1, 6] },
    { name: '移動', fixed: 30 },
    { name: '取付', perUnit: 60, off: [1, 3] }
  ];
  // units：台数（1以上の整数。そうでなければ0）。extraMins：オプションの所要時間の合計（料金マスタの所要時間(分)。未設定は0）
  function workMinutes(units, extraMins) {
    var n = units;
    if (typeof n !== 'number' || !isFinite(n) || n < 1 || Math.floor(n) !== n) return 0;
    var total = 0;
    WORK_STEPS.forEach(function (st) {
      if (st.fixed) { total += st.fixed; return; }
      var base = st.perUnit * n;
      total += (n >= 2) ? base - base * st.off[0] / st.off[1] : base;
    });
    var ex = (typeof extraMins === 'number' && isFinite(extraMins) && extraMins > 0) ? extraMins : 0;
    return Math.round(total + ex);
  }
  // 予約枠として押さえる時間（分）：1時間単位に切り上げる（予約の枠が、1時間単位のため）
  function blockMinutes(units, extraMins) { var m = workMinutes(units, extraMins); return Math.ceil(m / 60) * 60; }

  return { fromRows: fromRows, calc: calc, diff: diff, REQUIRED: REQUIRED, workMinutes: workMinutes, blockMinutes: blockMinutes, WORK_STEPS: WORK_STEPS };
})();
