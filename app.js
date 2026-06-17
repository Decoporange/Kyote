// ═══════════════════════════════════════════════════════════════
// SUBJECTS  — maxScore: 教科の満点（国語のみ200、他は100）
// ═══════════════════════════════════════════════════════════════
const SUBJECTS = [
  { id:'engR',  name:'英語R',    dc:'#3b82f6', maxScore:100 },
  { id:'engL',  name:'英語L',    dc:'#0ea5e9', maxScore:100 },
  { id:'jpn',   name:'国語',     dc:'#ec4899', maxScore:200 },
  { id:'math1', name:'数学ⅠA',  dc:'#f59e0b', maxScore:100 },
  { id:'math2', name:'数学ⅡBC', dc:'#f97316', maxScore:100 },
  { id:'phy',   name:'物理',     dc:'#8b5cf6', maxScore:100 },
  { id:'chem',  name:'化学',     dc:'#6366f1', maxScore:100 },
  { id:'geo',   name:'地理',     dc:'#10b981', maxScore:100 },
  { id:'info',  name:'情報',     dc:'#14b8a6', maxScore:100 },
];

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
function defSubject(id) {
  const sub = SUBJECTS.find(s => s.id === id);
  return { color: sub?.dc || '#4f6ef7', years: [] };
}
function defYear()    { return { label:'', myScore:'', avg:'', mondai:[] }; }
function defMondai(n) { return { label:`第${n}問`, score:'', max:'' }; }

let state = (() => {
  try {
    const r = localStorage.getItem('kyotsu_v5');
    if (r) return JSON.parse(r);
  } catch(e) {}
  const s = { subjects:{}, theme:'light', graphVisible:{}, selectedYear:'' };
  SUBJECTS.forEach(sub => {
    s.subjects[sub.id] = defSubject(sub.id);
    s.graphVisible[sub.id] = true;
  });
  return s;
})();

function save() { localStorage.setItem('kyotsu_v5', JSON.stringify(state)); }

function ensure(id) {
  if (!state.subjects[id])       state.subjects[id] = defSubject(id);
  if (!state.subjects[id].years) state.subjects[id].years = [];
  if (!state.graphVisible)       state.graphVisible = {};
  if (state.graphVisible[id] === undefined) state.graphVisible[id] = true;
}

// ═══════════════════════════════════════════════════════════════
// CALC
// maxScore ごとに得点率を算出
// ═══════════════════════════════════════════════════════════════
function getMaxScore(id) {
  return SUBJECTS.find(s => s.id === id)?.maxScore ?? 100;
}

// 大問単位: score / max（満点入力があれば）
function mRate(m) {
  const s = parseFloat(m.score), x = parseFloat(m.max);
  if (isNaN(s) || isNaN(x) || x === 0) return null;
  return s / x;
}

// 年度統計: 得点率 = myScore / maxScore（教科ごとの満点）
function yearStats(yr, subId) {
  const ms     = yr.mondai || [];
  const totMax = ms.reduce((a, m) => a + (parseFloat(m.max)   || 0), 0);
  const totSc  = ms.reduce((a, m) => a + (parseFloat(m.score) || 0), 0);
  const mySc   = parseFloat(yr.myScore);
  const maxSc  = getMaxScore(subId);
  const rate   = !isNaN(mySc) ? mySc / maxSc : null;

  let hi = -1, lo = -1, hiR = -Infinity, loR = Infinity;
  ms.forEach((m, i) => {
    const r = mRate(m); if (r === null) return;
    if (r > hiR) { hiR = r; hi = i; }
    if (r < loR) { loR = r; lo = i; }
  });
  return { totMax, totSc, rate, hi, lo };
}

// 指定ラベルの年度の得点（未入力→null）
function scoreForLabel(subId, label) {
  const d = state.subjects[subId];
  if (!d || !d.years) return null;
  const yr = d.years.find(y => y.label === label);
  if (!yr) return null;
  const v = parseFloat(yr.myScore);
  return isNaN(v) ? null : v;
}

// 最新年度の得点（ドロワーバッジ用）
function latestScore(id) {
  const d = state.subjects[id];
  if (!d || !d.years || !d.years.length) return null;
  const v = parseFloat(d.years[d.years.length - 1].myScore);
  return isNaN(v) ? null : v;
}

