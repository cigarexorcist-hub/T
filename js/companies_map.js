/**
 * خريطة الشركات - منظومة المواقف التنفيذية
 * خريطة تفاعلية لـ أكثر من 12,000 منشأة ومنشأة سياحية وطاقة على الخريطة المصرية
 * مصممة لإبهار متخذ القرار وعرض قدرات المنظومة التحليلية
 */

let companiesMap = null;
let companiesMarkersLayer = null;
let companiesClusterGroup = null;
let companiesFiltered = [];
let companiesMapInitialized = false;

// Format numbers in Arabic style
function formatCapital(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + ' مليون ج.م';
    if (n >= 1000) return (n / 1000).toFixed(0) + ' ألف ج.م';
    return n + ' ج.م';
}

function formatNumber(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function initCompaniesMapSection() {
    if (companiesMapInitialized) {
        setTimeout(() => { if (companiesMap) companiesMap.invalidateSize(); }, 200);
        return;
    }
    companiesMapInitialized = true;

    // Build the UI
    const section = document.getElementById('bi-companies-map');
    if (!section) return;

    section.innerHTML = `
        <div class="companies-map-wrapper">
            <!-- Header -->
            <div class="cmap-header">
                <div>
                    <h3><i class="fas fa-map-marked-alt me-2"></i>خريطة الشركات المعاينة</h3>
                    <p class="cmap-subtitle">منصة دعم القرار الجغرافي — <strong id="cmap-total-count">12188</strong> منشأة صناعية وسياحية وطاقة (تشمل الفنادق على النيل والبحرين ومفاعل الضبعة)</p>
                </div>
                <div class="cmap-header-actions">
                    <button class="btn btn-sm btn-outline-light" onclick="resetCompaniesFilters()"><i class="fas fa-redo"></i> إعادة تعيين</button>
                    <button class="btn btn-sm btn-primary" onclick="exportCompaniesMapData()"><i class="fas fa-download"></i> تصدير البيانات</button>
                </div>
            </div>

            <!-- KPI Strip -->
            <div class="cmap-kpi-strip" id="cmap-kpi-strip">
                <div class="cmap-kpi"><span class="cmap-kpi-val" id="cmap-kpi-visible">12188</span><span class="cmap-kpi-label">شركة ظاهرة</span></div>
                <div class="cmap-kpi"><span class="cmap-kpi-val" id="cmap-kpi-active">0</span><span class="cmap-kpi-label">عاملة</span></div>
                <div class="cmap-kpi"><span class="cmap-kpi-val" id="cmap-kpi-govs">0</span><span class="cmap-kpi-label">محافظة</span></div>
                <div class="cmap-kpi"><span class="cmap-kpi-val" id="cmap-kpi-workers">0</span><span class="cmap-kpi-label">إجمالي العمالة</span></div>
                <div class="cmap-kpi"><span class="cmap-kpi-val" id="cmap-kpi-capital">0</span><span class="cmap-kpi-label">رأس المال (مليون)</span></div>
            </div>

            <div class="cmap-main-layout">
                <!-- Filters Panel -->
                <div class="cmap-filters-panel">
                    <h5><i class="fas fa-sliders-h me-2"></i>فلاتر متقدمة</h5>
                    
                    <div class="cmap-filter-group">
                        <label>النشاط / الفئة</label>
                        <select id="cmap-filter-category" class="form-select form-select-sm" onchange="applyCompaniesFilters()">
                            <option value="">كل الأنشطة</option>
                        </select>
                    </div>

                    <div class="cmap-filter-group">
                        <label>المحافظة</label>
                        <select id="cmap-filter-gov" class="form-select form-select-sm" onchange="applyCompaniesFilters()">
                            <option value="">كافة المحافظات</option>
                        </select>
                    </div>

                    <div class="cmap-filter-group">
                        <label>حجم رأس المال العامل</label>
                        <select id="cmap-filter-capital" class="form-select form-select-sm" onchange="applyCompaniesFilters()">
                            <option value="">الكل</option>
                            <option value="صغير">صغير (أقل من 2 مليون)</option>
                            <option value="متوسط">متوسط (2 – 15 مليون)</option>
                            <option value="كبير">كبير (15 – 80 مليون)</option>
                            <option value="عملاق">عملاق (أكثر من 80 مليون)</option>
                        </select>
                    </div>

                    <div class="cmap-filter-group">
                        <label>عدد العمالة</label>
                        <select id="cmap-filter-workers" class="form-select form-select-sm" onchange="applyCompaniesFilters()">
                            <option value="">الكل</option>
                            <option value="1">أقل من 50</option>
                            <option value="2">50 – 200</option>
                            <option value="3">200 – 500</option>
                            <option value="4">أكثر من 500</option>
                        </select>
                    </div>

                    <div class="cmap-filter-group">
                        <label>نوع الطاقة</label>
                        <select id="cmap-filter-energy" class="form-select form-select-sm" onchange="applyCompaniesFilters()">
                            <option value="">الكل</option>
                        </select>
                    </div>

                    <div class="cmap-filter-group">
                        <label>المخلفات الصناعية</label>
                        <select id="cmap-filter-waste" class="form-select form-select-sm" onchange="applyCompaniesFilters()">
                            <option value="">الكل</option>
                        </select>
                    </div>

                    <div class="cmap-filter-group">
                        <label>الخامات</label>
                        <select id="cmap-filter-raw" class="form-select form-select-sm" onchange="applyCompaniesFilters()">
                            <option value="">الكل</option>
                        </select>
                    </div>

                    <div class="cmap-filter-group">
                        <label>حالة التشغيل</label>
                        <select id="cmap-filter-status" class="form-select form-select-sm" onchange="applyCompaniesFilters()">
                            <option value="">الكل</option>
                            <option value="عاملة">عاملة</option>
                            <option value="متوقفة مؤقتاً">متوقفة مؤقتاً</option>
                            <option value="تحت التطوير">تحت التطوير</option>
                        </select>
                    </div>

                    <div class="cmap-filter-group">
                        <label>بحث باسم الشركة</label>
                        <input type="text" id="cmap-filter-search" class="form-control form-control-sm" placeholder="اكتب جزء من الاسم..." oninput="applyCompaniesFilters()">
                    </div>

                    <!-- Legend -->
                    <div class="cmap-legend">
                        <h6><i class="fas fa-palette me-1"></i>دليل الألوان حسب النشاط</h6>
                        <div id="cmap-legend-items"></div>
                    </div>
                </div>

                <!-- Map Area -->
                <div class="cmap-map-area">
                    <div id="companies-egypt-map"></div>
                    <div class="cmap-map-overlay-info" id="cmap-overlay-info">
                        <i class="fas fa-info-circle"></i> حرّك الماوس على أي نقطة لعرض التفاصيل • استخدم الفلاتر لاستكشاف البيانات
                    </div>
                </div>
            </div>

            <!-- Bottom detail card (appears on click) -->
            <div class="cmap-detail-card" id="cmap-detail-card" style="display:none;">
                <button class="cmap-detail-close" onclick="closeCompanyDetail()"><i class="fas fa-times"></i></button>
                <div id="cmap-detail-content"></div>
            </div>
        </div>
    `;

    // Populate filters
    populateCompaniesFilters();
    buildLegend();

    // Init map after short delay to ensure DOM ready
    setTimeout(() => {
        initEgyptCompaniesMap();
        applyCompaniesFilters();
    }, 150);
}

function populateCompaniesFilters() {
    if (typeof companiesMapData === 'undefined') return;

    const cats = window.companiesMapCategories || [];
    const catSelect = document.getElementById('cmap-filter-category');
    cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        catSelect.appendChild(opt);
    });

    const govs = [...new Set(companiesMapData.map(c => c.governorate))].sort();
    const govSelect = document.getElementById('cmap-filter-gov');
    govs.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        govSelect.appendChild(opt);
    });

    const energies = [...new Set(companiesMapData.map(c => c.energy))].sort();
    const energySelect = document.getElementById('cmap-filter-energy');
    energies.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e;
        opt.textContent = e;
        energySelect.appendChild(opt);
    });

    const wastes = [...new Set(companiesMapData.map(c => c.waste))].sort();
    const wasteSelect = document.getElementById('cmap-filter-waste');
    wastes.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w;
        opt.textContent = w;
        wasteSelect.appendChild(opt);
    });

    const raws = [...new Set(companiesMapData.map(c => c.rawMaterials))].sort();
    const rawSelect = document.getElementById('cmap-filter-raw');
    raws.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r;
        rawSelect.appendChild(opt);
    });
}

