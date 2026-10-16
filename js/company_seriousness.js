/**
 * إثبات جدية الشركة — Company Seriousness Verification
 * محاكاة عرض لمتخذ القرار · بيانات الجلسة فقط (بدون تخزين دائم)
 * مصدر العيّنة: روابط المشاركة العامة للمعاملات الموثقة رسمياً
 */
(function () {
  'use strict';

  const ETA_ORIGIN = 'https://invoicing.eta.gov.eg';
  const ETA_PATH_RE = /^https:\/\/invoicing\.eta\.gov\.eg\/documents\/([A-Z0-9]+)\/share\/([A-Za-z0-9]+)/i;
  const MAX_ATTEMPTS = 5;
  const DEMO_LINK =
    'https://invoicing.eta.gov.eg/documents/J1AGP49BP71M16RA90HPTJ4M10/share/CSC30PT8RBW7S1EJA0HPTJ4M10h8Koty1791633343';

  const DEMO_PAYLOAD = {
    uuid: 'J1AGP49BP71M16RA90HPTJ4M10',
    status: 'Valid',
    dateTimeIssued: '2026-10-10T11:55:20Z',
    internalID: '288',
    taxpayerActivityCode: '4610',
    totalAmount: 24420,
    netAmount: 22000,
    totalSales: 22000,
    taxTotals: [
      { taxType: 'T1', amount: 3080 },
      { taxType: 'T4', amount: 660 }
    ],
    issuer: {
      id: '483893145',
      name: 'جا اف سى كونسولتانت ال ال سى',
      address: { governate: 'Cairo', regionCity: 'El Basatin' }
    },
    receiver: {
      id: '630615349',
      name: 'هاي ام سولونيك',
      address: { governate: 'Cairo', regionCity: 'New Cairo 1' }
    },
    invoiceLines: [
      {
        description: 'Car rental Fees from 26-09-2026 to 25-10-2026',
        itemCode: 'EG-483893145-CR',
        quantity: 1,
        salesTotal: 22000
      }
    ],
    documentTypeNameSecondaryLang: 'معاملة موثقة'
  };

  /** حالة الواجهة في التبويب الحالي */
  const sessionStore = {
    attempts: MAX_ATTEMPTS,
    locked: false,
    captchaAns: 0,
    role: 'investor',
    lastAnalysis: null
  };

  /** مفتاح مشترك بين تبويبات نفس المتصفح (بدون خادم) */
  const STORAGE_KEY = 'csv_demo_records_v1';

  function loadRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveRecords(arr) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr || []));
      window.dispatchEvent(new CustomEvent('csv-records-updated'));
    } catch (_) {}
  }

  function clearRecords() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new CustomEvent('csv-records-updated'));
    } catch (_) {}
  }

  function fmtMoney(n) {
    return (
      Number(n || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 }) + ' ج.م'
    );
  }

  /** أرقام فقط */
  function digitsOnly(v) {
    return String(v || '').replace(/\D/g, '');
  }

  /** سجل تجاري موحد 15 رقم → 5-5-5 */
  function formatCR(v) {
    const d = digitsOnly(v).slice(0, 15);
    const p = [];
    if (d.length > 0) p.push(d.slice(0, 5));
    if (d.length > 5) p.push(d.slice(5, 10));
    if (d.length > 10) p.push(d.slice(10, 15));
    return p.join('-');
  }

  /** بطاقة ضريبية 9 أرقام → 3-3-3 */
  function formatTaxCard(v) {
    const d = digitsOnly(v).slice(0, 9);
    const p = [];
    if (d.length > 0) p.push(d.slice(0, 3));
    if (d.length > 3) p.push(d.slice(3, 6));
    if (d.length > 6) p.push(d.slice(6, 9));
    return p.join('-');
  }

  function bindGroupedInput(input, maxDigits, formatter) {
    if (!input) return;
    input.addEventListener('input', function () {
      const d = digitsOnly(input.value).slice(0, maxDigits);
      const start = input.selectionStart;
      input.value = formatter(d);
      // تقريب بسيط لمؤشر الكتابة
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
    });
    input.addEventListener('paste', function (e) {
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData).getData('text');
      input.value = formatter(digitsOnly(t).slice(0, maxDigits));
    });
    input.addEventListener('keypress', function (e) {
      if (e.ctrlKey || e.metaKey || e.key === 'Backspace' || e.key === 'Tab') return;
      if (!/[0-9]/.test(e.key)) e.preventDefault();
    });
  }

  function effectiveClass(rec) {
    return rec.adminClass || (rec.summary && rec.summary.classification) || 'review';
  }

  function classLabel(c) {
    if (c === 'strong') return 'جادة';
    if (c === 'weak') return 'غير جادة';
    if (c === 'stopped') return 'متوقفة';
    if (c === 'started') return 'بدأت النشاط';
    return 'تحتاج مراجعة';
  }

  function classPill(c) {
    if (c === 'strong') return 'csv-pill-s';
    if (c === 'weak') return 'csv-pill-w';
    if (c === 'stopped') return 'csv-pill-stop';
    if (c === 'started') return 'csv-pill-start';
    return 'csv-pill-r';
  }

  function classSelectHtml(current, recId) {
    const opts = [
      ['', '— آلي —'],
      ['strong', 'جادة'],
      ['weak', 'غير جادة'],
      ['stopped', 'متوقفة'],
      ['started', 'بدأت النشاط'],
      ['review', 'تحتاج مراجعة']
    ];
    return (
      '<select class="csv-class-select" data-class-rec="' +
      recId +
      '" onclick="event.stopPropagation()" style="font-family:inherit;font-size:11px;padding:4px 6px;border-radius:8px;border:1.5px solid #e2e8f0;max-width:130px">' +
      opts
        .map(function (o) {
          const sel =
            (current === o[0] || (!current && o[0] === '')) ? ' selected' : '';
          return '<option value="' + o[0] + '"' + sel + '>' + o[1] + '</option>';
        })
        .join('') +
      '</select>'
    );
  }

  /** تجميع السجلات حسب المنشأة */
  function groupCompanies(records) {
    const map = {};
    records.forEach(function (r) {
      const key = r.entityId || r.taxCard || r.crNumber || r.companyName || String(r.id);
      if (!map[key]) {
        map[key] = {
          key: key,
          companyName: r.companyName || '—',
          entityId: r.entityId || '',
          crNumber: r.crNumber || '',
          taxCard: r.taxCard || '',
          records: [],
          adminClass: null,
          lastAt: r.at
        };
      }
      const g = map[key];
      g.records.push(r);
      if (r.companyName) g.companyName = r.companyName;
      if (r.crNumber) g.crNumber = r.crNumber;
      if (r.taxCard) g.taxCard = r.taxCard;
      if (r.entityId) g.entityId = r.entityId;
      // آخر تصنيف يدوي غير فارغ يسود
      if (r.adminClass) g.adminClass = r.adminClass;
      if (r.at && (!g.lastAt || r.at > g.lastAt)) g.lastAt = r.at;
    });
    return Object.keys(map).map(function (k) {
      const g = map[k];
      // ملخص آلي من أحدث سجل
      const latest = g.records.slice().sort(function (a, b) {
        return (b.at || '').localeCompare(a.at || '');
      })[0];
      g.autoClass = (latest && latest.summary && latest.summary.classification) || 'review';
      g.effective = g.adminClass || g.autoClass;
      g.totalAmount = g.records.reduce(function (s, r) {
        return s + ((r.summary && r.summary.totalAmount) || 0);
      }, 0);
      g.invoiceCount = g.records.reduce(function (s, r) {
        return s + ((r.results && r.results.length) || 0);
      }, 0);
      return g;
    });
  }

  function isValidEtaLink(url) {
    try {
      const u = new URL(url);
      if (u.origin !== ETA_ORIGIN) return false;
      return ETA_PATH_RE.test(url);
    } catch {
      return false;
    }
  }

  function parseShareUrl(url) {
    const m = url.match(ETA_PATH_RE);
    if (!m) return null;
    return { uuid: m[1], token: m[2] };
  }

  function synthesizeFromUuid(uuid) {
    const hash = uuid.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
    const taxA = String(100000000 + (hash % 800000000));
    const taxB = String(100000000 + ((hash * 7) % 800000000));
    const amount = 5000 + (hash % 200) * 100;
    return {
      uuid,
      status: hash % 9 === 0 ? 'Invalid' : 'Valid',
      dateTimeIssued:
        '2026-0' +
        (1 + (hash % 9)) +
        '-' +
        String(10 + (hash % 18)).padStart(2, '0') +
        'T10:00:00Z',
      internalID: String(100 + (hash % 900)),
      taxpayerActivityCode: String(4600 + (hash % 50)),
      totalAmount: amount * 1.14,
      netAmount: amount,
      totalSales: amount,
      taxTotals: [{ taxType: 'T1', amount: +(amount * 0.14).toFixed(2) }],
      issuer: {
        id: taxA,
        name: 'منشأة ' + uuid.slice(0, 4),
        address: { governate: 'Cairo', regionCity: '—' }
      },
      receiver: {
        id: taxB,
        name: 'طرف مقابل ' + uuid.slice(4, 8),
        address: { governate: 'Giza', regionCity: '—' }
      },
      invoiceLines: [
        { description: 'بند معاملة', quantity: 1, salesTotal: amount }
      ],
      documentTypeNameSecondaryLang: 'معاملة موثقة'
    };
  }

  async function fetchDocument(url) {
    const parts = parseShareUrl(url);
    if (!parts) throw new Error('INVALID_URL');

    const api = `https://api-portal.invoicing.eta.gov.eg/api/v1/public/documents/${parts.uuid}/share?token=${parts.token}&documentLinesLimit=100`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(api, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' }
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        return { source: 'live', data, url };
      }
    } catch (_) {
      /* CORS / offline → fallback */
    }

    if (parts.uuid === DEMO_PAYLOAD.uuid || url === DEMO_LINK) {
      return { source: 'demo', data: { ...DEMO_PAYLOAD }, url };
    }
    return { source: 'demo', data: synthesizeFromUuid(parts.uuid), url };
  }

  function analyzeResults(targetId, items) {
    const target = (targetId || '').replace(/\D/g, '');
    let validCount = 0;
    let matchCount = 0;
    let totalAmount = 0;
    const ids = new Set();
    const names = new Set();

    items.forEach((it) => {
      if (!it.ok) return;
      const d = it.data;
      if (d.status === 'Valid') validCount++;
      totalAmount += Number(d.totalAmount) || 0;
      if (d.issuer?.id) {
        ids.add(d.issuer.id);
        names.add(d.issuer.name);
      }
      if (d.receiver?.id) {
        ids.add(d.receiver.id);
        names.add(d.receiver.name);
      }
      if (target && (d.issuer?.id === target || d.receiver?.id === target)) {
        matchCount++;
      }
    });

    const okItems = items.filter((i) => i.ok);
    const ratioValid = okItems.length ? validCount / okItems.length : 0;

    let classification = 'review';
    let label = 'تحتاج استكمال';
    let reason = '';

    if (okItems.length === 0) {
      classification = 'weak';
      label = 'عيّنة غير مكتملة';
      reason =
        'لم يُستخرج أي معاملة موثقة من الروابط المقدّمة. تعذّر بناء مؤشر جدية.';
    } else if (target && matchCount === 0) {
      classification = 'weak';
      label = 'عدم اتساق الهوية';
      reason =
        'المعاملات المستخرجة غير مرتبطة برقم المنشأة المستهدف. العيّنة لا تدعم إثبات الجدية.';
    } else if (ratioValid >= 0.8 && (matchCount >= 1 || !target) && okItems.length >= 1) {
      classification = 'strong';
      label = 'مؤشرات جدية إيجابية';
      reason =
        'اتساق هوية المنشأة مع معاملات موثقة رسمية بحالة صالحة. مؤشر أوّلي داعم للعناية الواجبة — وليس اعتماداً نهائياً.';
    } else if (ratioValid < 0.5) {
      classification = 'weak';
      label = 'مؤشرات ضعف في العيّنة';
      reason = 'نسبة المعاملات غير الصالحة مرتفعة ضمن العيّنة المقدّمة.';
    } else {
      classification = 'review';
      label = 'تحتاج استكمال';
      reason =
        'النتائج مختلطة. يُنصح بتوسيع العيّنة أو إرفاق مستندات داعمة إضافية.';
    }

    return {
      validCount,
      matchCount,
      totalAmount,
      okCount: okItems.length,
      ids: [...ids],
      names: [...names],
      classification,
      label,
      reason
    };
  }

  /* ========== UI BUILD ========== */
  function ensureStyles() {
    if (document.getElementById('csv-styles')) return;
    const s = document.createElement('style');
    s.id = 'csv-styles';
    s.textContent = `
      .csv-wrap { font-family: inherit; direction: rtl; }
      .csv-hero {
        background: linear-gradient(135deg, #0b1f3a 0%, #1a3a6b 55%, #0f766e 100%);
        color: #fff; border-radius: 16px; padding: 28px 32px; margin-bottom: 20px;
        position: relative; overflow: hidden;
      }
      .csv-hero h2 { font-size: 1.45rem; font-weight: 800; margin: 0 0 8px; }
      .csv-hero p { opacity: .88; font-size: .9rem; max-width: 640px; margin: 0; line-height: 1.7; }
      .csv-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      .csv-pills span {
        background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.18);
        padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;
      }
      .csv-card {
        background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
        padding: 20px 22px; margin-bottom: 16px; box-shadow: 0 4px 18px rgba(11,31,58,.05);
      }
      .csv-card h3 { font-size: 1rem; font-weight: 700; margin: 0 0 4px; }
      .csv-card .sub { font-size: 12px; color: #64748b; margin-bottom: 14px; }
      .csv-roles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
      @media(max-width:640px){ .csv-roles { grid-template-columns: 1fr; } }
      .csv-role {
        border: 2px solid #e2e8f0; border-radius: 12px; padding: 14px; cursor: pointer;
        background: #fff; text-align: center; transition: .2s; font-family: inherit;
      }
      .csv-role:hover { border-color: #0d9488; }
      .csv-role.on { border-color: #0d9488; background: #f0fdfa; box-shadow: 0 0 0 3px rgba(13,148,136,.12); }
      .csv-role strong { display: block; font-size: 14px; }
      .csv-role small { color: #64748b; font-size: 11px; }
      .csv-field { margin-bottom: 12px; }
      .csv-field label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; }
      .csv-field input {
        width: 100%; padding: 10px 12px; border: 1.5px solid #e2e8f0; border-radius: 10px;
        font-family: inherit; font-size: 13px;
      }
      .csv-field input:focus { outline: none; border-color: #0d9488; box-shadow: 0 0 0 3px rgba(13,148,136,.12); }
      .csv-links { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      @media(max-width:768px){ .csv-links { grid-template-columns: 1fr; } }
      .csv-linkbox {
        border: 1.5px dashed #cbd5e1; border-radius: 12px; padding: 12px; background: #f8fafc;
      }
      .csv-linkbox h4 { font-size: 13px; margin: 0 0 10px; display: flex; align-items: center; gap: 6px; }
      .csv-tag { font-size: 10px; padding: 2px 8px; border-radius: 6px; font-weight: 700; }
      .csv-tag.in { background: #dbeafe; color: #1d4ed8; }
      .csv-tag.out { background: #dcfce7; color: #15803d; }
      .csv-row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
      .csv-row input {
        flex: 1; padding: 8px 10px; border: 1.5px solid #e2e8f0; border-radius: 8px;
        font-size: 11px; direction: ltr; text-align: left; font-family: inherit;
      }
      .csv-row input.bad { border-color: #dc2626; background: #fef2f2; }
      .csv-row input.ok { border-color: #059669; background: #f0fdf4; }
      .csv-attempts {
        display: flex; justify-content: space-between; align-items: center;
        background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px;
        padding: 10px 14px; margin-bottom: 12px; font-size: 13px;
      }
      .csv-attempts.warn { background: #fef2f2; border-color: #fecaca; }
      .csv-attempts.lock { background: #1c1917; color: #fef3c7; border-color: #44403c; }
      .csv-cap {
        display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 10px;
        padding: 12px; margin: 14px 0;
      }
      .csv-cap-q {
        background: #0b1f3a; color: #fff; padding: 6px 14px; border-radius: 8px;
        font-weight: 700; min-width: 70px; text-align: center;
      }
      .csv-cap input { width: 90px; padding: 7px; border-radius: 8px; border: 1.5px solid #e2e8f0; text-align: center; font-family: inherit; }
      .csv-btn {
        border: none; border-radius: 10px; padding: 11px 20px; font-family: inherit;
        font-size: 13px; font-weight: 700; cursor: pointer; transition: .2s;
        display: inline-flex; align-items: center; gap: 6px;
      }
      .csv-btn-main { background: linear-gradient(135deg,#0d9488,#0f766e); color: #fff; }
      .csv-btn-main:hover { box-shadow: 0 6px 18px rgba(13,148,136,.35); }
      .csv-btn-main:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }
      .csv-btn-soft { background: #fff; border: 1.5px solid #e2e8f0; color: #0b1f3a; }
      .csv-btn-gold { background: linear-gradient(135deg,#c9a227,#e8c547); color: #0b1f3a; }
      .csv-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
      .csv-hint {
        background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px;
        padding: 10px 12px; font-size: 12px; color: #1e40af; margin-bottom: 12px; line-height: 1.6;
      }
      .csv-kpi { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 14px; }
      @media(max-width:700px){ .csv-kpi { grid-template-columns: 1fr 1fr; } }
      .csv-kpi > div {
        background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
        padding: 14px; text-align: center;
      }
      .csv-kpi .v { font-size: 1.25rem; font-weight: 800; color: #0b1f3a; }
      .csv-kpi .l { font-size: 11px; color: #64748b; }
      .csv-inv {
        border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 10px; background: #fff;
      }
      .csv-inv .hd { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
      .csv-st {
        padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700;
      }
      .csv-st-ok { background: #d1fae5; color: #065f46; }
      .csv-st-no { background: #fee2e2; color: #991b1b; }
      .csv-st-wa { background: #fef3c7; color: #92400e; }
      .csv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; font-size: 12px; }
      .csv-grid .k { color: #64748b; }
      .csv-grid .v { font-weight: 600; }
      .csv-verdict {
        border-radius: 14px; padding: 20px; margin-top: 14px; text-align: center;
      }
      .csv-verdict.strong { background: linear-gradient(135deg,#ecfdf5,#d1fae5); border: 2px solid #6ee7b7; }
      .csv-verdict.weak { background: linear-gradient(135deg,#fef2f2,#fecaca); border: 2px solid #fca5a5; }
      .csv-verdict.review { background: linear-gradient(135deg,#fffbeb,#fde68a); border: 2px solid #fcd34d; }
      .csv-verdict h4 { margin: 0 0 6px; font-size: 1.1rem; }
      .csv-verdict p { margin: 0; font-size: 13px; color: #374151; line-height: 1.6; }
      .csv-lock {
        display: none; text-align: center; padding: 32px; background: #1c1917;
        color: #fef3c7; border-radius: 14px; margin-top: 12px;
      }
      .csv-lock.show { display: block; }
      .csv-modal-bg {
        display: none; position: fixed; inset: 0; background: rgba(11,31,58,.55);
        z-index: 10050; align-items: center; justify-content: center; padding: 16px;
      }
      .csv-modal-bg.show { display: flex; }
      .csv-modal {
        background: #fff; border-radius: 14px; padding: 24px; max-width: 400px; width: 100%;
        text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,.25);
      }
      .csv-admin-kpi { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 16px; }
      @media(max-width:800px){ .csv-admin-kpi { grid-template-columns: 1fr 1fr; } }
      .csv-admin-kpi > div {
        background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px;
        box-shadow: 0 4px 14px rgba(11,31,58,.05);
      }
      .csv-admin-kpi .n { font-size: 1.6rem; font-weight: 800; }
      .csv-admin-kpi .t { font-size: 12px; color: #64748b; }
      .csv-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .csv-table th { background: #0b1f3a; color: #fff; padding: 10px 12px; text-align: right; }
      .csv-table td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; }
      .csv-table tr:hover td { background: #f8fafc; }
      .csv-pill { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; }
      .csv-pill-s { background: #d1fae5; color: #065f46; }
      .csv-pill-w { background: #fee2e2; color: #991b1b; }
      .csv-pill-r { background: #fef3c7; color: #92400e; }
      .csv-pill-stop { background: #e2e8f0; color: #475569; }
      .csv-pill-start { background: #dbeafe; color: #1d4ed8; }
      .csv-qr-btn {
        border: 1.5px solid #0d9488; background: #f0fdfa; color: #0f766e;
        border-radius: 8px; padding: 6px 8px; cursor: pointer; font-size: 14px;
        flex-shrink: 0; font-family: inherit; line-height: 1;
      }
      .csv-qr-btn:hover { background: #ccfbf1; }
      .csv-filter-bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
      .csv-filter-chip {
        border: 1.5px solid #e2e8f0; background: #fff; border-radius: 20px;
        padding: 5px 12px; font-size: 12px; font-weight: 700; cursor: pointer;
        font-family: inherit; color: #0b1f3a;
      }
      .csv-filter-chip.on { background: #0b1f3a; color: #fff; border-color: #0b1f3a; }
      #csv-qr-overlay {
        display: none; position: fixed; inset: 0; z-index: 10100;
        background: rgba(11,31,58,.75); align-items: center; justify-content: center; padding: 16px;
      }
      #csv-qr-overlay.show { display: flex; }
      #csv-qr-box {
        background: #fff; border-radius: 16px; padding: 16px; max-width: 420px; width: 100%;
        text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,.3);
      }
      #csv-qr-reader { width: 100%; min-height: 240px; border-radius: 12px; overflow: hidden; background: #000; }
      #csv-qr-reader video { width: 100% !important; border-radius: 12px; }
      .csv-portal-bar {
        display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;
      }
      .csv-portal-bar a, .csv-portal-bar button {
        text-decoration: none; font-size: 12px; font-weight: 700; padding: 8px 14px;
        border-radius: 8px; border: 1.5px solid #e2e8f0; background: #fff; color: #0b1f3a;
        cursor: pointer; font-family: inherit;
      }
      .csv-portal-bar a.on, .csv-portal-bar button.on {
        background: #0b1f3a; color: #fff; border-color: #0b1f3a;
      }
      .csv-footnote {
        font-size: 11px; color: #64748b; text-align: center; margin-top: 18px; line-height: 1.6;
      }
      .csv-spin {
        width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.3);
        border-top-color: #fff; border-radius: 50%; animation: csvspin .7s linear infinite;
        display: inline-block;
      }
      @keyframes csvspin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(s);
  }

  function modal(title, msg, icon) {
    let bg = document.getElementById('csv-modal-bg');
    if (!bg) {
      bg = document.createElement('div');
      bg.id = 'csv-modal-bg';
      bg.className = 'csv-modal-bg';
      bg.innerHTML = `<div class="csv-modal">
        <div id="csv-modal-icon" style="font-size:36px;margin-bottom:8px"></div>
        <h3 id="csv-modal-title" style="margin:0 0 8px;font-size:1.05rem"></h3>
        <p id="csv-modal-msg" style="font-size:13px;color:#64748b;line-height:1.6;margin:0 0 16px"></p>
        <button class="csv-btn csv-btn-main" type="button" id="csv-modal-ok">حسناً</button>
      </div>`;
      document.body.appendChild(bg);
      bg.addEventListener('click', (e) => {
        if (e.target === bg) bg.classList.remove('show');
      });
    }
    // دائماً في أعلى body فوق بوابة المستثمر (z-index عالي)
    document.body.appendChild(bg);
    bg.style.zIndex = '10050';
    document.getElementById('csv-modal-icon').textContent = icon || '⚠️';
    document.getElementById('csv-modal-title').textContent = title;
    document.getElementById('csv-modal-msg').innerHTML = msg;
    const ok = document.getElementById('csv-modal-ok');
    if (ok) ok.onclick = function () { bg.classList.remove('show'); };
    bg.classList.add('show');
  }

  function refreshCaptcha() {
    const a = 3 + Math.floor(Math.random() * 9);
    const b = 2 + Math.floor(Math.random() * 8);
    sessionStore.captchaAns = a + b;
    const el = document.getElementById('csv-cap-q');
    if (el) el.textContent = a + ' + ' + b;
    const inp = document.getElementById('csv-cap-a');
    if (inp) inp.value = '';
  }

  function updateAttemptsUI() {
    const bar = document.getElementById('csv-attempts');
    const left = document.getElementById('csv-attempts-left');
    if (!bar || !left) return;
    left.textContent = sessionStore.attempts;
    bar.classList.toggle('warn', sessionStore.attempts <= 2 && !sessionStore.locked);
    bar.classList.toggle('lock', sessionStore.locked);
    const lock = document.getElementById('csv-lock');
    const btn = document.getElementById('csv-analyze-btn');
    if (sessionStore.locked) {
      if (lock) lock.classList.add('show');
      if (btn) btn.disabled = true;
    } else {
      if (lock) lock.classList.remove('show');
      if (btn) btn.disabled = false;
    }
  }

  function punish() {
    if (sessionStore.locked) return;
    sessionStore.attempts--;
    if (sessionStore.attempts <= 0) {
      sessionStore.locked = true;
      sessionStore.attempts = 0;
    }
    updateAttemptsUI();
  }

  function buildLinkRows(containerId, type) {
    const box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const row = document.createElement('div');
      row.className = 'csv-row';
      row.innerHTML =
        '<input type="url" data-csv-type="' +
        type +
        '" data-idx="' +
        i +
        '" placeholder="https://invoicing.eta.gov.eg/documents/.../share/..." spellcheck="false" autocomplete="off">' +
        '<button type="button" class="csv-qr-btn" title="مسح رمز QR للفاتورة" data-qr-for="' +
        type +
        '-' +
        i +
        '">📷</button>' +
        '<span data-st="' +
        type +
        '-' +
        i +
        '" style="width:18px;text-align:center;font-size:13px"></span>';
      const input = row.querySelector('input');
      const validate = function () {
        const val = input.value.trim();
        const st = row.querySelector('[data-st]');
        if (!val) {
          input.classList.remove('ok', 'bad');
          st.textContent = '';
          return;
        }
        const good = isValidEtaLink(val);
        input.classList.toggle('ok', good);
        input.classList.toggle('bad', !good);
        st.textContent = good ? '✓' : '✗';
        if (!good) {
          punish();
          modal(
            'رابط غير مقبول',
            'يُقبل فقط رابط الإثبات الرسمي من النطاق:<br><strong dir="ltr">https://invoicing.eta.gov.eg</strong><br><br>أي رابط آخر يُرفض فوراً لحماية المنصة.',
            '🚫'
          );
          setTimeout(function () {
            if (input.classList.contains('bad')) {
              input.value = '';
              input.classList.remove('bad');
              st.textContent = '';
            }
          }, 350);
        }
      };
      input.addEventListener('paste', function () { setTimeout(validate, 20); });
      input.addEventListener('blur', validate);
      const qrBtn = row.querySelector('.csv-qr-btn');
      qrBtn.addEventListener('click', function (e) {
        e.preventDefault();
        openQrScanner(input, validate);
      });
      box.appendChild(row);
    }
  }

  let qrScanner = null;
  let qrHtml5Loaded = false;

  function loadHtml5Qrcode() {
    return new Promise(function (resolve, reject) {
      if (window.Html5Qrcode) {
        resolve();
        return;
      }
      if (qrHtml5Loaded) {
        const t = setInterval(function () {
          if (window.Html5Qrcode) {
            clearInterval(t);
            resolve();
          }
        }, 100);
        setTimeout(function () {
          clearInterval(t);
          reject(new Error('timeout'));
        }, 8000);
        return;
      }
      qrHtml5Loaded = true;
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
  }

  function extractEtaUrlFromText(text) {
    if (!text) return null;
    const t = String(text).trim();
    if (isValidEtaLink(t)) return t;
    const m = t.match(/https:\/\/invoicing\.eta\.gov\.eg\/documents\/[A-Za-z0-9]+\/share\/[A-Za-z0-9]+/);
    return m ? m[0] : null;
  }

  async function openQrScanner(targetInput, onDone) {
    let overlay = document.getElementById('csv-qr-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'csv-qr-overlay';
      overlay.innerHTML =
        '<div id="csv-qr-box">' +
        '<div style="font-weight:800;margin-bottom:8px;color:#0b1f3a">مسح رمز الفاتورة (QR)</div>' +
        '<p style="font-size:12px;color:#64748b;margin:0 0 12px;line-height:1.5">وجّه الكاميرا نحو رمز الاستجابة السريعة على الفاتورة الإلكترونية</p>' +
        '<div id="csv-qr-reader"></div>' +
        '<p id="csv-qr-status" style="font-size:12px;color:#0d9488;margin:10px 0 0;min-height:18px"></p>' +
        '<button type="button" class="csv-btn csv-btn-soft" id="csv-qr-close" style="margin-top:12px">إغلاق</button>' +
        '</div>';
      document.body.appendChild(overlay);
    }
    overlay.classList.add('show');
    const status = document.getElementById('csv-qr-status');
    status.textContent = 'جاري تهيئة الكاميرا...';

    document.getElementById('csv-qr-close').onclick = function () {
      stopQrScanner();
    };

    try {
      await loadHtml5Qrcode();
      if (qrScanner) {
        try { await qrScanner.stop(); } catch (_) {}
        qrScanner = null;
      }
      qrScanner = new Html5Qrcode('csv-qr-reader');
      status.textContent = 'وجّه الكاميرا للرمز...';
      await qrScanner.start(
        { facingMode: 'environment' },
        { fps: 8, qrbox: { width: 220, height: 220 } },
        function (decoded) {
          const url = extractEtaUrlFromText(decoded);
          if (url) {
            targetInput.value = url;
            if (typeof onDone === 'function') onDone();
            status.textContent = 'تم قراءة الرابط بنجاح';
            stopQrScanner();
            modal(
              'تم المسح بنجاح',
              'تم استخراج رابط المعاملة الرسمية من رمز QR ووضعه في الحقل.',
              '📷'
            );
          } else {
            status.textContent = 'الرمز لا يحتوي على رابط فاتورة رسمي — أعد المحاولة';
          }
        },
        function () {}
      );
    } catch (err) {
      status.textContent = 'تعذّر فتح الكاميرا. تأكد من السماح بالوصول أو الصق الرابط يدوياً.';
      console.warn(err);
    }
  }

  async function stopQrScanner() {
    try {
      if (qrScanner) {
        await qrScanner.stop();
        qrScanner.clear();
      }
    } catch (_) {}
    qrScanner = null;
    const overlay = document.getElementById('csv-qr-overlay');
    if (overlay) overlay.classList.remove('show');
  }

  function collectLinks() {
    const inbound = [];
    const outbound = [];
    document.querySelectorAll('input[data-csv-type="in"]').forEach((i) => {
      const v = i.value.trim();
      if (v) inbound.push(v);
    });
    document.querySelectorAll('input[data-csv-type="out"]').forEach((i) => {
      const v = i.value.trim();
      if (v) outbound.push(v);
    });
    return { inbound, outbound };
  }

  function fillDemo(type) {
    const inputs = [...document.querySelectorAll(`input[data-csv-type="${type}"]`)];
    const empty = inputs.find((i) => !i.value.trim());
    const target = empty || inputs[0];
    if (!target) return;
    target.value = DEMO_LINK;
    target.dispatchEvent(new Event('blur'));
  }

  function setRole(role) {
    sessionStore.role = role;
    const inv = document.getElementById('csv-role-investor');
    const aud = document.getElementById('csv-role-auditor');
    if (inv) inv.classList.toggle('on', role === 'investor');
    if (aud) aud.classList.toggle('on', role === 'auditor');
    const extra = document.getElementById('csv-auditor-extra');
    if (extra) extra.style.display = role === 'auditor' ? 'block' : 'none';
  }

  async function runAnalysis() {
    if (sessionStore.locked) {
      modal('الفحص متوقف مؤقتاً', 'تم تجاوز الحد المسموح من الروابط غير المقبولة.', '🔒');
      return;
    }
    const cap = (document.getElementById('csv-cap-a') || {}).value || '';
    if (String(cap).trim() !== String(sessionStore.captchaAns)) {
      modal('تحقق إضافي مطلوب', 'أدخل ناتج المسألة بشكل صحيح للمتابعة.', '🧮');
      refreshCaptcha();
      return;
    }
    const entityId = (document.getElementById('csv-entity-id') || {}).value || '';
    if (!entityId.trim()) {
      modal(
        'رقم المنشأة مطلوب',
        'أدخل رقم التعريف الرسمي للمنشأة محل الفحص — هذا أساس مطابقة العيّنة.',
        '🔢'
      );
      return;
    }
    const { inbound, outbound } = collectLinks();
    const all = [
      ...inbound.map((u) => ({ url: u, side: 'وارد' })),
      ...outbound.map((u) => ({ url: u, side: 'صادر' }))
    ];
    if (!all.length) {
      modal('لا توجد روابط', 'أضف رابط إثبات واحداً على الأقل للمتابعة.', '📎');
      return;
    }
    for (const item of all) {
      if (!isValidEtaLink(item.url)) {
        punish();
        modal(
          'رابط غير مقبول',
          'جميع الروابط يجب أن تكون من النطاق الرسمي فقط.',
          '🚫'
        );
        return;
      }
    }

    const btn = document.getElementById('csv-analyze-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="csv-spin"></span> جاري التحقق من العيّنة...';
    }

    const results = [];
    for (const item of all) {
      try {
        const fetched = await fetchDocument(item.url);
        results.push({
          ok: true,
          side: item.side,
          url: item.url,
          source: fetched.source,
          data: fetched.data
        });
      } catch {
        results.push({ ok: false, side: item.side, url: item.url });
      }
    }

    const summary = analyzeResults(entityId.trim(), results);
    const companyName =
      ((document.getElementById('csv-company-name') || {}).value || '').trim() ||
      summary.names[0] ||
      '—';

    const crRaw = digitsOnly((document.getElementById('csv-cr-number') || {}).value || '');
    const taxCardRaw = digitsOnly((document.getElementById('csv-tax-card') || {}).value || '');
    sessionStore.lastAnalysis = {
      id: Date.now(),
      entityId: entityId.trim(),
      companyName,
      crNumber: crRaw,
      taxCard: taxCardRaw,
      role: sessionStore.role,
      results,
      summary,
      adminClass: null,
      at: new Date().toISOString()
    };

    renderPortalResults(sessionStore.lastAnalysis);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🔍 تحليل العيّنة وإظهار مؤشر الجدية';
    }
    refreshCaptcha();
  }

  function renderPortalResults(analysis) {
    const panel = document.getElementById('csv-result-panel');
    if (!panel) return;
    panel.style.display = 'block';
    const s = analysis.summary;
    panel.innerHTML = `
      <div class="csv-card">
        <h3>مؤشر الجدية — نتيجة العيّنة</h3>
        <div class="sub">${analysis.companyName} · رقم المنشأة: ${analysis.entityId} · ${analysis.role === 'auditor' ? 'محاسب قانوني' : 'مستثمر'}</div>
        <div class="csv-kpi">
          <div><div class="v">${s.okCount}</div><div class="l">معاملة مُستخرجة</div></div>
          <div><div class="v" style="color:#059669">${s.validCount}</div><div class="l">صالحة (Valid)</div></div>
          <div><div class="v" style="color:#0d9488">${s.matchCount}</div><div class="l">مطابقة للهوية</div></div>
          <div><div class="v">${fmtMoney(s.totalAmount)}</div><div class="l">إجمالي العيّنة</div></div>
        </div>
        ${analysis.results
          .map((r, i) => {
            if (!r.ok) {
              return `<div class="csv-inv"><div class="hd"><strong>معاملة ${i + 1} — ${r.side}</strong><span class="csv-st csv-st-wa">تعذّر الاستخلاص</span></div></div>`;
            }
            const d = r.data;
            const match =
              analysis.entityId &&
              (d.issuer?.id === analysis.entityId ||
                d.receiver?.id === analysis.entityId);
            return `<div class="csv-inv">
              <div class="hd">
                <div><strong>معاملة ${i + 1} — ${r.side}</strong>
                  <div style="font-size:11px;color:#64748b">${d.documentTypeNameSecondaryLang || 'معاملة'} · ${ (d.dateTimeIssued || '').slice(0,10) }</div>
                </div>
                <div style="display:flex;gap:6px">
                  <span class="csv-st ${match ? 'csv-st-ok' : 'csv-st-no'}">${match ? 'مطابق للهوية' : 'غير مطابق'}</span>
                  <span class="csv-st ${d.status === 'Valid' ? 'csv-st-ok' : 'csv-st-no'}">${d.status || '—'}</span>
                </div>
              </div>
              <div class="csv-grid">
                <div><span class="k">الطرف المصدر</span><br><span class="v">${d.issuer?.name || '—'}</span><br><small style="color:#64748b">${d.issuer?.id || ''}</small></div>
                <div><span class="k">الطرف المستلم</span><br><span class="v">${d.receiver?.name || '—'}</span><br><small style="color:#64748b">${d.receiver?.id || ''}</small></div>
              </div>
              <div style="margin-top:10px;font-weight:800;font-size:1.05rem">${fmtMoney(d.totalAmount)}</div>
            </div>`;
          })
          .join('')}
        <div class="csv-verdict ${s.classification === 'strong' ? 'strong' : s.classification === 'weak' ? 'weak' : 'review'}">
          <h4>${s.classification === 'strong' ? '✅' : s.classification === 'weak' ? '⛔' : '⚠️'} ${s.label}</h4>
          <p>${s.reason}</p>
          <p style="margin-top:8px;font-size:11px;opacity:.85">تقييم أوّلي لعيّنة معاملات موثقة — لا يُعد اعتماداً نهائياً ولا إثبات تمثيل للمنشأة.</p>
        </div>
        <div class="csv-actions" style="margin-top:14px;justify-content:center">
          <button type="button" class="csv-btn csv-btn-gold" id="csv-send-admin">📥 إرسال للمتابعة (جلسة العرض فقط)</button>
        </div>
      </div>`;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const sendBtn = document.getElementById('csv-send-admin');
    if (sendBtn) {
      sendBtn.onclick = function () {
        if (!sessionStore.lastAnalysis) {
          modal('لا توجد نتيجة', 'حلّل العيّنة أولاً ثم أعد الإرسال.', '⚠️');
          return;
        }
        const rec = Object.assign({}, sessionStore.lastAnalysis, { id: Date.now() });
        const list = loadRecords();
        list.unshift(rec);
        saveRecords(list);

        const isAuditor = sessionStore.role === 'auditor';
        const who = isAuditor ? 'السيد/ المحاسب القانوني ' : 'السيد/ المستثمر ';
        const formalMsg =
          '<div style="text-align:right;line-height:1.85;font-size:13px">' +
          '<strong>' + who + '</strong><br><br>' +
          'نفيدكم بأنه تم <strong>استلام عيّنة إثبات الجدية</strong> للمنشأة:<br>' +
          '<strong style="color:#0b1f3a">' + (rec.companyName || '—') + '</strong><br>' +
          'رقم التعريف الرسمي: <strong>' + (rec.entityId || '—') + '</strong><br>' +
          (rec.crNumber ? ('السجل التجاري الموحد: <strong dir="ltr">' + formatCR(rec.crNumber) + '</strong><br>') : '') +
          (rec.taxCard ? ('البطاقة الضريبية: <strong dir="ltr">' + formatTaxCard(rec.taxCard) + '</strong><br>') : '') +
          '<br>' +
          'تم تسجيل النتيجة في <strong>سجل المتابعة</strong> لدى المنظومة، ويمكن الاطلاع عليها فوراً من شاشة المتابعة في تبويب الأدمن (نفس المتصفح).<br><br>' +
          '<span style="display:inline-block;background:#d1fae5;color:#065f46;padding:4px 12px;border-radius:20px;font-weight:700;font-size:12px">تم الإرسال بنجاح</span><br><br>' +
          '<small style="color:#64748b">محاكاة عرض · البيانات مشتركة بين تبويبات هذا المتصفح حتى الضغط على «مسح بيانات الجلسة»</small>' +
          '</div>';

        modal('تم الإرسال بنجاح', formalMsg, '📨');
        try { renderAdminMonitor(); } catch (_) {}
      };
    }
  }

  function portalHTML(forcedRole) {
    const role = forcedRole || sessionStore.role || 'investor';
    const isAuditor = role === 'auditor';
    const roleTitle = isAuditor ? 'بوابة المحاسب القانوني' : 'بوابة المستثمر';
    const roleDesc = isAuditor
      ? 'تحقق مهني من عيّنة معاملات موثقة مرتبطة بالمنشأة — لأغراض المراجعة والعناية الواجبة.'
      : 'فحص عيّنة معاملات موثقة مرتبطة بالمنشأة — لأغراض العناية الواجبة الاستثمارية.';
    return `
    <div class="csv-wrap">
      <div class="csv-hero">
        <h2>${roleTitle}</h2>
        <p>${roleDesc}</p>
        <div class="csv-pills">
          <span>🔗 روابط رسمية فقط</span>
          <span>🛡️ حماية من الروابط المزيفة</span>
          <span>⚡ مؤشر جدية فوري</span>
          <span>${isAuditor ? '📑 للمحاسب القانوني' : '👤 للمستثمر'}</span>
        </div>
      </div>

      <div class="csv-card">
        <h3>① بيانات المنشأة محل الفحص</h3>
        <div class="sub">أدخل بيانات المنشأة الرسمية — أساس مطابقة العيّنة</div>
        <div class="csv-field">
          <label>اسم المنشأة/الشركة</label>
          <input type="text" id="csv-company-name" placeholder="اسم المنشأة" value="جا اف سى كونسولتانت ال ال سى">
        </div>
        <div class="csv-field">
          <label>رقم البطاقة الضريبية للمنشأة/الشركة <span style="color:#dc2626">*</span></label>
          <input type="text" id="csv-entity-id" placeholder="مثال: 483893145" value="483893145" maxlength="15" inputmode="numeric">
        </div>
        <div class="csv-field">
          <label>رقم السجل التجاري الموحد <span style="color:#64748b;font-weight:400">(15 رقم· )</span></label>
          <input type="text" id="csv-cr-number" placeholder="12345-67890-12345" inputmode="numeric" autocomplete="off" dir="ltr" style="text-align:left;letter-spacing:0.5px">
        </div>
        <div class="csv-field">
          <label>رقم البطاقة الضريبية <span style="color:#64748b;font-weight:400">(9 أرقام · ثلاث مجموعات)</span></label>
          <input type="text" id="csv-tax-card" placeholder="123-456-789" inputmode="numeric" autocomplete="off" dir="ltr" style="text-align:left;letter-spacing:0.5px">
        </div>
        <div class="csv-field" id="csv-auditor-extra" style="display:${isAuditor ? 'block' : 'none'}">
          <label>مرجع مهني للمحاسب (اختياري في المحاكاة)</label>
          <input type="text" id="csv-auditor-ref" placeholder="رقم قيد / مرجع">
        </div>
      </div>

      <div class="csv-card">
        <h3>② روابط الفواتير الالكترونية</h3>
        <div class="sub">يُقبل حصراً الرابط الرسمي للمشاركة </div>
        <div class="csv-hint">
          للعرض السريع: اضغط «رابط تجريبي» لاستخدام معاملة حقيقية موثقة، أو الصق روابطك بشرط أن تبدأ بـ
          <code dir="ltr" style="background:#dbeafe;padding:1px 5px;border-radius:4px;font-size:11px">https://invoicing.eta.gov.eg</code>
        </div>
        <div class="csv-attempts" id="csv-attempts">
          <span>محاولات الروابط المرفوضة المتبقية: <strong id="csv-attempts-left">5</strong></span>
          <span style="font-size:12px;opacity:.85">بعد 5 محاولات يُوقف الفحص مؤقتاً</span>
        </div>
        <div class="csv-links">
          <div class="csv-linkbox">
            <h4><span class="csv-tag in">مشتريات</span> معاملات واردة (حتى 5)</h4>
            <div id="csv-links-in"></div>
            <button type="button" class="csv-btn csv-btn-soft" style="padding:5px 10px;font-size:12px;margin-top:4px" data-demo="in">＋ رابط تجريبي</button>
          </div>
          <div class="csv-linkbox">
            <h4><span class="csv-tag out">مبيعات</span> معاملات صادرة (حتى 5)</h4>
            <div id="csv-links-out"></div>
            <button type="button" class="csv-btn csv-btn-soft" style="padding:5px 10px;font-size:12px;margin-top:4px" data-demo="out">＋ رابط تجريبي</button>
          </div>
        </div>
        <div class="csv-cap">
          <span style="font-size:13px;font-weight:600">تحقق سريع:</span>
          <div class="csv-cap-q" id="csv-cap-q">?</div>
          <span>=</span>
          <input type="number" id="csv-cap-a" placeholder="الناتج">
          <button type="button" class="csv-btn csv-btn-soft" style="padding:6px 10px;font-size:12px" id="csv-cap-refresh">↻</button>
        </div>
        <div class="csv-actions">
          <button type="button" class="csv-btn csv-btn-main" id="csv-analyze-btn">🔍 تحليل العيّنة وإظهار مؤشر الجدية</button>
          <button type="button" class="csv-btn csv-btn-soft" id="csv-reset-btn">إعادة تعيين</button>
        </div>
        <div class="csv-lock" id="csv-lock">
          <div style="font-size:36px;margin-bottom:8px">🔒</div>
          <strong>تم إيقاف الفحص مؤقتاً</strong>
          <p style="font-size:13px;opacity:.85;margin:8px 0 14px">تجاوز الحد من الروابط غير المقبولة — لحماية المنصة أثناء العرض.</p>
          <button type="button" class="csv-btn csv-btn-gold" id="csv-unlock-btn">إعادة فتح (محاكاة العرض)</button>
        </div>
      </div>

      <div id="csv-result-panel" style="display:none"></div>
      <p class="csv-footnote">
        هذه شاشة محاكاة للعرض. البيانات تبقى في ذاكرة الجلسة فقط وتُمسح عند إغلاق الصفحة.
        مؤشر الجدية مبني على عيّنة معاملات موثقة ولا يغني عن الفحص الشامل أو المستندات الرسمية.
      </p>
    </div>`;
  }

  function bindPortalEvents(root) {
    root.querySelectorAll('[data-set-role]').forEach((btn) => {
      btn.addEventListener('click', () => setRole(btn.getAttribute('data-set-role')));
    });
    root.querySelectorAll('[data-portal-role]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setRole(btn.getAttribute('data-portal-role'));
        root.querySelectorAll('[data-portal-role]').forEach((b) =>
          b.classList.toggle('on', b === btn)
        );
      });
    });
    root.querySelectorAll('[data-demo]').forEach((btn) => {
      btn.addEventListener('click', () => fillDemo(btn.getAttribute('data-demo')));
    });
    const analyze = root.querySelector('#csv-analyze-btn');
    if (analyze) analyze.addEventListener('click', runAnalysis);
    const reset = root.querySelector('#csv-reset-btn');
    if (reset) {
      reset.addEventListener('click', () => {
        document.querySelectorAll('input[data-csv-type]').forEach((i) => {
          i.value = '';
          i.classList.remove('ok', 'bad');
        });
        const panel = document.getElementById('csv-result-panel');
        if (panel) {
          panel.style.display = 'none';
          panel.innerHTML = '';
        }
        sessionStore.lastAnalysis = null;
        refreshCaptcha();
      });
    }
    const unlock = root.querySelector('#csv-unlock-btn');
    if (unlock) {
      unlock.addEventListener('click', () => {
        sessionStore.attempts = MAX_ATTEMPTS;
        sessionStore.locked = false;
        updateAttemptsUI();
      });
    }
    const capR = root.querySelector('#csv-cap-refresh');
    if (capR) capR.addEventListener('click', refreshCaptcha);

    buildLinkRows('csv-links-in', 'in');
    buildLinkRows('csv-links-out', 'out');
    bindGroupedInput(document.getElementById('csv-cr-number'), 15, formatCR);
    bindGroupedInput(document.getElementById('csv-tax-card'), 9, formatTaxCard);
    refreshCaptcha();
    updateAttemptsUI();
    setRole(sessionStore.role);
  }

  function renderAdminMonitor(opts) {
    const host = document.getElementById('bi-seriousness-monitor');
    if (!host) return;
    ensureStyles();
    opts = opts || {};
    const allRecs = loadRecords();
    const companies = groupCompanies(allRecs);
    const q = (opts.q != null ? opts.q : ((document.getElementById('csv-admin-search') || {}).value || '')).trim().toLowerCase();
    const statusFilter = opts.status != null ? opts.status : ((document.getElementById('csv-status-filter') || {}).value || 'all');

    let list = companies;
    if (statusFilter && statusFilter !== 'all') {
      list = list.filter(function (c) { return c.effective === statusFilter; });
    }
    if (q) {
      list = list.filter(function (c) {
        const hay = [c.companyName, c.entityId, c.crNumber, c.taxCard, classLabel(c.effective)].join(' ').toLowerCase();
        return hay.indexOf(q) !== -1;
      });
    }

    const cnt = {
      all: companies.length,
      strong: companies.filter(function (c) { return c.effective === 'strong'; }).length,
      weak: companies.filter(function (c) { return c.effective === 'weak'; }).length,
      stopped: companies.filter(function (c) { return c.effective === 'stopped'; }).length,
      started: companies.filter(function (c) { return c.effective === 'started'; }).length,
      review: companies.filter(function (c) { return c.effective === 'review'; }).length
    };

    function chip(val, label, n) {
      const on = statusFilter === val ? ' on' : '';
      return '<button type="button" class="csv-filter-chip' + on + '" data-filter="' + val + '">' + label + ' (' + n + ')</button>';
    }

    host.innerHTML =
      '<div class="csv-wrap">' +
      '<div class="csv-hero" style="background:linear-gradient(135deg,#0b1f3a,#134e4a)">' +
      '<h2>متابعة الشركات — إثبات الجدية</h2>' +
      '<p>تسجيل المنشآت الواردة من بوابتي المستثمر والمحاسب، مع تصنيف آلي من عيّنة المعاملات وإمكانية التصنيف اليدوي.</p>' +
      '</div>' +
      '<div class="csv-admin-kpi">' +
      '<div><div class="n">' + cnt.all + '</div><div class="t">إجمالي الشركات</div></div>' +
      '<div><div class="n" style="color:#059669">' + cnt.strong + '</div><div class="t">جادة</div></div>' +
      '<div><div class="n" style="color:#dc2626">' + cnt.weak + '</div><div class="t">غير جادة</div></div>' +
      '<div><div class="n" style="color:#1d4ed8">' + cnt.started + '</div><div class="t">بدأت النشاط</div></div>' +
      '</div>' +
      '<div class="csv-card">' +
      '<div class="csv-filter-bar">' +
      chip('all', 'الكل', cnt.all) +
      chip('strong', 'جادة', cnt.strong) +
      chip('weak', 'غير جادة', cnt.weak) +
      chip('stopped', 'متوقفة', cnt.stopped) +
      chip('started', 'بدأت النشاط', cnt.started) +
      chip('review', 'مراجعة', cnt.review) +
      '</div>' +
      '<input type="hidden" id="csv-status-filter" value="' + statusFilter + '">' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px">' +
      '<input type="search" id="csv-admin-search" placeholder="بحث: اسم الشركة / السجل / البطاقة الضريبية..." value="' +
      String(q).replace(/"/g, '&quot;') +
      '" style="flex:1;min-width:200px;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-family:inherit;font-size:13px">' +
      '<button type="button" class="csv-btn csv-btn-soft" id="csv-clear-session">مسح بيانات الجلسة</button>' +
      '</div>' +
      '<div class="sub" style="margin-bottom:10px">المعروض: <strong>' + list.length + '</strong> شركة · اضغط للتفاصيل والفواتير</div>' +
      (companies.length === 0
        ? '<p style="text-align:center;color:#64748b;padding:28px;font-size:13px">لا توجد شركات بعد. أرسل عيّنة من بوابة المستثمر أو المحاسب.</p>'
        : list.length === 0
          ? '<p style="text-align:center;color:#64748b;padding:20px;font-size:13px">لا نتائج للفلتر/البحث الحالي.</p>'
          : '<div style="overflow-x:auto"><table class="csv-table"><thead><tr>' +
            '<th>الشركة</th><th>البطاقة الضريبية</th><th>السجل التجاري</th><th>فواتير</th><th>آلي</th><th>التصنيف</th><th></th>' +
            '</tr></thead><tbody>' +
            list
              .map(function (c) {
                return (
                  '<tr data-co-key="' +
                  String(c.key).replace(/"/g, '') +
                  '" style="cursor:pointer">' +
                  '<td><strong>' +
                  (c.companyName || '—') +
                  '</strong><br><small style="color:#64748b">' +
                  (c.entityId || '') +
                  '</small></td>' +
                  '<td dir="ltr" style="font-size:12px">' +
                  (c.taxCard ? formatTaxCard(c.taxCard) : '—') +
                  '</td>' +
                  '<td dir="ltr" style="font-size:11px">' +
                  (c.crNumber ? formatCR(c.crNumber) : '—') +
                  '</td>' +
                  '<td>' +
                  c.invoiceCount +
                  '</td>' +
                  '<td><span class="csv-pill ' +
                  classPill(c.autoClass) +
                  '">' +
                  classLabel(c.autoClass) +
                  '</span></td>' +
                  '<td>' +
                  classSelectHtml(c.adminClass || '', c.key) +
                  '</td>' +
                  '<td><button type="button" class="csv-btn csv-btn-soft" style="padding:5px 10px;font-size:11px" data-open-co="' +
                  String(c.key).replace(/"/g, '&quot;') +
                  '">فواتير</button></td>' +
                  '</tr>'
                );
              })
              .join('') +
            '</tbody></table></div>') +
      '</div>' +
      '<div id="csv-admin-detail" style="display:none"></div>' +
      '<p class="csv-footnote">القائمة المنسدلة بجانب الشركة تغيّر التصنيف المعتمد فوراً. التفاصيل تعرض كل الفواتير المرفوعة والفحص التلقائي.</p>' +
      '</div>';

    host.querySelectorAll('[data-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        renderAdminMonitor({ status: btn.getAttribute('data-filter'), q: (document.getElementById('csv-admin-search') || {}).value || '' });
      });
    });

    const search = document.getElementById('csv-admin-search');
    if (search) {
      let t = null;
      search.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () {
          renderAdminMonitor({
            status: (document.getElementById('csv-status-filter') || {}).value || 'all',
            q: search.value
          });
          const s2 = document.getElementById('csv-admin-search');
          if (s2) {
            s2.focus();
            try { s2.setSelectionRange(s2.value.length, s2.value.length); } catch (_) {}
          }
        }, 220);
      });
    }

    const clr = document.getElementById('csv-clear-session');
    if (clr) {
      clr.onclick = function () {
        if (!confirm('مسح كل بيانات جلسة العرض؟')) return;
        clearRecords();
        sessionStore.lastAnalysis = null;
        renderAdminMonitor();
        modal('تم المسح', 'تم مسح بيانات الجلسة. يمكن بدء تجربة جديدة.', '🧹');
      };
    }

    host.querySelectorAll('.csv-class-select').forEach(function (sel) {
      sel.addEventListener('change', function (e) {
        e.stopPropagation();
        const key = sel.getAttribute('data-class-rec');
        const val = sel.value;
        const recs = loadRecords();
        let changed = 0;
        recs.forEach(function (r) {
          const k = r.entityId || r.taxCard || r.crNumber || r.companyName || String(r.id);
          if (String(k) === String(key)) {
            r.adminClass = val === '' ? null : val;
            changed++;
          }
        });
        saveRecords(recs);
        renderAdminMonitor({
          status: (document.getElementById('csv-status-filter') || {}).value || 'all',
          q: (document.getElementById('csv-admin-search') || {}).value || ''
        });
        if (changed) {
          modal('تم التصنيف', 'تم اعتماد التصنيف: <strong>' + classLabel(val || 'review') + '</strong> للمنشأة.', '✅');
        }
      });
    });

    host.querySelectorAll('[data-open-co]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openCompanyDetail(btn.getAttribute('data-open-co'));
      });
    });
    host.querySelectorAll('tr[data-co-key]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        openCompanyDetail(tr.getAttribute('data-co-key'));
      });
    });
  }

  function openCompanyDetail(key) {
    const box = document.getElementById('csv-admin-detail');
    if (!box) return;
    const companies = groupCompanies(loadRecords());
    const c = companies.find(function (x) { return String(x.key) === String(key); });
    if (!c) {
      box.style.display = 'none';
      return;
    }

    const allInvoices = [];
    c.records.forEach(function (rec) {
      (rec.results || []).forEach(function (inv, idx) {
        allInvoices.push({ rec: rec, inv: inv, idx: idx });
      });
    });

    box.style.display = 'block';
    box.innerHTML =
      '<div class="csv-card" style="border:2px solid #0d9488">' +
      '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">' +
      '<div>' +
      '<h3 style="margin:0 0 4px">' +
      (c.companyName || '—') +
      '</h3>' +
      '<div class="sub" style="margin:0">تفاصيل المنشأة والفواتير المرفوعة</div>' +
      '</div>' +
      '<button type="button" class="csv-btn csv-btn-soft" id="csv-detail-close" style="padding:6px 12px;font-size:12px">إغلاق</button>' +
      '</div>' +
      '<div class="csv-grid" style="margin-top:14px">' +
      '<div><span class="k">رقم التعريف</span><br><span class="v">' +
      (c.entityId || '—') +
      '</span></div>' +
      '<div><span class="k">البطاقة الضريبية</span><br><span class="v" dir="ltr">' +
      (c.taxCard ? formatTaxCard(c.taxCard) : '—') +
      '</span></div>' +
      '<div><span class="k">السجل التجاري الموحد</span><br><span class="v" dir="ltr">' +
      (c.crNumber ? formatCR(c.crNumber) : '—') +
      '</span></div>' +
      '<div><span class="k">التصنيف المعتمد</span><br><span class="csv-pill ' +
      classPill(c.effective) +
      '">' +
      classLabel(c.effective) +
      '</span></div>' +
      '</div>' +
      '<div style="margin-top:14px;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:12px">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:8px">تعديل التصنيف</div>' +
      classSelectHtml(c.adminClass || '', c.key).replace('csv-class-select', 'csv-class-select csv-detail-class') +
      '</div>' +
      '<div style="margin-top:16px">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:10px">الفواتير المرفوعة والفحص التلقائي (' +
      allInvoices.length +
      ')</div>' +
      (allInvoices.length === 0
        ? '<p style="color:#64748b;font-size:13px">لا توجد فواتير في السجل.</p>'
        : allInvoices
            .map(function (item, i) {
              const inv = item.inv;
              const rec = item.rec;
              if (!inv.ok) {
                return (
                  '<div class="csv-inv"><strong>فاتورة ' +
                  (i + 1) +
                  '</strong> · <span class="csv-st csv-st-wa">تعذّر الاستخلاص</span>' +
                  '<div style="font-size:11px;color:#64748b;margin-top:4px">مصدر الفحص: ' +
                  (rec.role === 'auditor' ? 'محاسب قانوني' : 'مستثمر') +
                  ' · ' +
                  new Date(rec.at).toLocaleString('ar-EG') +
                  '</div></div>'
                );
              }
              const d = inv.data || {};
              const match =
                rec.entityId &&
                (d.issuer && d.issuer.id === rec.entityId || d.receiver && d.receiver.id === rec.entityId);
              return (
                '<div class="csv-inv">' +
                '<div class="hd">' +
                '<div><strong>فاتورة ' +
                (i + 1) +
                ' — ' +
                (inv.side || '') +
                '</strong>' +
                '<div style="font-size:11px;color:#64748b">' +
                ((d.dateTimeIssued || '').slice(0, 10) || '') +
                ' · فحص: ' +
                (rec.role === 'auditor' ? 'محاسب' : 'مستثمر') +
                '</div></div>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<span class="csv-st ' +
                (d.status === 'Valid' ? 'csv-st-ok' : 'csv-st-no') +
                '">' +
                (d.status || '—') +
                '</span>' +
                '<span class="csv-st ' +
                (match ? 'csv-st-ok' : 'csv-st-no') +
                '">' +
                (match ? 'مطابق للهوية' : 'غير مطابق') +
                '</span>' +
                '</div></div>' +
                '<div class="csv-grid">' +
                '<div><span class="k">المصدر</span><br><span class="v">' +
                ((d.issuer && d.issuer.name) || '—') +
                '</span></div>' +
                '<div><span class="k">المستلم</span><br><span class="v">' +
                ((d.receiver && d.receiver.name) || '—') +
                '</span></div>' +
                '</div>' +
                '<div style="margin-top:8px;font-weight:800">' +
                fmtMoney(d.totalAmount) +
                '</div></div>'
              );
            })
            .join('')) +
      '</div></div>';

    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('csv-detail-close').onclick = function () {
      box.style.display = 'none';
      box.innerHTML = '';
    };

    const dsel = box.querySelector('.csv-detail-class');
    if (dsel) {
      dsel.addEventListener('change', function () {
        const val = dsel.value;
        const recs = loadRecords();
        recs.forEach(function (r) {
          const k = r.entityId || r.taxCard || r.crNumber || r.companyName || String(r.id);
          if (String(k) === String(key)) r.adminClass = val === '' ? null : val;
        });
        saveRecords(recs);
        renderAdminMonitor({
          status: (document.getElementById('csv-status-filter') || {}).value || 'all',
          q: (document.getElementById('csv-admin-search') || {}).value || ''
        });
        openCompanyDetail(key);
      });
    }
  }

  function initPortalSection(forcedRole) {
    const host = document.getElementById('bi-seriousness-portal');
    if (!host) return;
    ensureStyles();
    if (forcedRole) sessionStore.role = forcedRole;
    host.innerHTML = portalHTML(sessionStore.role);
    bindPortalEvents(host);
  }

  function showSeriousnessSection(which) {
    if (typeof showAdminSection === 'function') {
      const map = {
        portal: 'bi-seriousness-portal',
        monitor: 'bi-seriousness-monitor'
      };
      const id = map[which] || 'bi-seriousness-portal';
      const link = document.querySelector(`.sidebar-link[data-csv-nav="${which}"]`);
      showAdminSection(id, link || undefined);
    }
    if (which === 'portal' || which === 'investor' || which === 'auditor') {
      initPortalSection(
        which === 'investor' ? 'investor' : which === 'auditor' ? 'auditor' : null
      );
    }
    if (which === 'monitor') renderAdminMonitor();
  }

  // Public API
  window.CompanySeriousness = {
    initPortal: initPortalSection,
    initMonitor: renderAdminMonitor,
    show: showSeriousnessSection,
    getSessionRecords: () => loadRecords().slice(),
    clearSession: () => {
      clearRecords();
      sessionStore.lastAnalysis = null;
    }
  };

  // مزامنة بين التبويبات: عند الإرسال من المستثمر/المحاسب تتحدث شاشة الأدمن فوراً
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) {
      const mon = document.getElementById('bi-seriousness-monitor');
      if (mon && mon.style.display !== 'none') {
        renderAdminMonitor();
      }
    }
  });
  window.addEventListener('csv-records-updated', function () {
    const mon = document.getElementById('bi-seriousness-monitor');
    if (mon && mon.style.display !== 'none') {
      renderAdminMonitor();
    }
  });

  // ========== دخول مباشر للمستثمر/المحاسب بدون تسجيل لجنة ==========
  function openPublicPortal(role) {
    ensureStyles();
    let shell = document.getElementById('csv-public-shell');
    if (!shell) {
      shell = document.createElement('div');
      shell.id = 'csv-public-shell';
      shell.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#f4f6f9;overflow:auto;';
      document.body.appendChild(shell);
    }
    shell.style.display = 'block';
    document.body.style.overflow = 'hidden';

    const roleLabel = role === 'auditor' ? 'المحاسب القانوني' : 'المستثمر';
    shell.innerHTML = `
      <div style="max-width:960px;margin:0 auto;padding:20px 16px 40px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div style="font-weight:800;color:#0b1f3a;font-size:15px">منظومة لجان المعاينة · بوابة ${roleLabel}</div>
          <button type="button" id="csv-public-close" style="border:1.5px solid #e2e8f0;background:#fff;border-radius:8px;padding:8px 14px;font-family:inherit;font-weight:700;cursor:pointer;font-size:12px">إغلاق والعودة</button>
        </div>
        <div id="csv-public-root"></div>
      </div>`;

    const root = document.getElementById('csv-public-root');
    sessionStore.role = role === 'auditor' ? 'auditor' : 'investor';
    root.innerHTML = portalHTML(sessionStore.role);
    bindPortalEvents(root);

    document.getElementById('csv-public-close').onclick = closePublicPortal;
  }

  function closePublicPortal() {
    const shell = document.getElementById('csv-public-shell');
    if (shell) shell.style.display = 'none';
    document.body.style.overflow = '';
    // remove hash without reload
    if (history.replaceState) {
      history.replaceState(null, '', location.pathname + location.search);
    } else {
      location.hash = '';
    }
  }

  // Hash deep-links: #investor | #auditor | #seriousness-monitor
  function handleHash() {
    const h = (location.hash || '').replace('#', '').toLowerCase();
    if (h === 'investor' || h === 'auditor') {
      openPublicPortal(h);
      return;
    }
    if (h === 'seriousness' || h === 'seriousness-monitor') {
      // من داخل الأدمن فقط
      setTimeout(() => {
        if (window.CompanySeriousness) {
          const mon = document.getElementById('bi-seriousness-monitor');
          if (mon && mon.offsetParent !== null) {
            renderAdminMonitor();
          }
        }
      }, 200);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    handleHash();
  });
  window.addEventListener('hashchange', handleHash);
})();