// 全教科に存在する年度ラベルの一覧（ソート済み）
function collectAllLabels() {
  const s = new Set();
  SUBJECTS.forEach(sub => {
    const d = state.subjects[sub.id];
    if (d && d.years) d.years.forEach(y => { if (y.label) s.add(y.label); });
  });
  return Array.from(s).sort();
}

// ═══════════════════════════════════════════════════════════════
// ROUTING
// ═══════════════════════════════════════════════════════════════
let curTab = 'overview';

function init() {
  applyTheme();
  buildPanels();
  buildDrawer();
  switchTab(curTab);
  document.getElementById('hamBtn').addEventListener('click', openDrawer);
  document.getElementById('drawerOverlay').addEventListener('click', closeDrawer);
  document.getElementById('drawerClose').addEventListener('click', closeDrawer);
  document.getElementById('importFile').addEventListener('change', onImport);
}

function applyTheme() {
  document.body.dataset.theme = state.theme || 'light';
  const ic  = document.getElementById('themeIcon');
  const lbl = document.getElementById('themeLbl');
  if (ic)  ic.textContent  = state.theme === 'dark' ? '☀️' : '🌙';
  if (lbl) lbl.textContent = state.theme === 'dark' ? 'ライトモード' : 'ダークモード';
}

// ─── DRAWER ────────────────────────────────────────────────────
function openDrawer()  {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
}

function buildDrawer() {
  const body = document.getElementById('drawerBody');
  body.innerHTML = '';

  // ── ページ ──
  const sl1 = document.createElement('div');
  sl1.className = 'drawer-section-label';
  sl1.textContent = 'ページ';
  body.appendChild(sl1);

  const ovBtn = document.createElement('button');
  ovBtn.className = 'drawer-btn' + (curTab === 'overview' ? ' active' : '');
  ovBtn.id = 'drawer-tab-overview';
  ovBtn.innerHTML = '<span class="dot" style="background:#6366f1"></span>総合概要';
  ovBtn.addEventListener('click', () => { switchTab('overview'); closeDrawer(); });
  body.appendChild(ovBtn);

  SUBJECTS.forEach(sub => {
    ensure(sub.id);
    const btn = document.createElement('button');
    btn.className = 'drawer-btn' + (curTab === sub.id ? ' active' : '');
    btn.id = 'drawer-tab-' + sub.id;
    const sc  = latestScore(sub.id);
    const col = state.subjects[sub.id].color;
    btn.innerHTML = `<span class="dot" style="background:${col}"></span>${sub.name}<span class="sbadge">${sc !== null ? sc : '—'}</span>`;
    btn.addEventListener('click', () => { switchTab(sub.id); closeDrawer(); });
    body.appendChild(btn);
  });

  // ── 設定 ──
  const div = document.createElement('hr');
  div.className = 'drawer-divider';
  body.appendChild(div);

  const sl2 = document.createElement('div');
  sl2.className = 'drawer-section-label';
  sl2.textContent = '設定';
  body.appendChild(sl2);

  // Dark mode
  const themeBtn = document.createElement('button');
  themeBtn.className = 'drawer-util-btn';
  themeBtn.innerHTML = `<span class="drawer-util-icon" id="themeIcon">${state.theme === 'dark' ? '☀️' : '🌙'}</span><span id="themeLbl">${state.theme === 'dark' ? 'ライトモード' : 'ダークモード'}</span>`;
  themeBtn.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    save(); applyTheme(); switchTab(curTab);
  });
  body.appendChild(themeBtn);

  // Export
  const expBtn = document.createElement('button');
  expBtn.className = 'drawer-util-btn';
  expBtn.innerHTML = '<span class="drawer-util-icon">📤</span>データを書き出す';
  expBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type:'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'kyotsu_tracker.json'; a.click();
    URL.revokeObjectURL(url);
    closeDrawer();
  });
  body.appendChild(expBtn);

  // Import
  const impBtn = document.createElement('button');
  impBtn.className = 'drawer-util-btn';
  impBtn.innerHTML = '<span class="drawer-util-icon">📥</span>データを読み込む';
  impBtn.addEventListener('click', () => { document.getElementById('importFile').click(); closeDrawer(); });
  body.appendChild(impBtn);
}