function buildLegend() {
    const container = document.getElementById('cmap-legend-items');
    if (!container || !window.companiesMapCategories) return;
    container.innerHTML = window.companiesMapCategories.map(c => `
        <div class="cmap-legend-item">
            <span class="cmap-legend-dot" style="background:${c.color}"></span>
            <span>${c.name}</span>
        </div>
    `).join('');
}

function initEgyptCompaniesMap() {
    const mapEl = document.getElementById('companies-egypt-map');
    if (!mapEl || companiesMap) return;

    // Center on Egypt
    companiesMap = L.map('companies-egypt-map', {
        center: [26.8, 30.8],
        zoom: 6,
        minZoom: 5,
        maxZoom: 18,
        zoomControl: true
    });

    // Base layers — all free, no API key required
    // (Replaced Carto CDN which can show "API key required" in some environments)
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    });

    // Light / clear street map (Esri World Street Map — free, no key)
    const mapLight = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 19
    });

    // Dark gray canvas (Esri — free, no key)
    const mapDark = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 16
    });

    // Light gray canvas alternative
    const mapLightGray = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 16
    });

    // Satellite imagery
    const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 18
    });

    // Topographic
    const esriTopo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 19
    });

    mapLight.addTo(companiesMap);

    L.control.layers({
        'خريطة واضحة': mapLight,
        'خريطة داكنة': mapDark,
        'رمادي فاتح': mapLightGray,
        'OpenStreetMap': osm,
        'طبوغرافية': esriTopo,
        'صور فضائية': esriSat
    }, null, { position: 'topleft' }).addTo(companiesMap);

    // Cluster group
    if (typeof L.markerClusterGroup === 'function') {
        companiesClusterGroup = L.markerClusterGroup({
            maxClusterRadius: 45,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            iconCreateFunction: function(cluster) {
                const count = cluster.getChildCount();
                let size = 'small';
                if (count > 50) size = 'large';
                else if (count > 15) size = 'medium';
                return L.divIcon({
                    html: `<div class="cmap-cluster cmap-cluster-${size}"><span>${count}</span></div>`,
                    className: 'cmap-cluster-wrapper',
                    iconSize: L.point(40, 40)
                });
            }
        });
        companiesMap.addLayer(companiesClusterGroup);
    } else {
        companiesMarkersLayer = L.layerGroup().addTo(companiesMap);
    }

    // Egypt bounds roughly
    companiesMap.setMaxBounds([[20.5, 24.0], [32.5, 37.5]]);
}