function updateDrawerBadges() {
  SUBJECTS.forEach(sub => {
    const btn = document.getElementById('drawer-tab-' + sub.id);
    if (!btn) return;
    const sc    = latestScore(sub.id);
    const badge = btn.querySelector('.sbadge');
    if (badge) badge.textContent = sc !== null ? sc : '—';
    const dot = btn.querySelector('.dot');
    if (dot) dot.style.background = state.subjects[sub.id]?.color || '#4f6ef7';
    btn.classList.toggle('active', curTab === sub.id);
  });
  const ov = document.getElementById('drawer-tab-overview');
  if (ov) ov.classList.toggle('active', curTab === 'overview');
}

// ─── PANELS ────────────────────────────────────────────────────
function buildPanels() {
  const main = document.getElementById('mainContent');
  main.innerHTML = '';
  ['overview', ...SUBJECTS.map(s => s.id)].forEach(id => {
    const p = document.createElement('div');
    p.className = 'panel'; p.id = 'panel-' + id;
    main.appendChild(p);
  });
}

function switchTab(id) {
  curTab = id;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const p = document.getElementById('panel-' + id);
  if (p) {
    p.classList.add('active');
    if (id === 'overview') renderOverview(p);
    else renderSubject(id, p);
  }
  const labelEl = document.getElementById('curTabLabel');
  if (labelEl) {
    if (id === 'overview') labelEl.textContent = '総合概要';
    else {
      const sub = SUBJECTS.find(s => s.id === id);
      labelEl.textContent = sub ? sub.name : '';
    }
  }
  updateDrawerBadges();
}

// ═══════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════
function renderOverview(panel) {
  const allLabels = collectAllLabels();

  // 選択年度の確定（存在しない場合は最新or空）
  if (!state.selectedYear || !allLabels.includes(state.selectedYear)) {
    state.selectedYear = allLabels.length ? allLabels[allLabels.length - 1] : '';
  }

  panel.innerHTML = `
    <div class="ov-total-wrap">
      <div class="ov-total-top">
        <div class="ov-total-label">総合得点</div>
        <select class="yr-select" id="yrSelect">
          ${allLabels.length
            ? allLabels.map(l => `<option value="${l}" ${l === state.selectedYear ? 'selected' : ''}>${l}</option>`).join('')
            : '<option value="">（年度なし）</option>'}
        </select>
      </div>
      <div class="ov-total-val" id="ov-total-val">—</div>
      <div class="ov-total-sub" id="ov-total-sub"></div>
    </div>
    <div class="summary-grid" id="summary-grid"></div>
    <div class="graph-wrap">
      <div class="graph-title">📈 総合点推移</div>
      <canvas id="cv-overview" height="200"></canvas>
    </div>
    <div class="graph-wrap">
      <div class="graph-title">📊 教科別得点率（満点ベース）全年度比較</div>
      <div class="graph-controls" id="gv-controls"></div>
      <canvas id="cv-allrates" height="220"></canvas>
    </div>
  `;

  // セレクターの変更
  const sel = document.getElementById('yrSelect');
  if (sel) {
    sel.addEventListener('change', e => {
      state.selectedYear = e.target.value;
      save();
      updateOverviewTotal();
      updateSummaryGrid();
    });
  }

  updateOverviewTotal();
  updateSummaryGrid();
  drawOverviewLine();
  buildAllRatesControls();
  drawAllRatesGraph();
}

function updateOverviewTotal() {
  const lbl = state.selectedYear;
  let total = 0, hasAny = false;
  SUBJECTS.forEach(sub => {
    const sc = scoreForLabel(sub.id, lbl);
    if (sc !== null) { total += sc; hasAny = true; }
  });
  const valEl = document.getElementById('ov-total-val');
  const subEl = document.getElementById('ov-total-sub');
  if (valEl) valEl.textContent = (hasAny && lbl) ? total : '—';
  if (subEl) subEl.textContent = lbl || '';
}

function updateSummaryGrid() {
  const grid = document.getElementById('summary-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const lbl = state.selectedYear;

  SUBJECTS.forEach(sub => {
    ensure(sub.id);
    const sc    = scoreForLabel(sub.id, lbl);
    const color = state.subjects[sub.id].color;
    const maxSc = getMaxScore(sub.id);
    const rate  = (sc !== null) ? sc / maxSc : null;
    const rs    = rate !== null ? Math.round(rate * 100) + '%' : '—';
    const rw    = rate !== null ? Math.min(100, Math.round(rate * 100)) : 0;

    const card = document.createElement('div');
    card.className = 'sum-card';
    card.style.borderTop = `3px solid ${color}`;
    card.innerHTML = `
      <div class="sum-name">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block"></span>
        ${sub.name}
        <span style="font-size:10px;color:var(--text3);margin-left:2px">/${maxSc}点</span>
      </div>
      <div class="sum-score" style="color:${color}">${sc !== null ? sc : '—'}</div>
      <div class="sum-rate">得点率 ${rs}</div>
      <div class="rbar"><div class="rbar-fill" style="width:${rw}%;background:${color}"></div></div>
    `;
    grid.appendChild(card);
  });
}

function drawOverviewLine() {
  const canvas = document.getElementById('cv-overview');
  if (!canvas) return;
  const allLabels = collectAllLabels();
  if (!allLabels.length) { showEmpty(canvas, '年度データを入力すると推移が表示されます'); return; }

  const pts = allLabels.map(lbl => {
    let t = 0, c = 0;
    SUBJECTS.forEach(sub => {
      const sc = scoreForLabel(sub.id, lbl);
      if (sc !== null) { t += sc; c++; }
    });
    return c > 0 ? t : null;
  });
  drawLine(canvas, allLabels, [{ label:'総合点', data:pts, color:'#4f6ef7' }], false, 200);
}

function buildAllRatesControls() {
  const wrap = document.getElementById('gv-controls');
  if (!wrap) return;
  wrap.innerHTML = '';
  SUBJECTS.forEach(sub => {
    ensure(sub.id);
    const col     = state.subjects[sub.id].color;
    const checked = state.graphVisible[sub.id] !== false;
    const lbl     = document.createElement('label');
    lbl.className = 'gcb-label';
    lbl.style.borderColor = checked ? col : 'var(--border)';
    lbl.style.background  = checked ? col + '22' : 'transparent';
    lbl.style.color       = checked ? col : 'var(--text3)';
    lbl.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''} data-subid="${sub.id}">${sub.name}`;
    lbl.querySelector('input').addEventListener('change', e => {
      state.graphVisible[sub.id] = e.target.checked;
      save();
      lbl.style.borderColor = e.target.checked ? col : 'var(--border)';
      lbl.style.background  = e.target.checked ? col + '22' : 'transparent';
      lbl.style.color       = e.target.checked ? col : 'var(--text3)';
      drawAllRatesGraph();
    });
    wrap.appendChild(lbl);
  });
}

function drawAllRatesGraph() {
  const canvas = document.getElementById('cv-allrates');
  if (!canvas) return;
  const allLabels = collectAllLabels();
  if (!allLabels.length) { showEmpty(canvas, '年度データを入力するとグラフが表示されます'); return; }

  const visible = SUBJECTS.filter(s => state.graphVisible[s.id] !== false);
  if (!visible.length) { showEmpty(canvas, '教科を選択してください'); return; }

  const series = visible.map(sub => {
    ensure(sub.id);
    const d      = state.subjects[sub.id];
    const maxSc  = getMaxScore(sub.id);
    const data   = allLabels.map(lbl => {
      const sc = scoreForLabel(sub.id, lbl);
      return sc !== null ? Math.round((sc / maxSc) * 100) : null;
    });
    return { label: sub.name, data, color: d.color };
  });

  // Y軸 0〜100%
  drawLine(canvas, allLabels, series, true, 220, 0, 100, '%');
}

// ═══════════════════════════════════════════════════════════════
// SUBJECT PANEL
// ═══════════════════════════════════════════════════════════════
function renderSubject(subId, panel) {
  ensure(subId);
  const sub   = SUBJECTS.find(s => s.id === subId);
  const d     = state.subjects[subId];
  const col   = d.color;
  const maxSc = getMaxScore(subId);

  let lastSc = null, lastRate = null;
  if (d.years && d.years.length > 0) {
    const last = d.years[d.years.length - 1];
    const v    = parseFloat(last.myScore);
    if (!isNaN(v)) { lastSc = v; lastRate = v / maxSc; }
  }

  panel.innerHTML = `
    <div class="subject-hero" style="background:${col}">
      <div class="shero-content">
        <div class="shero-name">${sub.name} <span style="font-size:13px;opacity:.7;font-weight:500">（満点 ${maxSc}点）</span></div>
        <div class="shero-stats">
          <div class="hstat">
            <div class="hstat-val" id="sh-sc-${subId}">${lastSc !== null ? lastSc : '—'}</div>
            <div class="hstat-label">最新得点</div>
          </div>
          <div class="hstat">
            <div class="hstat-val" id="sh-rt-${subId}">${lastRate !== null ? Math.round(lastRate * 100) + '%' : '—'}</div>
            <div class="hstat-label">得点率</div>
          </div>
          <div class="hstat">
            <div class="hstat-val" id="sh-yr-${subId}">${d.years ? d.years.length : 0}</div>
            <div class="hstat-label">年度数</div>
          </div>
        </div>
      </div>
      <div class="color-wrap">
        <input type="color" value="${col}" id="cpick-${subId}" title="色を変更">
      </div>
    </div>
    <div class="graph-wrap">
      <div class="graph-title">📈 得点推移</div>
      <canvas id="cv-${subId}" height="160"></canvas>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">年度データ</div>
        <button class="btn btn-primary btn-sm" id="addyr-${subId}">＋ 年度追加</button>
      </div>
      <div class="year-entries" id="yentries-${subId}"></div>
    </div>
  `;

  renderAllYears(subId);
  drawSubjectGraph(subId);

  document.getElementById(`addyr-${subId}`).addEventListener('click', () => {
    d.years.push(defYear()); save();
    renderAllYears(subId); drawSubjectGraph(subId);
    updateHeroStats(subId); updateDrawerBadges();
  });

  document.getElementById(`cpick-${subId}`).addEventListener('input', e => {
    state.subjects[subId].color = e.target.value; save();
    const hero = panel.querySelector('.subject-hero');
    if (hero) hero.style.background = e.target.value;
    updateDrawerBadges(); drawSubjectGraph(subId);
  });
}

function renderAllYears(subId) {
  ensure(subId);
  const container = document.getElementById(`yentries-${subId}`);
  if (!container) return;
  container.innerHTML = '';
  (state.subjects[subId].years || []).forEach((_, yi) =>
    container.appendChild(makeYearCard(subId, yi))
  );
}

function makeYearCard(subId, yi) {
  ensure(subId);
  const d    = state.subjects[subId];
  const yr   = d.years[yi];
  const col  = d.color;

  const wrap = document.createElement('div');
  wrap.className = 'year-card';
  wrap.id = `ycard-${subId}-${yi}`;

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'year-card-header';
  const labelInp = document.createElement('input');
  labelInp.className = 'year-label-input';
  labelInp.placeholder = '年度ラベル（例：2025本試験）';
  labelInp.value = yr.label || '';
  const commitLabel = e => { yr.label = e.target.value; save(); drawSubjectGraph(subId); updateDrawerBadges(); };
  labelInp.addEventListener('change', commitLabel);
  labelInp.addEventListener('blur',   commitLabel);

  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-danger btn-sm';
  delBtn.textContent = '削除';
  delBtn.addEventListener('click', () => {
    d.years.splice(yi, 1); save();
    renderAllYears(subId); drawSubjectGraph(subId);
    updateHeroStats(subId); updateDrawerBadges();
  });
  header.appendChild(labelInp);
  header.appendChild(delBtn);
  wrap.appendChild(header);

  // ── Score fields ──
  const scRow = document.createElement('div');
  scRow.className = 'scores-row';

  const maxSc = getMaxScore(subId);

  function makeField(labelTxt, fieldKey) {
    const field = document.createElement('div');
    field.className = 'score-field';
    const lbl = document.createElement('label');
    lbl.textContent = labelTxt;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.inputMode = 'decimal';
    inp.value = yr[fieldKey] || '';
    inp.setAttribute('autocomplete', 'off');
    const commit = () => {
      yr[fieldKey] = inp.value; save();
      drawSubjectGraph(subId);
      updateHeroStats(subId);
      updateDrawerBadges();
    };
    inp.addEventListener('change', commit);
    inp.addEventListener('blur',   commit);
    field.appendChild(lbl);
    field.appendChild(inp);
    return field;
  }

  scRow.appendChild(makeField(`自分の得点（/${maxSc}点）`, 'myScore'));
  scRow.appendChild(makeField('平均点', 'avg'));
  wrap.appendChild(scRow);

  // ── Mondai ──
  const mondaiSec = document.createElement('div');
  mondaiSec.className = 'mondai-section';
  const mHeader = document.createElement('div');
  mHeader.className = 'mondai-header';
  const mTitle = document.createElement('span');
  mTitle.className = 'mondai-title';
  mTitle.textContent = '大問（参考）';
  const addMBtn = document.createElement('button');
  addMBtn.className = 'btn btn-ghost btn-sm';
  addMBtn.textContent = '＋ 大問追加';
  mHeader.appendChild(mTitle);
  mHeader.appendChild(addMBtn);
  mondaiSec.appendChild(mHeader);

  const table = document.createElement('table');
  table.className = 'mtable';
  table.innerHTML = '<thead><tr><th>大問</th><th>得点</th><th>満点</th><th>得点率</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');
  tbody.id = `mtbody-${subId}-${yi}`;
  table.appendChild(tbody);
  mondaiSec.appendChild(table);
  wrap.appendChild(mondaiSec);

  addMBtn.addEventListener('click', () => {
    const n = (yr.mondai || []).length + 1;
    yr.mondai.push(defMondai(n)); save();
    appendMondaiRow(subId, yi, yr.mondai.length - 1, tbody);
    refreshRowHighlights(subId, yi, tbody);
  });

  (yr.mondai || []).forEach((_, mi) => appendMondaiRow(subId, yi, mi, tbody));
  refreshRowHighlights(subId, yi, tbody);

  return wrap;
}

function appendMondaiRow(subId, yi, mi, tbody) {
  ensure(subId);
  const yr  = state.subjects[subId].years[yi];
  const m   = yr.mondai[mi];
  const st  = yearStats(yr, subId);
  const r   = mRate(m);
  const isHi = st.hi === mi && r !== null;
  const isLo = st.lo === mi && r !== null && st.hi !== mi;

  const tr = document.createElement('tr');
  tr.className = 'mrow' + (isHi ? ' high-row' : isLo ? ' low-row' : '');
  tr.id = `mrow-${subId}-${yi}-${mi}`;

  // Label
  const tdL = document.createElement('td'); tdL.className = 'mcell-label';
  const lblInp = document.createElement('input');
  lblInp.className = 'mlabel-input';
  lblInp.value = m.label || '';
  const commitLbl = e => { m.label = e.target.value; save(); };
  lblInp.addEventListener('change', commitLbl);
  lblInp.addEventListener('blur',   commitLbl);
  tdL.appendChild(lblInp); tr.appendChild(tdL);

  // Score
  const tdS = document.createElement('td');
  const scInp = document.createElement('input');
  scInp.className = 'mnum-input'; scInp.type = 'text'; scInp.inputMode = 'decimal';
  scInp.value = m.score || ''; scInp.setAttribute('autocomplete', 'off');
  const commitSc = () => {
    m.score = scInp.value; save();
    refreshRateCell(tr, m);
    refreshRowHighlights(subId, yi, document.getElementById(`mtbody-${subId}-${yi}`));
  };
  scInp.addEventListener('change', commitSc); scInp.addEventListener('blur', commitSc);
  tdS.appendChild(scInp); tr.appendChild(tdS);

  // Max
  const tdM = document.createElement('td');
  const mxInp = document.createElement('input');
  mxInp.className = 'mnum-input'; mxInp.type = 'text'; mxInp.inputMode = 'decimal';
  mxInp.value = m.max || ''; mxInp.setAttribute('autocomplete', 'off');
  const commitMx = () => {
    m.max = mxInp.value; save();
    refreshRateCell(tr, m);
    refreshRowHighlights(subId, yi, document.getElementById(`mtbody-${subId}-${yi}`));
  };
  mxInp.addEventListener('change', commitMx); mxInp.addEventListener('blur', commitMx);
  tdM.appendChild(mxInp); tr.appendChild(tdM);

  // Rate
  const tdR = document.createElement('td');
  const rSpan = document.createElement('span');
  rSpan.className = 'mrate';
  updateRateSpan(rSpan, r);
  const miniBar = document.createElement('div'); miniBar.className = 'mrate-bar';
  const miniFill = document.createElement('div'); miniFill.className = 'mrate-bar-fill';
  if (r !== null) {
    miniFill.style.width      = Math.round(r * 100) + '%';
    miniFill.style.background = r >= 0.7 ? 'var(--high)' : r >= 0.4 ? 'var(--accent)' : 'var(--low)';
  } else { miniFill.style.width = '0%'; }
  miniBar.appendChild(miniFill);
  tdR.appendChild(rSpan); tdR.appendChild(miniBar);
  tr.appendChild(tdR);

  // Delete
  const tdD = document.createElement('td');
  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-danger btn-sm'; delBtn.textContent = '✕';
  delBtn.addEventListener('click', () => {
    yr.mondai.splice(mi, 1); save();
    const tb = document.getElementById(`mtbody-${subId}-${yi}`);
    if (tb) { tb.innerHTML = ''; yr.mondai.forEach((_, ni) => appendMondaiRow(subId, yi, ni, tb)); }
    refreshRowHighlights(subId, yi, document.getElementById(`mtbody-${subId}-${yi}`));
  });
  tdD.appendChild(delBtn); tr.appendChild(tdD);
  tbody.appendChild(tr);
}

function updateRateSpan(span, r) {
  if (r === null) { span.textContent = '—'; span.style.color = 'var(--text3)'; return; }
  span.textContent = Math.round(r * 100) + '%';
  span.style.color = r >= 0.7 ? 'var(--high)' : r >= 0.4 ? 'var(--accent)' : 'var(--low)';
}

function refreshRateCell(tr, m) {
  const r    = mRate(m);
  const span = tr.querySelector('.mrate');
  if (span) updateRateSpan(span, r);
  const fill = tr.querySelector('.mrate-bar-fill');
  if (fill) {
    fill.style.width      = r !== null ? Math.round(r * 100) + '%' : '0%';
    fill.style.background = r !== null
      ? (r >= 0.7 ? 'var(--high)' : r >= 0.4 ? 'var(--accent)' : 'var(--low)')
      : 'var(--border)';
  }
}

function refreshRowHighlights(subId, yi, tbody) {
  if (!tbody) return;
  ensure(subId);
  const yr = state.subjects[subId].years[yi];
  if (!yr) return;
  const st = yearStats(yr, subId);
  Array.from(tbody.querySelectorAll('.mrow')).forEach((tr, mi) => {
    if (!yr.mondai[mi]) return;
    const r    = mRate(yr.mondai[mi]);
    const isHi = st.hi === mi && r !== null;
    const isLo = st.lo === mi && r !== null && st.hi !== mi;
    tr.classList.toggle('high-row', isHi);
    tr.classList.toggle('low-row',  isLo);
  });
}

function updateHeroStats(subId) {
  ensure(subId);
  const d     = state.subjects[subId];
  const maxSc = getMaxScore(subId);
  let lastSc = null, lastRate = null;
  if (d.years && d.years.length > 0) {
    const last = d.years[d.years.length - 1];
    const v    = parseFloat(last.myScore);
    if (!isNaN(v)) { lastSc = v; lastRate = v / maxSc; }
  }
  const scEl = document.getElementById(`sh-sc-${subId}`);
  const rtEl = document.getElementById(`sh-rt-${subId}`);
  const yrEl = document.getElementById(`sh-yr-${subId}`);
  if (scEl) scEl.textContent = lastSc !== null ? lastSc : '—';
  if (rtEl) rtEl.textContent = lastRate !== null ? Math.round(lastRate * 100) + '%' : '—';
  if (yrEl) yrEl.textContent = d.years ? d.years.length : 0;
}

// ═══════════════════════════════════════════════════════════════
// CANVAS GRAPHS  ★ 数値ラベルなし
// ═══════════════════════════════════════════════════════════════
function drawSubjectGraph(subId) {
  const canvas = document.getElementById(`cv-${subId}`);
  if (!canvas) return;
  ensure(subId);
  const d      = state.subjects[subId];
  const yrs    = d.years || [];
  const maxSc  = getMaxScore(subId);
  if (!yrs.length) { showEmpty(canvas, '年度を追加するとグラフが表示されます'); return; }

  const labels = yrs.map(y => y.label || '—');
  const mine   = yrs.map(y => { const v = parseFloat(y.myScore); return isNaN(v) ? null : v; });
  const avgs   = yrs.map(y => { const v = parseFloat(y.avg);     return isNaN(v) ? null : v; });
  const series = [{ label:'自分', data:mine, color:d.color }];
  if (avgs.some(v => v !== null))
    series.push({ label:'平均', data:avgs, color:'#94a3b8', dashed:true });

  drawLine(canvas, labels, series, series.length > 1, 160, 0, maxSc, '');
}

/**
 * drawLine — 数値ラベルなし版
 * showDotLabels: false にすることでドット上の数値を表示しない
 */
function drawLine(canvas, labels, series, legend = true, H = 200,
                  forceMin = null, forceMax = null, unit = '') {
  const dark = state.theme === 'dark';
  const dpr  = window.devicePixelRatio || 1;
  const W    = Math.max(200, canvas.parentElement.clientWidth - 36);
  canvas.width  = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const tc    = dark ? '#8b92b8' : '#5a5f7d';
  const gc    = dark ? '#2d3154' : '#e2e4ef';
  const legH  = legend && series.length > 1 ? 28 : 0;
  const pad   = { t: legH + 12, r: 24, b: 38, l: 48 };
  const cW    = W - pad.l - pad.r;
  const cH    = H - pad.t - pad.b;

  const all = series.flatMap(s => s.data).filter(v => v !== null);
  if (!all.length) { showEmpty(canvas, 'データなし', W, H); return; }

  let minV = forceMin !== null ? forceMin : Math.min(...all);
  let maxV = forceMax !== null ? forceMax : Math.max(...all);
  if (minV === maxV) { minV = Math.max(0, minV - 10); maxV += 10; }
  if (forceMin === null) { const rng = maxV - minV; minV = Math.max(0, minV - rng * .1); maxV += rng * .1; }

  // Grid lines + Y labels
  ctx.strokeStyle = gc; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = minV + (maxV - minV) * (i / 4);
    const y = pad.t + cH - (v - minV) / (maxV - minV) * cH;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cW, y); ctx.stroke();
    ctx.fillStyle = tc; ctx.font = '10px system-ui'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(v) + unit, pad.l - 4, y + 3);
  }

  // X labels
  ctx.textAlign = 'center'; ctx.fillStyle = tc; ctx.font = '10px system-ui';
  labels.forEach((lbl, i) => {
    const x = pad.l + (labels.length === 1 ? cW / 2 : i / (labels.length - 1) * cW);
    ctx.fillText(lbl, x, pad.t + cH + 15);
  });

  // Legend
  if (legend && series.length > 1) {
    let lx = pad.l;
    series.forEach(s => {
      ctx.strokeStyle = s.color; ctx.lineWidth = 2;
      if (s.dashed) ctx.setLineDash([4, 3]); else ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(lx, 14); ctx.lineTo(lx + 18, 14); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = tc; ctx.font = '11px system-ui'; ctx.textAlign = 'left';
      ctx.fillText(s.label, lx + 22, 18); lx += 72;
    });
  }

  // Lines & dots（数値ラベルなし）
  series.forEach(s => {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2.5;
    if (s.dashed) ctx.setLineDash([5, 3]); else ctx.setLineDash([]);
    ctx.beginPath(); let started = false;
    s.data.forEach((v, i) => {
      if (v === null) { started = false; return; }
      const x = pad.l + (labels.length === 1 ? cW / 2 : i / (labels.length - 1) * cW);
      const y = pad.t + cH - (v - minV) / (maxV - minV) * cH;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke(); ctx.setLineDash([]);

    // ドットのみ（ラベルなし）
    s.data.forEach((v, i) => {
      if (v === null) return;
      const x = pad.l + (labels.length === 1 ? cW / 2 : i / (labels.length - 1) * cW);
      const y = pad.t + cH - (v - minV) / (maxV - minV) * cH;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = s.color; ctx.fill();
    });
  });
}

function showEmpty(canvas, msg, W, H) {
  const dark = state.theme === 'dark';
  const dpr  = window.devicePixelRatio || 1;
  const w    = W || Math.max(200, canvas.parentElement.clientWidth - 36);
  const h    = H || (parseInt(canvas.getAttribute('height')) || 160);
  canvas.width  = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.fillStyle = dark ? '#1a1d2e' : '#f5f6fa';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = dark ? '#4a5070' : '#9097b8';
  ctx.font = '13px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(msg, w / 2, h / 2 + 5);
}

// ═══════════════════════════════════════════════════════════════
// IMPORT
// ═══════════════════════════════════════════════════════════════
function onImport(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const imp = JSON.parse(ev.target.result);
      if (imp.subjects) {
        state = imp; save(); curTab = 'overview';
        applyTheme(); buildPanels(); buildDrawer(); switchTab('overview');
      }
    } catch(err) { alert('インポートに失敗しました'); }
  };
  r.readAsText(f); e.target.value = '';
}

// ═══════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════
init();