function createCompanyIcon(color) {
    return L.divIcon({
        className: 'cmap-marker',
        html: `<div class="cmap-marker-dot" style="background:${color}; box-shadow: 0 0 0 3px ${color}44, 0 2px 6px rgba(0,0,0,0.35);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
    });
}

function buildTooltipContent(c) {
    return `
        <div class="cmap-tooltip">
            <div class="cmap-tt-name">${c.name}</div>
            <div class="cmap-tt-row"><i class="fas fa-industry"></i> ${c.activity}</div>
            <div class="cmap-tt-row"><i class="fas fa-map-marker-alt"></i> ${c.governorate}</div>
            <div class="cmap-tt-row"><i class="fas fa-coins"></i> رأس المال: <strong>${formatCapital(c.capital)}</strong></div>
            <div class="cmap-tt-row"><i class="fas fa-users"></i> العمالة: ${formatNumber(c.workers)}</div>
            <div class="cmap-tt-coords">${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}</div>
        </div>
    `;
}

function buildPopupContent(c) {
    return `
        <div class="cmap-popup">
            <h6 style="color:${c.color}; margin-bottom:8px;">${c.name}</h6>
            <table class="cmap-popup-table">
                <tr><td>النشاط</td><td>${c.activity}</td></tr>
                <tr><td>الفئة</td><td>${c.categoryName}</td></tr>
                <tr><td>المحافظة</td><td>${c.governorate}</td></tr>
                <tr><td>المنطقة الصناعية</td><td style="font-size:0.8em">${c.industrialArea}</td></tr>
                <tr><td>رأس المال العامل</td><td><strong>${formatCapital(c.capital)}</strong> (${c.capitalCat})</td></tr>
                <tr><td>عدد العمالة</td><td>${formatNumber(c.workers)}</td></tr>
                <tr><td>نوع الطاقة</td><td>${c.energy}</td></tr>
                <tr><td>المخلفات</td><td>${c.waste}</td></tr>
                <tr><td>الخامات</td><td>${c.rawMaterials}</td></tr>
                <tr><td>الحالة</td><td><span class="badge ${c.status==='عاملة'?'bg-success':'bg-warning text-dark'}">${c.status}</span></td></tr>
                <tr><td>آخر معاينة</td><td>${c.lastInspection}</td></tr>
                <tr><td>رقم القرار</td><td>${c.decisionNo}</td></tr>
                <tr><td>الإحداثيات</td><td style="font-family:monospace;font-size:0.85em">${c.lat}, ${c.lon}</td></tr>
            </table>
        </div>
    `;
}

function applyCompaniesFilters() {
    if (typeof companiesMapData === 'undefined') return;

    const cat = document.getElementById('cmap-filter-category')?.value || '';
    const gov = document.getElementById('cmap-filter-gov')?.value || '';
    const capital = document.getElementById('cmap-filter-capital')?.value || '';
    const workers = document.getElementById('cmap-filter-workers')?.value || '';
    const energy = document.getElementById('cmap-filter-energy')?.value || '';
    const waste = document.getElementById('cmap-filter-waste')?.value || '';
    const raw = document.getElementById('cmap-filter-raw')?.value || '';
    const status = document.getElementById('cmap-filter-status')?.value || '';
    const search = (document.getElementById('cmap-filter-search')?.value || '').trim().toLowerCase();

    companiesFiltered = companiesMapData.filter(c => {
        if (cat && c.category !== cat) return false;
        if (gov && c.governorate !== gov) return false;
        if (capital && c.capitalCat !== capital) return false;
        if (energy && c.energy !== energy) return false;
        if (waste && c.waste !== waste) return false;
        if (raw && c.rawMaterials !== raw) return false;
        if (status && c.status !== status) return false;
        if (search && !c.name.toLowerCase().includes(search) && !c.activity.toLowerCase().includes(search)) return false;
        if (workers) {
            const w = c.workers;
            if (workers === '1' && w >= 50) return false;
            if (workers === '2' && (w < 50 || w > 200)) return false;
            if (workers === '3' && (w < 200 || w > 500)) return false;
            if (workers === '4' && w <= 500) return false;
        }
        return true;
    });

    updateCompaniesMarkers();
    updateCompaniesKPIs();
}

function updateCompaniesMarkers() {
    if (!companiesMap) return;

    const targetLayer = companiesClusterGroup || companiesMarkersLayer;
    if (!targetLayer) return;

    targetLayer.clearLayers();

    companiesFiltered.forEach(c => {
        const marker = L.marker([c.lat, c.lon], {
            icon: createCompanyIcon(c.color),
            title: c.name
        });

        marker.bindTooltip(buildTooltipContent(c), {
            direction: 'top',
            offset: [0, -8],
            opacity: 0.95,
            className: 'cmap-tooltip-wrapper'
        });

        marker.bindPopup(buildPopupContent(c), {
            maxWidth: 340,
            className: 'cmap-popup-wrapper'
        });

        marker.on('click', () => showCompanyDetail(c));

        targetLayer.addLayer(marker);
    });
}

function updateCompaniesKPIs() {
    const list = companiesFiltered;
    document.getElementById('cmap-kpi-visible').textContent = formatNumber(list.length);
    document.getElementById('cmap-kpi-active').textContent = formatNumber(list.filter(c => c.status === 'عاملة').length);
    document.getElementById('cmap-kpi-govs').textContent = new Set(list.map(c => c.governorate)).size;
    const totalWorkers = list.reduce((s, c) => s + c.workers, 0);
    document.getElementById('cmap-kpi-workers').textContent = formatNumber(totalWorkers);
    const totalCapitalM = (list.reduce((s, c) => s + c.capital, 0) / 1000000).toFixed(0);
    document.getElementById('cmap-kpi-capital').textContent = formatNumber(totalCapitalM);

    document.getElementById('cmap-total-count').textContent = formatNumber(list.length);
}

function showCompanyDetail(c) {
    const card = document.getElementById('cmap-detail-card');
    const content = document.getElementById('cmap-detail-content');
    if (!card || !content) return;

    content.innerHTML = `
        <div class="row g-3">
            <div class="col-md-8">
                <h4 style="color:${c.color}">${c.name}</h4>
                <p class="text-muted mb-2"><i class="fas fa-industry me-1"></i> ${c.activity} • ${c.categoryName}</p>
                <div class="d-flex flex-wrap gap-2 mb-3">
                    <span class="badge bg-primary">${c.governorate}</span>
                    <span class="badge ${c.status==='عاملة'?'bg-success':'bg-warning text-dark'}">${c.status}</span>
                    <span class="badge bg-secondary">${c.capitalCat}</span>
                </div>
                <div class="row g-2">
                    <div class="col-6 col-md-4"><small class="text-muted">رأس المال العامل</small><div class="fw-bold">${formatCapital(c.capital)}</div></div>
                    <div class="col-6 col-md-4"><small class="text-muted">عدد العمالة</small><div class="fw-bold">${formatNumber(c.workers)}</div></div>
                    <div class="col-6 col-md-4"><small class="text-muted">آخر معاينة</small><div class="fw-bold">${c.lastInspection}</div></div>
                    <div class="col-6 col-md-4"><small class="text-muted">نوع الطاقة</small><div class="fw-bold">${c.energy}</div></div>
                    <div class="col-6 col-md-4"><small class="text-muted">المخلفات</small><div class="fw-bold">${c.waste}</div></div>
                    <div class="col-6 col-md-4"><small class="text-muted">الخامات</small><div class="fw-bold">${c.rawMaterials}</div></div>
                </div>
            </div>
            <div class="col-md-4">
                <div class="cmap-detail-coords">
                    <div><i class="fas fa-globe me-1"></i> الإحداثيات</div>
                    <code>${c.lat}, ${c.lon}</code>
                    <div class="mt-2 small text-muted">${c.industrialArea}</div>
                    <div class="mt-2"><small>رقم القرار: ${c.decisionNo}</small></div>
                </div>
            </div>
        </div>
    `;
    card.style.display = 'block';
}

function closeCompanyDetail() {
    const card = document.getElementById('cmap-detail-card');
    if (card) card.style.display = 'none';
}

function resetCompaniesFilters() {
    ['cmap-filter-category','cmap-filter-gov','cmap-filter-capital','cmap-filter-workers',
     'cmap-filter-energy','cmap-filter-waste','cmap-filter-raw','cmap-filter-status'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const search = document.getElementById('cmap-filter-search');
    if (search) search.value = '';
    applyCompaniesFilters();
    if (companiesMap) companiesMap.setView([26.8, 30.8], 6);
}

function exportCompaniesMapData() {
    const data = companiesFiltered.length ? companiesFiltered : (window.companiesMapData || []);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `companies_map_export_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// Hook into showAdminSection
const originalShowAdminSection = window.showAdminSection;
window.showAdminSection = function(id, btn) {
    if (typeof originalShowAdminSection === 'function') {
        originalShowAdminSection(id, btn);
    } else {
        document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
        document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
        if (btn) btn.classList.add('active');
    }
    if (id === 'bi-companies-map') {
        initCompaniesMapSection();
        setTimeout(() => { if (companiesMap) companiesMap.invalidateSize(); }, 300);
    }
};
