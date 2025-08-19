(() => {
  // -------- Utilities --------
  const pad2 = (n) => String(n).padStart(2, '0');
  const formatTime = (ms) => {
    const d = new Date(ms);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  // Wall-clock date key (YYYY-MM-DD) independent of day-boundary setting
  const formatDateWall = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  };
  const formatDate = (ms) => {
    // respect configurable day-boundary hour offset
    const boundaryHour = (typeof settings !== 'undefined' && settings && typeof settings.dayBoundaryHour === 'number') ? settings.dayBoundaryHour : 0;
    const d = new Date(ms - (boundaryHour||0) * 3600000);
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  };
  const formatDuration = (sec) => {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0) return `${h}時間${m}分`;
    if (m > 0) return `${m}分${ss}秒`;
    return `${ss}秒`;
  };
  const startOfDay = (ms) => {
    // start of logical day considering boundary hour
    const boundaryHour = (typeof settings !== 'undefined' && settings && typeof settings.dayBoundaryHour === 'number') ? settings.dayBoundaryHour : 0;
    const off = (boundaryHour||0) * 3600000;
    const d = new Date(ms - off);
    d.setHours(0,0,0,0);
    return d.getTime() + off;
  };
  const startOfWeek = (ms) => {
    const d = new Date(ms);
    const day = (d.getDay()+6)%7; // Monday=0
    d.setHours(0,0,0,0);
    d.setDate(d.getDate()-day);
    return d.getTime();
  };
  const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  // Timeline layout constants (sync with CSS .timeline-axis)
  let TIMELINE_HOUR_PX = 60; // width per hour
  function applyTimelineCssVar() {
    try { document.documentElement.style.setProperty('--hour-px', TIMELINE_HOUR_PX + 'px'); } catch {}
  }

  // -------- Storage --------
  const LS_KEYS = {
    templates: 'taskshoot.templates.v1',
    sessions: 'taskshoot.sessions.v1',
    active: 'taskshoot.active.v1',
    settings: 'taskshoot.settings.v1',
  };
  const readLS = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch { return fallback; }
  };
  const writeLS = (key, val) => localStorage.setItem(key, JSON.stringify(val));

  // -------- State --------
  let templates = readLS(LS_KEYS.templates, []);
  let sessions = readLS(LS_KEYS.sessions, []);
  let active = readLS(LS_KEYS.active, null);
  let settings = readLS(LS_KEYS.settings, { alertAfterMin: 120, plans: [] }); // 長時間アラート/プラン
  // Defaults for new fields
  settings.plans = settings.plans || [];
  if (typeof settings.dayBoundaryHour === 'undefined') settings.dayBoundaryHour = 0;
  if (typeof settings.resumeAfterInterruption === 'undefined') settings.resumeAfterInterruption = null;
  if (typeof settings.bedtime === 'undefined') settings.bedtime = '';
  if (typeof settings.deferResumeOnce === 'undefined') settings.deferResumeOnce = false;
  if (typeof settings.lastQuickMemo === 'undefined') settings.lastQuickMemo = '';
  if (typeof settings.interruptionSuffixMode === 'undefined') settings.interruptionSuffixMode = 'numeric'; // 'numeric' | 'half'
  if (typeof settings.logCollapsed === 'undefined') settings.logCollapsed = {};
  // Sync settings (WebDAV, etc.)
  // WebDAVは未使用のため設定から除去（既存データがあっても無視）
  if (typeof settings.applyBoundaryToPlan === 'undefined') settings.applyBoundaryToPlan = false;
  if (typeof settings.autoDoneOnStop === 'undefined') settings.autoDoneOnStop = false;
  if (typeof settings.autoStartNext === 'undefined') settings.autoStartNext = false; // 停止後に次を自動開始
  if (typeof settings.autoEstimateLearn === 'undefined') settings.autoEstimateLearn = false; // 見積学習ON/OFF
  if (typeof settings.weeklyBackupReminder === 'undefined') settings.weeklyBackupReminder = false; // 週次バックアップ通知
  // Capacity/backup defaults
  if (typeof settings.workStart === 'undefined') settings.workStart = '';
  if (typeof settings.workEnd === 'undefined') settings.workEnd = '';
  if (typeof settings.lunchMin === 'undefined') settings.lunchMin = 0;
  if (typeof settings.autoBackupEnabled === 'undefined') settings.autoBackupEnabled = false;
  if (typeof settings.autoBackupIntervalMin === 'undefined') settings.autoBackupIntervalMin = 60;
  if (typeof settings.lunchStart === 'undefined') settings.lunchStart = '';
  if (typeof settings.lunchEnd === 'undefined') settings.lunchEnd = '';
  if (typeof settings.chainEnabled === 'undefined') settings.chainEnabled = true; // 鎖表示ON/OFF
  if (typeof settings.chainBase === 'undefined') settings.chainBase = 'now'; // 'now' | 'first'
  settings.planSuppressions = settings.planSuppressions || {};
  settings.planSuppressionsWeek = settings.planSuppressionsWeek || {};
  // Persisted notification flags map
  settings._noti = settings._noti || {};

  // -------- Elements --------
  const $ = (sel) => document.querySelector(sel);
  const startStopBtn = $('#startStopBtn');
  const quickNoteBtn = $('#quickNoteBtn');
  const focusBtn = document.querySelector('#focusBtn');
  const taskNameInput = $('#taskNameInput');
  const runningInfo = $('#runningInfo');
  const dayBoundaryInput = document.querySelector('#dayBoundaryInput');
  const addTemplateBtn = $('#addTemplateBtn');
  const templateList = $('#templateList');
  const routineList = document.querySelector('#routineList');
  const exportCsvBtn = $('#exportCsvBtn');
  const exportIcsBtn = document.querySelector('#exportIcsBtn');
  const exportJsonBtn = document.querySelector('#exportJsonBtn');
  const importJsonBtn = document.querySelector('#importJsonBtn');
  const importJsonFile = document.querySelector('#importJsonFile');
  const installBtn = document.querySelector('#installBtn');
  const searchInput = $('#searchInput');
  const logList = $('#logList');
  const rangeSelect = $('#rangeSelect');
  const summaryTotals = $('#summaryTotals');
  const todayTotalEl = $('#todayTotal');
  const nowNextBar = document.querySelector('#nowNextBar');
  const reviewContent = document.querySelector('#reviewContent');
  const reviewWeekContent = document.querySelector('#reviewWeekContent');
  const reviewHistory = document.querySelector('#reviewHistory');
  const reviewMemo = document.querySelector('#reviewMemo');
  const tomorrowNote = document.querySelector('#tomorrowNote');
  const reviewSaveBtn = document.querySelector('#reviewSaveBtn');
  const planList = document.querySelector('#planList');
  const planViewDate = document.querySelector('#planViewDate');
  const planPrevDayBtn = document.querySelector('#planPrevDayBtn');
  const planTodayBtn = document.querySelector('#planTodayBtn');
  const planNextDayBtn = document.querySelector('#planNextDayBtn');
  let planViewDateKey = null; // YYYY-MM-DD or null for today
  const addPlanFreeBtn = document.querySelector('#addPlanFreeBtn');
  const addPlanFromTplBtn = document.querySelector('#addPlanFromTplBtn');
  const focusBreakBtn = document.querySelector('#focusBreakBtn');
  const focusPomodoroBtn = document.querySelector('#focusPomodoroBtn');
  // Template select modal
  const tplSelectBackdrop = document.querySelector('#tplSelectBackdrop');
  const tplSelectList = document.querySelector('#tplSelectList');
  const tplSelectCancelBtn = document.querySelector('#tplSelectCancelBtn');
  const rolloverBtn = document.querySelector('#rolloverBtn');
  const genTomorrowBtn = document.querySelector('#genTomorrowBtn');
  const timelineAxis = document.querySelector('#timelineAxis');
  const timelineRows = document.querySelector('#timelineRows');
  // Track visibility of timeline container precisely
  let timelineVisible = true;
  try {
    if (typeof IntersectionObserver !== 'undefined' && timelineRows) {
      const io = new IntersectionObserver((entries)=>{
        for (const e of entries) {
          if (e.target === timelineRows) timelineVisible = e.isIntersecting;
        }
      }, { root: null, threshold: 0 });
      io.observe(timelineRows);
    }
  } catch {}
  const zoomSelect = document.querySelector('#zoomSelect');
  const prevWeekBtn = document.querySelector('#prevWeekBtn');
  const thisWeekBtn = document.querySelector('#thisWeekBtn');
  const nextWeekBtn = document.querySelector('#nextWeekBtn');
  const icsImportBtn = document.querySelector('#icsImportBtn');
  const icsFileInput = document.querySelector('#icsFileInput');
  const icsTextInput = document.querySelector('#icsTextInput');
  const icsParseBtn = document.querySelector('#icsParseBtn');
  const toast = document.querySelector('#toast');
  // WebDAV sync elements
  // WebDAV UI要素は削除
  // Dashboard elements
  const dashboardContent = document.querySelector('#dashboardContent');
  const dashRangeSelect = document.querySelector('#dashRangeSelect');
  const dashTabTag = document.querySelector('#dashTabTag');
  const dashTabTpl = document.querySelector('#dashTabTpl');
  const dashTabAccuracy = document.querySelector('#dashTabAccuracy');
  const dashTabHeatTpl = document.querySelector('#dashTabHeatTpl');
  const dashTabHeatTag = document.querySelector('#dashTabHeatTag');
  let dashTab = 'tag';

  const toastMsg = document.querySelector('#toastMsg');
  const toastUndoBtn = document.querySelector('#toastUndoBtn');
  const toastRetryBtn = document.querySelector('#toastRetryBtn');
  const toastDetailBtn = document.querySelector('#toastDetailBtn');
  const logDetailBackdrop = document.querySelector('#logDetailBackdrop');
  const logDetailText = document.querySelector('#logDetailText');
  const logDetailCloseBtn = document.querySelector('#logDetailCloseBtn');
  const logDetailCopyBtn = document.querySelector('#logDetailCopyBtn');
  const logDetailSelectBtn = document.querySelector('#logDetailSelectBtn');
  const logDetailExpandBtn = document.querySelector('#logDetailExpandBtn');
  if (logDetailCloseBtn && logDetailBackdrop) {
    logDetailCloseBtn.addEventListener('click', ()=> logDetailBackdrop.classList.add('hidden'));
    logDetailBackdrop.addEventListener('click', (e)=>{ if (e.target===logDetailBackdrop) logDetailBackdrop.classList.add('hidden'); });
  }
  if (logDetailCopyBtn && logDetailText) {
    logDetailCopyBtn.addEventListener('click', async ()=>{
      try { await navigator.clipboard.writeText(logDetailText.value||''); alert('コピーしました'); } catch { try { logDetailText.select(); document.execCommand('copy'); alert('コピーしました'); } catch {} }
    });
  }
  if (logDetailSelectBtn && logDetailText) {
    logDetailSelectBtn.addEventListener('click', ()=>{ try { logDetailText.focus(); logDetailText.select(); } catch {} });
  }
  if (logDetailExpandBtn) {
    logDetailExpandBtn.addEventListener('click', ()=>{
      const modal = logDetailBackdrop && logDetailBackdrop.querySelector('.modal');
      if (modal) modal.classList.toggle('expanded');
    });
  }
  let lastAction = null; // { type, payload }

  // Modal
  const backdrop = $('#modalBackdrop');
  const tagsInput = $('#tagsInput');
  const noteInput = $('#noteInput');
  const stopEstimateInfo = document.querySelector('#stopEstimateInfo');
  const stopPlanActionRadios = () => Array.from(document.querySelectorAll('input[name="stopPlanAction"]'));
  const modalSaveBtn = $('#modalSaveBtn');
  const modalCancelBtn = $('#modalCancelBtn');
  // Quick start link modal
  const quickStartBackdrop = document.querySelector('#quickStartBackdrop');
  const qsNameInput = document.querySelector('#qsNameInput');
  const qsEstSelect = document.querySelector('#qsEstSelect');
  const qsEstCustom = document.querySelector('#qsEstCustom');
  const qsTagsInput = document.querySelector('#qsTagsInput');
  const qsSaveBtn = document.querySelector('#qsSaveBtn');
  const qsSkipBtn = document.querySelector('#qsSkipBtn');
  // Focus overlay elements
  const focusOverlay = document.querySelector('#focusOverlay');
  const focusCloseBtn = document.querySelector('#focusCloseBtn');
  const focusStopBtn = document.querySelector('#focusStopBtn');
  const focusMemoBtn = document.querySelector('#focusMemoBtn');
  const focusInterruptBtn = document.querySelector('#focusInterruptBtn');
  const focusTaskName = document.querySelector('#focusTaskName');
  const focusTimer = document.querySelector('#focusTimer');
  const focusSuggestions = document.querySelector('#focusSuggestions');
  const pomodoroCountdown = document.querySelector('#pomodoroCountdown');
  const focusExtendBtn = document.querySelector('#focusExtendBtn');
  // Log edit modal elements
  const logEditBackdrop = document.querySelector('#logEditBackdrop');
  const logEditName = document.querySelector('#logEditName');
  const logEditStart = document.querySelector('#logEditStart');
  const logEditEnd = document.querySelector('#logEditEnd');
  const logEditTags = document.querySelector('#logEditTags');
  const logEditNote = document.querySelector('#logEditNote');
  const logEditCancelBtn = document.querySelector('#logEditCancelBtn');
  const logEditSaveBtn = document.querySelector('#logEditSaveBtn');
  // For focus return scroll
  let lastFocusPlanId = null;
  // Plan edit modal elements
  const planEditBackdrop = document.querySelector('#planEditBackdrop');
  const planNameInput = document.querySelector('#planNameInput');
  const planDateInput = document.querySelector('#planDateInput');
  const planTimeTime = document.querySelector('#planTimeTime');
  const planEstSelect = document.querySelector('#planEstSelect');
  const planEstCustom = document.querySelector('#planEstCustom');
  const planEditCancelBtn = document.querySelector('#planEditCancelBtn');
  const planEditSaveBtn = document.querySelector('#planEditSaveBtn');
  let planEditTargetId = null;
  let planEditMode = 'edit'; // 'edit' | 'create'
  // Routine edit modal elements
  const routineEditBackdrop = document.querySelector('#routineEditBackdrop');
  const routineNameInput = document.querySelector('#routineNameInput');
  const routineDaysWrap = document.querySelector('#routineDays');
  const routineTimeTime = document.querySelector('#routineTimeTime');
  const routineEstSelect = document.querySelector('#routineEstSelect');
  const routineEstCustom = document.querySelector('#routineEstCustom');
  const routineWeeklyTarget = document.querySelector('#routineWeeklyTarget');
  const routineMonthlyTarget = document.querySelector('#routineMonthlyTarget');
  const routineTagsInput = document.querySelector('#routineTagsInput');
  const routineEditCancelBtn = document.querySelector('#routineEditCancelBtn');
  const routineEditSaveBtn = document.querySelector('#routineEditSaveBtn');
  let routineEditTargetId = null;
  let routineEditMode = 'edit'; // 'edit' | 'create'

  // -------- Logic --------
  function persistAll() {
    writeLS(LS_KEYS.templates, templates);
    writeLS(LS_KEYS.sessions, sessions);
    writeLS(LS_KEYS.active, active);
    writeLS(LS_KEYS.settings, settings);
    try { idbMirrorDebounced(); } catch {}
  }

  // Boundary-aware plan date key helper
  function getPlanDateKey(ms) {
    const t = typeof ms === 'number' ? ms : Date.now();
    return settings.applyBoundaryToPlan ? formatDate(t) : formatDateWall(t);
  }

  function isRunning() { return !!active; }

  function startTask({ name, templateId, planId }) {
    if (isRunning()) {
      const ok = confirm('実行中のタスクを停止して切り替えますか？');
      if (!ok) return;
      // タグ/メモ入力はスキップして即停止
      confirmStopTask({ tags: [], note: '' });
    }
    const template = templateId ? templates.find(t => t.id === templateId) : null;
    const taskName = name || (template ? template.name : '無題');
    // ルーチン（templateIdあり）は今日のプランに存在してから開始する
    if (templateId) {
      const todayKey = getPlanDateKey(Date.now());
      const exists = (settings.plans||[]).some(p=>p.date===todayKey && p.templateId===templateId);
      if (!exists) {
        addPlanItem({ name: taskName, templateId, estimateMin: template?.targetDailyMin||0, scheduledAt: template?.timeOfDay||'' });
      }
    }
    active = {
      id: uuid(),
      templateId: template ? template.id : null,
      name: taskName,
      startAt: Date.now(),
      planId: planId || null,
      meta: {}
    };
    persistAll();
    render();
    if (typeof openFocus === 'function') openFocus();
  }

  // Quick Start (ad-hoc) modal helpers
  let pendingQuickStartName = '';
  function openQuickStart(name) {
    if (!quickStartBackdrop) { startTask({ name, templateId: null, planId: null }); return; }
    pendingQuickStartName = (name||'').trim();
    if (qsNameInput) qsNameInput.value = pendingQuickStartName;
    buildEstOptions(qsEstSelect); if (qsEstSelect) qsEstSelect.value = '0';
    if (qsEstSelect && qsEstCustom) {
      const sync = ()=> { qsEstCustom.style.display = (qsEstSelect.value==='custom') ? 'block' : 'none'; };
      qsEstSelect.onchange = sync; sync();
    }
    if (qsTagsInput) qsTagsInput.value='';
    quickStartBackdrop.classList.remove('hidden');
    // Focus trap: move focus into modal
    try { (qsNameInput||qsSaveBtn||qsSkipBtn)?.focus(); } catch {}
  }

  function stopTaskWithModal() {
    if (!isRunning()) return;
    // 初期値：テンプレのデフォルトタグ
    const defaults = (active.templateId ? (templates.find(t=>t.id===active.templateId)?.defaultTags||[]) : (active.meta?.quickDefaultTags||[]));
    tagsInput.value = defaults.join(', ');
    noteInput.value = '';
    // 推定: 対応プランの見積/実績/差分を警告表示
    if (stopEstimateInfo) {
      // Use boundary-aware key when applicable
    const todayKey = getPlanDateKey(Date.now());
      const plan = (settings.plans||[]).find(p=>p.date===todayKey && ((active.planId && p.id===active.planId) || (active.templateId && p.templateId===active.templateId) || p.name===active.name));
      if (plan && plan.estimateMin) {
        // Use boundary-aware start of logical day
        const from = startOfDay(Date.now());
        const todayLogs = sessions.filter(s=>s.startAt >= from);
        let spent = todayLogs.filter(s=>s.planId===plan.id).reduce((sum,s)=>sum+s.durationSec,0);
        if (spent===0 && plan.templateId) spent = todayLogs.filter(s=>s.templateId===plan.templateId).reduce((sum,s)=>sum+s.durationSec,0);
        const elapsed = Math.floor((Date.now()-active.startAt)/1000);
        const totalSec = spent + elapsed;
        const diffMin = Math.round(totalSec/60) - plan.estimateMin;
        const sign = diffMin>=0?'+':'';
        stopEstimateInfo.textContent = `見積 ${plan.estimateMin}分 / 停止後実績見込み ${Math.round(totalSec/60)}分 (${sign}${diffMin}分)`;
      } else {
        stopEstimateInfo.textContent = '';
      }
    }
    backdrop.classList.remove('hidden');
    noteInput.focus();
  }

  function confirmStopTask({ tags, note, completePlan }) {
    if (!isRunning()) return;
    const current = active;
    const endAt = Date.now();
    const durationSec = Math.max(1, Math.floor((endAt - current.startAt) / 1000));
    const noteAll = [current.meta?.quickNote, note].filter(Boolean).join('\n');
    const log = {
      id: current.id,
      name: current.name,
      startAt: current.startAt,
      endAt,
      durationSec,
      tags: (tags||[]).filter(Boolean),
      note: noteAll,
      templateId: current.templateId || null,
      planId: current.planId || null
    };
    sessions.push(log);
    // 割り込みグループのメタがあればログに付与
    if (current && current.meta) {
      if (current.meta.interruptGroupId && !log.interruptGroupId) {
        log.interruptGroupId = current.meta.interruptGroupId;
        log.segmentIndex = current.meta.segmentIndex || 1;
      }
    }
    // optional: auto-complete corresponding plan
    if (completePlan || settings.autoDoneOnStop) {
      const pid = current.planId;
      if (pid) {
        const it = (settings.plans||[]).find(p=>p.id===pid);
        if (it) it.status = 'done';
      } else {
        const todayKey = getPlanDateKey(Date.now());
        const it = (settings.plans||[]).find(p=>p.date===todayKey && ((current.templateId && p.templateId===current.templateId) || p.name===current.name));
        if (it) it.status = 'done';
      }
    }
    active = null;
    persistAll();
    if (typeof closeFocus === 'function') closeFocus();
    // 見積学習: 対応プラン/テンプレの見積・目標をEMWAで微調整（5分単位、オプション）
    try {
      if (settings.autoEstimateLearn) {
        // 学習対象のプランを壁時計今日から探索
      const todayKey = getPlanDateKey(Date.now());
        const plan = (settings.plans||[]).find(p=> p.date===todayKey && ((current.planId && p.id===current.planId) || (current.templateId && p.templateId===current.templateId) || p.name===current.name));
        if (plan) {
          const actualMin = Math.max(1, Math.round(durationSec/60));
          const old = Math.max(0, plan.estimateMin||0);
          const alpha = 0.3; // 学習率
          const raw = Math.round(alpha*actualMin + (1-alpha)*old);
          const snapped = Math.max(0, Math.round(raw/5)*5); // 5分単位
          if (snapped !== old) { plan.estimateMin = snapped; }
          // テンプレ目標も更新（あれば）
          if (plan.templateId) {
            const t = templates.find(t=>t.id===plan.templateId);
            if (t) {
              const told = Math.max(0, t.targetDailyMin||0);
              const traw = Math.round(alpha*actualMin + (1-alpha)*told);
              const tsnapped = Math.max(0, Math.round(traw/5)*5);
              if (tsnapped !== told) t.targetDailyMin = tsnapped;
            }
          }
          persistAll();
        }
      }
    } catch {}
    // 割り込みからの復帰処理（割り込みタスクの停止時のみ）
    const resume = settings.resumeAfterInterruption;
    if (resume && resume.groupId && resume.interruptSessionId && log.id === resume.interruptSessionId) {
      const mode = settings.interruptionSuffixMode || 'numeric';
      let resumeName = resume.baseName;
      if (mode === 'numeric') {
        resumeName = `${resume.baseName} #${resume.nextIndex || 2}`;
      } else {
        resumeName = (resume.nextIndex || 2) === 2 ? `${resume.baseName} 後半` : `${resume.baseName} #${resume.nextIndex}`;
      }
      // 一度復帰したら連鎖防止のためクリア
      settings.resumeAfterInterruption = null;
      persistAll();
      startTask({ name: resumeName, templateId: resume.templateId || null, planId: null });
      // 復帰セッションにもメタを付けておく（停止時にログへ転記）
      if (active) {
        active.meta = active.meta || {};
        active.meta.interruptGroupId = resume.groupId;
        active.meta.segmentIndex = (resume.nextIndex || 2);
      }
      if (typeof openFocus === 'function') openFocus();
      return;
    }
    // 自動次開始（オプション）: 今日のプランからNextを特定し、自動開始
    try {
      if (settings.autoStartNext) {
        const baseKey = getPlanDateKey(Date.now());
        const sameAsStopped = (p)=>{
          if (current.planId && p.id === current.planId) return true;
          if (!current.planId && current.templateId && p.templateId === current.templateId) return true;
          if (!current.planId && !current.templateId && p.name === current.name) return true;
          return false;
        };
        const list = (settings.plans||[])
          .filter(p=>p.date===baseKey && p.status!=='done')
          .filter(p=> !sameAsStopped(p));
        const timeTs = (p) => {
          if (!p.scheduledAt) return Number.POSITIVE_INFINITY;
          const [hh, mm] = String(p.scheduledAt).split(':').map(x=>parseInt(x||'0',10));
          const d = new Date(); d.setHours(hh||0, mm||0, 0, 0); return d.getTime();
        };
        // 直前に停止した対象を除外した上で次の1件
        const ordered = [...list].sort((a,b)=> timeTs(a)-timeTs(b));
        const next = ordered[0];
        if (next) {
          const name = next.name || (next.templateId ? (templates.find(t=>t.id===next.templateId)?.name||'無題') : '無題');
          startTask({ name, templateId: next.templateId||null, planId: next.id });
        }
      }
    } catch {}
    render();
  }

  function deleteLog(id) {
    const s = sessions.find(x=>x.id===id);
    sessions = sessions.filter(x => x.id !== id);
    // track deletion for IDB diff sync
    settings._deleted = settings._deleted || {}; settings._deleted.sessions = settings._deleted.sessions || [];
    settings._deleted.sessions.push(id);
    persistAll();
    render();
    showUndo && showUndo({ type:'deleteLog', payload: s });
  }

  function addTemplateFlow() {
    const name = prompt('ルーチン名');
    if (!name) return;
    const daysStr = prompt('曜日（例: 毎 / 月火水木金 / 月水金）', '毎');
    const routineDays = parseDays(daysStr||'');
    const timeOfDay = prompt('予定時刻（HH:MM、任意）', '') || '';
    const targetDailyMin = parseInt(prompt('目標分（任意、数字のみ）', '0')||'0', 10) || 0;
    const tagStr = prompt('デフォルトタグ（, 区切り 任意）') || '';
    const defaultTags = tagStr.split(',').map(s=>s.trim()).filter(Boolean);
    const color = randomColor();
    templates.push({ id: uuid(), name, defaultTags, color, isRoutine: true, routineDays, timeOfDay, targetDailyMin });
    persistAll();
    renderTemplates();
    renderRoutines();
  }

  function parseDays(input) {
    if (!input) return [];
    const map = { '月':0,'火':1,'水':2,'木':3,'金':4,'土':5,'日':6 };
    if (input.includes('毎')) return [0,1,2,3,4,5,6];
    const arr = [];
    for (const ch of input.split('')) { if (map[ch] != null) arr.push(map[ch]); }
    return Array.from(new Set(arr));
  }

  function randomColor() {
    const colors = ['#f87171','#fb923c','#fbbf24','#34d399','#60a5fa','#a78bfa','#f472b6','#22d3ee'];
    return colors[Math.floor(Math.random()*colors.length)];
  }

  function exportCsv() {
    const header = ['id','name','startAt','endAt','durationSec','tags','note','templateId','planId'];
    const rows = sessions.map(s => [
      s.id,
      csvEscape(s.name),
      new Date(s.startAt).toISOString(),
      new Date(s.endAt).toISOString(),
      s.durationSec,
      csvEscape((s.tags||[]).join('|')),
      csvEscape(s.note||''),
      s.templateId || '',
      s.planId || ''
    ]);
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    shareOrDownload('text/csv', `taskshoot_${getPlanDateKey(Date.now())}.csv`, blob);
  }
  function csvEscape(s) {
    if (s == null) return '';
    const str = String(s);
    if (/[",\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  // -------- Rendering --------
  // Restore full rendering since plan/routine/timeline/modal are back
  function render() {
    renderControls();
    renderTemplates();
    renderPlan();
    // Keep Now/Next bar in sync even if planViewDateKey changes during render
    try {
      if (nowNextBar && !planViewDateKey) {
        const todayKey = getPlanDateKey(Date.now());
        const todays = (settings.plans||[]).filter(p=>p.date===todayKey);
        renderNowNextBar(todays);
      }
    } catch {}
    renderRoutines();
    renderSummary();
    renderDashboard();
    renderLogs();
    renderTimeline();
    renderReview();
    renderWeekReview();
    renderReviewHistory();
  }

  // Timeline uses wall-clock midnight (ignore configurable day-boundary)
  function startOfWeekWallclock(ms) {
    const d = new Date(ms);
    const day = (d.getDay()+6)%7; // Monday=0
    d.setHours(0,0,0,0);
    d.setDate(d.getDate()-day);
    return d.getTime();
  }
  let timelineStart = startOfWeekWallclock(Date.now());
  function renderTimeline() {
    if (!timelineAxis || !timelineRows) return;
    // Axis header
    timelineAxis.innerHTML = '';
    const axisLabel = document.createElement('div'); axisLabel.className='label'; axisLabel.textContent='日/時'; timelineAxis.appendChild(axisLabel);
    for (let h=0; h<24; h++) { const c=document.createElement('div'); c.className='cell'; c.textContent=String(h).padStart(2,'0'); timelineAxis.appendChild(c); }
    // Rows for 7 days
    timelineRows.innerHTML = '';
    for (let d=0; d<7; d++) {
      const dayStart = timelineStart + d*24*3600*1000;
      const dayEnd = dayStart + 24*3600*1000;
      const row = document.createElement('div'); row.className='timeline-row';
      const label = document.createElement('div'); label.className='label'; const dt=new Date(dayStart); label.textContent=`${dt.getMonth()+1}/${dt.getDate()}`; row.appendChild(label);
      const track = document.createElement('div'); track.className='track';
      track.style.width = (24 * TIMELINE_HOUR_PX) + 'px';
      // Now line
      const now = Date.now();
      if (now >= dayStart && now < dayEnd) {
        const hourMs = 3600000;
        const leftPxNow = ((now - dayStart) / hourMs) * TIMELINE_HOUR_PX;
        const nl = document.createElement('div'); nl.className='now-line'; nl.style.left = leftPxNow + 'px';
        track.appendChild(nl);
      }
      const logs = sessions.filter(s=> s.startAt<dayEnd && s.endAt>dayStart);
      const palette = ['#93c5fd','#fde68a','#86efac','#fca5a5','#f0abfc','#67e8f9','#c4b5fd'];
      const colorFor = (name) => { let h=0; for (let i=0;i<name.length;i++) h=(h*31+name.charCodeAt(i))>>>0; return palette[h%palette.length]; };
      for (const s of logs) {
        const st = Math.max(s.startAt, dayStart);
        const en = Math.min(s.endAt, dayEnd);
        const hourMs = 3600000;
        const leftPx = ((st - dayStart) / hourMs) * TIMELINE_HOUR_PX;
        const widthPx = Math.max(1, ((en - st) / hourMs) * TIMELINE_HOUR_PX);
        const block = document.createElement('div'); block.className='block';
        block.style.left = leftPx + 'px';
        block.style.width = widthPx + 'px';
        const color = colorFor(s.name||'無題');
        block.style.background = color;
        block.style.borderColor = '#0b1226';
        block.title = `${formatTime(s.startAt)}-${formatTime(s.endAt)} ${s.name} (${formatDuration(s.durationSec)})`;
        block.textContent = s.name;
        // Drag resize disabled by design to avoid accidental edits
        track.appendChild(block);
      }
      row.appendChild(track);
      timelineRows.appendChild(row);
    }
  }

  // Note: Mobile timeline UI removed in this build to avoid null refs

  function renderPlan() {
    if (!planList) return;
    const baseKey = planViewDateKey || getPlanDateKey(Date.now());
    settings.plans = settings.plans || [];
    // 自動注入は「今日」のみ対象
    if (!planViewDateKey) ensureTodayRoutinesInPlan();
    let list = settings.plans.filter(p => p.date === baseKey);
    // ---- Chained schedule (TaskChute) calculation for the day ----
    function computeChainedScheduleForDate(listForDate, dateKey) {
      const now = Date.now();
      const dayStart = new Date(dateKey + 'T00:00').getTime();
      const dayEnd = dayStart + 24*3600*1000;
      const dayLogs = sessions.filter(s => s.startAt >= dayStart && s.startAt < dayEnd);
      const spentByPlan = new Map();
      const spentByTpl = new Map();
      for (const s of dayLogs) {
        if (s.planId) spentByPlan.set(s.planId, (spentByPlan.get(s.planId)||0) + s.durationSec);
        if (s.templateId) spentByTpl.set(s.templateId, (spentByTpl.get(s.templateId)||0) + s.durationSec);
      }
      const isSameAsActive = (p)=> {
        if (!isRunning()) return false;
        if (active.planId && p.id === active.planId) return true;
        if (!active.planId && active.templateId && p.templateId && active.templateId === p.templateId) return true;
        if (!active.planId && !active.templateId && p.name === active.name) return true;
        return false;
      };
      const schedMsOf = (p)=>{
        if (!p.scheduledAt) return null;
        const [hh, mm] = String(p.scheduledAt).split(':').map(x=>parseInt(x||'0',10));
        if (Number.isNaN(hh)) return null;
        const d = new Date(dayStart); d.setHours(hh||0, mm||0, 0, 0); return d.getTime();
      };
      // Sort by scheduled time then explicit order (list is already sorted similarly below, but ensure local determinism)
      const timeTs = (p)=>{ const t = schedMsOf(p); return (t==null)? Number.POSITIVE_INFINITY : t; };
      const ordered = [...listForDate].sort((a,b)=>{ const ta=timeTs(a), tb=timeTs(b); if (ta!==tb) return ta-tb; return (a.order||0)-(b.order||0); });
      // decide base cursor
      let cursor = now;
      if (settings.chainBase === 'first') {
        const firstSched = ordered
          .filter(p=> (p.status||'todo')!=='done' && (p.estimateMin||0)>0)
          .map(p=> schedMsOf(p))
          .filter(v=> v!=null)
          .sort((a,b)=> a-b)[0];
        if (Number.isFinite(firstSched)) cursor = Math.max(now, firstSched);
      }
      const out = new Map();
      let lastEnd = now;
      for (const p of ordered) {
        const status = p.status || 'todo';
        const estMin = Math.max(0, p.estimateMin||0);
        if (status === 'done' || estMin === 0) { out.set(p.id, { plannedStart: null, plannedEnd: null, remainingMs: 0 }); continue; }
        let spentSec = spentByPlan.get(p.id)||0;
        if (spentSec === 0 && p.templateId) spentSec = spentByTpl.get(p.templateId)||0;
        let remainingMs = Math.max(0, estMin*60000 - spentSec*1000);
        if (isSameAsActive(p)) {
          const elapsedMs = Math.max(0, Date.now() - active.startAt);
          remainingMs = Math.max(0, remainingMs - elapsedMs);
          if (cursor < now) cursor = now;
          const ps = now;
          const pe = ps + remainingMs;
          out.set(p.id, { plannedStart: ps, plannedEnd: pe, remainingMs });
          cursor = pe; lastEnd = pe; continue;
        }
        // For others, earliest start respects scheduledAt if later than cursor
        const sched = schedMsOf(p);
        const ps = Math.max(cursor, (sched!=null? sched : cursor));
        const pe = ps + remainingMs;
        out.set(p.id, { plannedStart: ps, plannedEnd: pe, remainingMs });
        cursor = pe; lastEnd = pe;
      }
      return { map: out, chainEnd: lastEnd };
    }
    const timeTs = (p) => {
      if (!p.scheduledAt) return Number.POSITIVE_INFINITY;
      const [hh, mm] = String(p.scheduledAt).split(':').map(x=>parseInt(x||'0',10));
      const d = new Date(); d.setHours(hh||0, mm||0, 0, 0); return d.getTime();
    };
    list.sort((a,b)=> {
      const ta = timeTs(a), tb = timeTs(b);
      if (ta !== tb) return ta - tb;
      return (a.order||0) - (b.order||0);
    });
    // 次の予定（時系列で未来最速）を決定（ハイライトのみ、順序は維持）
    const isNowPlan = (p, name) => isRunning() && ((p.templateId && active.templateId && p.templateId===active.templateId) || name===active.name);
    const nextPlan = list
      .map(p=>({ p, ts: timeTs(p) }))
      .filter(x=> x.p.status!=='done' && x.ts >= Date.now())
      .sort((a,b)=> a.ts - b.ts)[0]?.p;
    planList.innerHTML = '';
    if (!planViewDateKey && nowNextBar) renderNowNextBar(list);
    if (list.length === 0) {
      const d = document.createElement('div'); d.className='meta'; d.textContent=(planViewDateKey? `${baseKey} のプランは未設定`:'今日のプランは未設定'); planList.appendChild(d); return;
    }
    // spent aggregation uses wall-clock today range
    const wallFrom = (()=>{ if (!planViewDateKey) { const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); } const d=new Date(baseKey+'T00:00'); return d.getTime(); })();
    const wallTo = wallFrom + 24*3600*1000;
    const todayLogs = sessions.filter(s => s.startAt >= wallFrom && s.startAt < wallTo);
    // Precompute chained schedule for this date
    const chain = settings.chainEnabled ? computeChainedScheduleForDate(list, baseKey) : { map: new Map(), chainEnd: null };
    // Split and render: unscheduled first, then scheduled
    const unscheduled = list.filter(p=>!p.scheduledAt);
    const scheduled = list.filter(p=>p.scheduledAt);
    if (unscheduled.length>0) {
      const h = document.createElement('div'); h.className='label'; h.textContent='予定なし'; planList.appendChild(h);
      for (const p of unscheduled) {
        const row = document.createElement('div'); row.className='plan-item';
        row.setAttribute('draggable','true');
        row.dataset.planId = p.id;
        const left = document.createElement('div'); left.className='plan-left-scroll';
        const status = p.status || 'todo';
        const tpl = p.templateId ? templates.find(t=>t.id===p.templateId) : null;
        const name = p.name || tpl?.name || '無題';
        let spent = todayLogs.filter(s=>s.planId===p.id).reduce((sum,s)=>sum+s.durationSec,0);
        if (spent===0 && p.templateId) spent = todayLogs.filter(s=>s.templateId===p.templateId).reduce((sum,s)=>sum+s.durationSec,0);
        const est = p.estimateMin ? `${p.estimateMin}分` : '-';
        // Chained schedule meta
        let chainText = '';
        const ch = chain.map.get(p.id);
        if (settings.chainEnabled && ch && ch.plannedEnd && ch.remainingMs>0) {
          const s = new Date(ch.plannedStart); const e = new Date(ch.plannedEnd);
          chainText = `鎖 ${pad2(s.getHours())}:${pad2(s.getMinutes())}→${pad2(e.getHours())}:${pad2(e.getMinutes())}`;
        }
        const meta = [`見積 ${est}`, chainText, spent?`実績 ${formatDuration(spent)}`:''].filter(Boolean).join(' · ');
        // Over-estimate highlighting
        if ((p.estimateMin||0) > 0 && spent > (p.estimateMin||0)*60) {
          row.classList.add('over-estimate');
        }
        const isNow = isNowPlan(p, name);
        const isNext = nextPlan && nextPlan.id === p.id;
        if (isNow) row.classList.add('now');
        let delayBadge = '';
        try {
          const chx = settings.chainEnabled ? chain.map.get(p.id) : null;
          if (settings.chainEnabled && chx && chx.plannedStart && chx.remainingMs>0) {
            if (isNow && isRunning()) {
              const deltaMin = Math.round((active.startAt - chx.plannedStart)/60000);
              if (deltaMin > 0) delayBadge = '<span class="badge danger">遅れ +' + deltaMin + '分</span>';
              else if (deltaMin < 0) delayBadge = '<span class="badge ok">先行 ' + Math.abs(deltaMin) + '分</span>';
            } else {
              const deltaMin = Math.round((Date.now() - chx.plannedStart)/60000);
              if (deltaMin > 0) delayBadge = '<span class="badge danger">遅れ +' + deltaMin + '分</span>';
            }
          }
        } catch {}
        left.innerHTML = `<div class="inner"><div><strong>${escapeHtml(name)}</strong> ${isNow?'<span class=\"badge run\">Now</span>':''} ${(!isNow && isNext)?'<span class=\"badge next\">Next</span>':''} ${status==='done'?'<span class=\"badge ok\">完了</span>':''} ${delayBadge}</div><div class=\"meta\">${meta}</div></div>`;
        const right = document.createElement('div'); right.className='plan-actions';
        const startBtn = document.createElement('button'); startBtn.className='btn'; startBtn.textContent='開始'; startBtn.disabled = !!planViewDateKey; startBtn.title = planViewDateKey? '過去/未来日は開始不可':'開始'; startBtn.onclick=()=>{ if (planViewDateKey) return; lastFocusPlanId = p.id; startTask({ name, templateId: p.templateId||null, planId: p.id }); };
        const skipBtn = document.createElement('button'); skipBtn.className='btn'; skipBtn.textContent='スキップ'; skipBtn.onclick=()=>skipPlan(p.id);
        const editBtn = document.createElement('button'); editBtn.className='btn'; editBtn.textContent='編集'; editBtn.onclick=()=>editPlan(p.id);
        const doneBtn = document.createElement('button'); doneBtn.className='btn'; doneBtn.textContent='完了'; doneBtn.onclick=()=>completePlan(p.id);
        const shrinkBtn = document.createElement('button'); shrinkBtn.className='btn'; shrinkBtn.textContent='短縮(-5)'; shrinkBtn.onclick=()=>adjustPlanEstimate(p.id, -5);
        const splitBtn = document.createElement('button'); splitBtn.className='btn'; splitBtn.textContent='分割'; splitBtn.onclick=()=>splitPlanRemaining(p.id);
        const delBtn = document.createElement('button'); delBtn.className='btn'; delBtn.textContent='削除'; delBtn.onclick=()=>deletePlan(p.id);
        right.append(startBtn, skipBtn, editBtn, doneBtn, shrinkBtn, splitBtn, delBtn);
        row.append(left, right); planList.appendChild(row);
      }
    }
    for (const p of scheduled) {
      const row = document.createElement('div'); row.className='plan-item';
      row.setAttribute('draggable','true');
      row.dataset.planId = p.id;
      const left = document.createElement('div');
      left.className = 'plan-left-scroll';
      const status = p.status || 'todo';
      const tpl = p.templateId ? templates.find(t=>t.id===p.templateId) : null;
      const name = p.name || tpl?.name || '無題';
      let spent = todayLogs.filter(s=>s.planId===p.id).reduce((sum,s)=>sum+s.durationSec,0);
      if (spent===0 && p.templateId) spent = todayLogs.filter(s=>s.templateId===p.templateId).reduce((sum,s)=>sum+s.durationSec,0);
      const est = p.estimateMin ? `${p.estimateMin}分` : '-';
      const sched = p.scheduledAt ? `予定 ${p.scheduledAt}` : '';
      // Chained schedule meta
      let chainText = '';
      const ch = chain.map.get(p.id);
      if (settings.chainEnabled && ch && ch.plannedEnd && ch.remainingMs>0) {
        const s = new Date(ch.plannedStart); const e = new Date(ch.plannedEnd);
        chainText = `鎖 ${pad2(s.getHours())}:${pad2(s.getMinutes())}→${pad2(e.getHours())}:${pad2(e.getMinutes())}`;
      }
      const meta = [sched, `見積 ${est}`, chainText, spent?`実績 ${formatDuration(spent)}`:''].filter(Boolean).join(' · ');
      if ((p.estimateMin||0) > 0 && spent > (p.estimateMin||0)*60) {
        row.classList.add('over-estimate');
      }
      const isNow = isNowPlan(p, name);
      const isNext = nextPlan && nextPlan.id === p.id;
      if (isNow) row.classList.add('now');
      let delayBadge2 = '';
      try {
        const chy = settings.chainEnabled ? chain.map.get(p.id) : null;
        if (settings.chainEnabled && chy && chy.plannedStart && chy.remainingMs>0) {
          if (isNow && isRunning()) {
            const deltaMin = Math.round((active.startAt - chy.plannedStart)/60000);
            if (deltaMin > 0) delayBadge2 = '<span class="badge danger">遅れ +' + deltaMin + '分</span>';
            else if (deltaMin < 0) delayBadge2 = '<span class="badge ok">先行 ' + Math.abs(deltaMin) + '分</span>';
          } else {
            const deltaMin = Math.round((Date.now() - chy.plannedStart)/60000);
            if (deltaMin > 0) delayBadge2 = '<span class="badge danger">遅れ +' + deltaMin + '分</span>';
          }
        }
      } catch {}
      left.innerHTML = `<div class="inner"><div><strong>${escapeHtml(name)}</strong> ${isNow?'<span class=\"badge run\">Now</span>':''} ${(!isNow && isNext)?'<span class=\"badge next\">Next</span>':''} ${status==='done'?'<span class=\"badge ok\">完了</span>':''} ${delayBadge2}</div>`+
        `<div class=\"meta\">${meta}</div></div>`;
      const right = document.createElement('div'); right.className='plan-actions';
      if (p.scheduledAt) {
        const [hh, mm] = p.scheduledAt.split(':').map(x=>parseInt(x||'0',10));
        if (!Number.isNaN(hh)) {
          const d = new Date(); d.setHours(hh, mm||0, 0, 0);
          if (Date.now() > d.getTime() && status !== 'done') row.classList.add('overdue');
        }
      }
      const startBtn = document.createElement('button'); startBtn.className='btn'; startBtn.textContent='開始'; startBtn.disabled = !!planViewDateKey; startBtn.title = planViewDateKey? '過去/未来日は開始不可':'開始'; startBtn.onclick=()=>{ if (planViewDateKey) return; lastFocusPlanId = p.id; startTask({ name, templateId: p.templateId||null, planId: p.id }); };
      const skipBtn = document.createElement('button'); skipBtn.className='btn'; skipBtn.textContent='スキップ'; skipBtn.onclick=()=>skipPlan(p.id);
      const editBtn = document.createElement('button'); editBtn.className='btn'; editBtn.textContent='編集'; editBtn.onclick=()=>editPlan(p.id);
      const doneBtn = document.createElement('button'); doneBtn.className='btn'; doneBtn.textContent='完了'; doneBtn.onclick=()=>completePlan(p.id);
      const shrinkBtn = document.createElement('button'); shrinkBtn.className='btn'; shrinkBtn.textContent='短縮(-5)'; shrinkBtn.onclick=()=>adjustPlanEstimate(p.id, -5);
      const splitBtn = document.createElement('button'); splitBtn.className='btn'; splitBtn.textContent='分割'; splitBtn.onclick=()=>splitPlanRemaining(p.id);
      const delBtn = document.createElement('button'); delBtn.className='btn'; delBtn.textContent='削除'; delBtn.onclick=()=>deletePlan(p.id);
      right.append(startBtn, skipBtn, editBtn, doneBtn, shrinkBtn, splitBtn, delBtn);
      row.appendChild(left); row.appendChild(right);
      planList.appendChild(row);
    }
    // enable drag-and-drop reordering of plan rows
    enablePlanDnd();
    enableTouchReorder();
  }


  function renderNowNextBar(list) {
    if (!nowNextBar) return;
    nowNextBar.innerHTML = '';
    const timeTs = (p) => {
      if (!p.scheduledAt) return Number.POSITIVE_INFINITY;
      const [hh, mm] = String(p.scheduledAt).split(':').map(x=>parseInt(x||'0',10));
      const d = new Date(); d.setHours(hh||0, mm||0, 0, 0); return d.getTime();
    };
    const ordered = [...list].filter(p=>p.status!=='done').sort((a,b)=> timeTs(a)-timeTs(b));
    const pills = [];
    let running = null;
    if (isRunning()) {
      running = ordered.find(p=> (active.planId && p.id===active.planId) || (p.templateId && active.templateId && p.templateId===active.templateId) || p.name===active.name) || null;
      if (running) pills.push({ label: 'Now', it: running });
      const next = ordered.find(p=> !running || p.id !== running.id);
      if (next) pills.push({ label: 'Next', it: next });
    } else {
      const next = ordered[0]; if (next) pills.push({ label: 'Next', it: next });
      const after = ordered[1]; if (after) pills.push({ label: 'After', it: after });
    }
    // Overall plan progress pill (with capacity window)
    const todayKey = getPlanDateKey(Date.now());
    const todays = (settings.plans||[]).filter(p=>p.date===todayKey);
    if (todays.length > 0) {
      const done = todays.filter(p=>p.status==='done').length;
      // Chained overall ETA (TaskChute): order by scheduledAt then order
      const wallFrom = (()=>{ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
      const wallTo = wallFrom + 24*3600*1000;
      const todayLogs = sessions.filter(s => s.startAt >= wallFrom && s.startAt < wallTo);
      const spentByPlan = new Map();
      const spentByTpl = new Map();
      for (const s of todayLogs) {
        if (s.planId) spentByPlan.set(s.planId, (spentByPlan.get(s.planId)||0) + s.durationSec);
        if (s.templateId) spentByTpl.set(s.templateId, (spentByTpl.get(s.templateId)||0) + s.durationSec);
      }
      const timeTs = (p)=>{ if (!p.scheduledAt) return Number.POSITIVE_INFINITY; const [hh,mm]=String(p.scheduledAt).split(':').map(x=>parseInt(x||'0',10)); const d=new Date(); d.setHours(hh||0, mm||0, 0, 0); return d.getTime(); };
      const queue = todays.filter(p=>p.status!=='done').sort((a,b)=>{ const ta=timeTs(a), tb=timeTs(b); if (ta!==tb) return ta-tb; return (a.order||0)-(b.order||0); });
      let cursor = Date.now();
      let totalRemainMin = 0;
      for (const p of queue) {
        const estMin = Math.max(0, p.estimateMin||0);
        let spentSec = spentByPlan.get(p.id)||0; if (spentSec===0 && p.templateId) spentSec = spentByTpl.get(p.templateId)||0;
        let remainMs = Math.max(0, estMin*60000 - spentSec*1000);
        if (isRunning() && ((active.planId && p.id===active.planId) || (!active.planId && active.templateId && p.templateId===active.templateId) || (!active.planId && !active.templateId && active.name===p.name))) {
          const elapsedMs = Math.max(0, Date.now() - active.startAt);
          remainMs = Math.max(0, remainMs - elapsedMs);
        }
      const sched = timeTs(p); if (Number.isFinite(sched)) cursor = Math.max(cursor, sched);
        cursor += remainMs;
        totalRemainMin += Math.round(remainMs/60000);
      }
      let etaStr = '';
      let warn = false;
      if (queue.length>0) {
        const eta = new Date(cursor);
        etaStr = ` · 全体完了 ${pad2(eta.getHours())}:${pad2(eta.getMinutes())}`;
        if (settings.bedtime) {
          const [bh,bm] = settings.bedtime.split(':').map(x=>parseInt(x||'0',10));
          if (!Number.isNaN(bh)) { const b=new Date(); b.setHours(bh||0, bm||0, 0, 0); if (eta.getTime() > b.getTime()) warn = true; }
        }
      }
      const pill = document.createElement('div'); pill.className='pill' + (warn?' warn':'');
      const baseLabel = settings.chainEnabled ? (settings.chainBase==='first' ? '（基点:最初の予定）' : '（基点:いま）') : '';
      pill.textContent = `進捗 ${done}/${todays.length} · 残り見積 ${totalRemainMin}分${etaStr} ${baseLabel}`.trim();
      nowNextBar.appendChild(pill);
      // Capacity pill
      try {
        const ws = (settings.workStart||'').trim();
        const we = (settings.workEnd||'').trim();
        if (ws && we) {
          const [sh,sm] = ws.split(':').map(n=>parseInt(n||'0',10));
          const [eh,em] = we.split(':').map(n=>parseInt(n||'0',10));
          const d = new Date();
          const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh||0, sm||0, 0, 0).getTime();
          const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh||0, em||0, 0, 0).getTime();
          let blocks = [[start, end]];
          // apply lunch by block subtraction: prefer time-range; fallback to fixed minutes
          const ls = (settings.lunchStart||'').trim();
          const le = (settings.lunchEnd||'').trim();
          if (ls && le) {
            const [lh,lm] = ls.split(':').map(n=>parseInt(n||'0',10));
            const [rh,rm] = le.split(':').map(n=>parseInt(n||'0',10));
            const lStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), lh||0, lm||0, 0, 0).getTime();
            const lEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), rh||0, rm||0, 0, 0).getTime();
            // split work block into morning/afternoon around lunch
            blocks = [];
            if (lStart > start) blocks.push([start, Math.min(lStart, end)]);
            if (lEnd < end) blocks.push([Math.max(lEnd, start), end]);
          }
          const lunchMin = Math.max(0, settings.lunchMin||0);
          // capacity minutes total
          const capTotal = blocks.reduce((m,[s,e])=> m + Math.max(0, Math.round((e-s)/60000)), 0) - (ls && le ? 0 : lunchMin);
          // remaining capacity from now across blocks
          const nowMs = Date.now();
          let remainCapMin = 0;
          for (const [s,e] of blocks) {
            if (nowMs <= s) { remainCapMin += Math.max(0, Math.round((e-s)/60000)); }
            else if (nowMs >= e) { /* no-op */ }
            else { remainCapMin += Math.max(0, Math.round((e-nowMs)/60000)); }
          }
          if (!(ls && le)) { // subtract fixed lunch if lunch window not set and still in future window
            // naive: if now before middle of day, count all lunch minutes as not yet consumed
            remainCapMin = Math.max(0, remainCapMin - lunchMin);
          }
          const diff = remainCapMin - totalRemainMin;
          const capPill = document.createElement('div');
          let cls = 'pill';
          if (diff < 0) cls += ' capacity-over'; else if (diff < Math.max(15, Math.round(capTotal*0.1))) cls += ' capacity-warn';
          capPill.className = cls;
          const label = diff >= 0 ? `スラック ${diff}分` : `過負荷 ${Math.abs(diff)}分`;
          capPill.textContent = `キャパ ${capTotal}分 / 残り ${totalRemainMin}分 · ${label}`;
          nowNextBar.appendChild(capPill);
        }
      } catch {}
    }
    for (const {label,it} of pills) {
      const pill = document.createElement('div'); pill.className='pill';
      pill.textContent = `${label}: ${it.name}${it.scheduledAt?` (${it.scheduledAt})`:''}`;
      nowNextBar.appendChild(pill);
    }
  }

  function enablePlanDnd() {
    const rows = Array.from(planList.querySelectorAll('.plan-item'));
    if (rows.length === 0) return;
    let draggingEl = null;
    rows.forEach(row => {
      row.addEventListener('dragstart', (e)=>{
        draggingEl = row;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        // Firefox needs data
        e.dataTransfer.setData('text/plain', row.dataset.planId||'');
      });
      row.addEventListener('dragend', ()=>{
        if (!draggingEl) return;
        draggingEl.classList.remove('dragging');
        draggingEl = null;
        // write back order based on DOM order
        const baseKey = planViewDateKey || getPlanDateKey(Date.now());
        const orderedIds = Array.from(planList.querySelectorAll('.plan-item')).map(r=>r.dataset.planId);
        let order = 0;
        for (const id of orderedIds) {
          const it = (settings.plans||[]).find(p=>p.id===id && p.date===baseKey);
          if (it) { order += 1; it.order = order; }
        }
        persistAll();
        renderPlan();
      });
      row.addEventListener('dragover', (e)=>{
        e.preventDefault();
        const target = row;
        const rect = target.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height/2;
        const current = planList.querySelector('.plan-item.dragging');
        if (!current || current === target) return;
        planList.insertBefore(current, before ? target : target.nextSibling);
      });
    });
  }

  // Touch long-press reorder for mobile
  function enableTouchReorder() {
    if (!planList) return;
    const rows = Array.from(planList.querySelectorAll('.plan-item'));
    let longPressTimer = null;
    let dragging = null;
    let startY = 0;
    let placeholder = null;

    const cleanup = () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      if (dragging) { dragging.classList.remove('dragging'); dragging.style.transform = ''; dragging.style.zIndex=''; dragging.style.position=''; dragging.style.width=''; dragging=null; }
      if (placeholder && placeholder.parentElement) placeholder.remove();
      placeholder = null;
    };

    const onTouchStart = (row, e) => {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      longPressTimer = setTimeout(()=>{
        dragging = row;
        const rect = row.getBoundingClientRect();
        row.classList.add('dragging');
        row.style.position='relative';
        row.style.zIndex='2';
        row.style.width = rect.width + 'px';
        placeholder = document.createElement('div');
        placeholder.style.height = rect.height + 'px';
        placeholder.style.marginTop = getComputedStyle(row).marginTop;
        placeholder.style.marginBottom = getComputedStyle(row).marginBottom;
        planList.insertBefore(placeholder, row.nextSibling);
      }, 280);
    };
    const onTouchMove = (e) => {
      if (!dragging) return;
      const y = e.touches[0].clientY;
      const dy = y - startY;
      dragging.style.transform = `translateY(${dy}px)`;
      const rowsAll = Array.from(planList.querySelectorAll('.plan-item')).filter(r=>r!==dragging);
      for (const r of rowsAll) {
        const rect = r.getBoundingClientRect();
        if (y < rect.top + rect.height/2) {
          planList.insertBefore(placeholder, r);
          break;
        } else {
          planList.insertBefore(placeholder, r.nextSibling);
        }
      }
      e.preventDefault();
    };
    const onTouchEnd = () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer=null; }
      if (!dragging) return cleanup();
      planList.insertBefore(dragging, placeholder);
      // persist order
      const baseKey = planViewDateKey || getPlanDateKey(Date.now());
      const orderedIds = Array.from(planList.querySelectorAll('.plan-item')).map(r=>r.dataset.planId);
      let order = 0;
      for (const id of orderedIds) {
        const it = (settings.plans||[]).find(p=>p.id===id && p.date===baseKey);
        if (it) { order += 1; it.order = order; }
      }
      persistAll();
      cleanup();
    };

    rows.forEach(row => {
      row.addEventListener('touchstart', onTouchStart.bind(null, row), { passive: true });
      row.addEventListener('touchmove', onTouchMove, { passive: false });
      row.addEventListener('touchend', onTouchEnd);
      row.addEventListener('touchcancel', cleanup);
    });
  }

  function ensureTodayRoutinesInPlan() {
    // Use boundary-aware date when applyBoundaryToPlan is enabled
    const useBoundary = !!settings.applyBoundaryToPlan;
    const boundaryHour = (typeof settings.dayBoundaryHour === 'number') ? settings.dayBoundaryHour : 0;
    const offMs = (boundaryHour||0) * 3600000;
    const nowAdj = useBoundary ? (Date.now() - offMs) : Date.now();
    const todayKey = getPlanDateKey(Date.now());
    const weekday = (new Date(nowAdj).getDay()+6)%7; // Monday=0, boundary-aware if enabled
    settings.plans = settings.plans || [];
    settings.planSuppressions = settings.planSuppressions || {};
    const suppressed = new Set(settings.planSuppressions[todayKey] || []);
    const todayPlans = settings.plans.filter(p=>p.date===todayKey);
    let maxOrder = todayPlans.reduce((m,p)=>Math.max(m, p.order||0), 0);
    const candidates = templates.filter(t=> t.isRoutine && (!Array.isArray(t.routineDays) || t.routineDays.includes(weekday)));
    let added = 0;
    for (const t of candidates) {
      if (suppressed.has(t.id)) continue; // honor today's suppression list
      const exists = todayPlans.some(p=> p.templateId === t.id);
      if (exists) continue;
      maxOrder += 1;
      settings.plans.push({ id: uuid(), date: todayKey, templateId: t.id, name: t.name, estimateMin: t.targetDailyMin||0, scheduledAt: t.timeOfDay||'', status: 'todo', order: maxOrder });
      added++;
    }
    if (added>0) { persistAll(); }
  }

function addPlanItem({ name, templateId, estimateMin, scheduledAt }) {
  const todayKey = getPlanDateKey(Date.now());
    settings.plans = settings.plans || [];
    const order = (settings.plans.filter(p=>p.date===todayKey).reduce((m,p)=>Math.max(m, p.order||0), 0) + 1);
    settings.plans.push({ id: uuid(), date: todayKey, templateId: templateId||null, name: name||'', estimateMin: estimateMin||0, scheduledAt: scheduledAt||'', status: 'todo', order });
    persistAll();
    renderPlan();
  }

  function movePlan(id, delta) {
    const todayKey = getPlanDateKey(Date.now());
    const list = settings.plans.filter(p=>p.date===todayKey);
    list.sort((a,b)=> (a.order||0)-(b.order||0));
    const idx = list.findIndex(p=>p.id===id);
    if (idx<0) return;
    const j = idx + delta;
    if (j<0 || j>=list.length) return;
    const a = list[idx], b = list[j];
    const tmp = a.order; a.order = b.order; b.order = tmp;
    persistAll();
    renderPlan();
  }

  function completePlan(id) {
    const it = (settings.plans||[]).find(p=>p.id===id);
    if (!it) return;
    it.status = 'done';
    persistAll();
    renderPlan();
  }

  function adjustPlanEstimate(id, deltaMin) {
    const it = (settings.plans||[]).find(p=>p.id===id);
    if (!it) return;
    const cur = Math.max(0, it.estimateMin||0);
    const next = Math.max(0, cur + (deltaMin||0));
    it.estimateMin = next;
    persistAll();
    renderPlan();
  }

  function splitPlanRemaining(id) {
    const it = (settings.plans||[]).find(p=>p.id===id);
    if (!it) return;
    const from = startOfDay(Date.now());
    const todayLogs = sessions.filter(s=>s.startAt >= from);
    const spentSec = todayLogs.filter(s=>s.planId===id).reduce((sum,s)=>sum+s.durationSec,0);
    const remainingMin = Math.max(0, (it.estimateMin||0) - Math.round(spentSec/60));
    if (remainingMin <= 0) { alert('残り見積がありません'); return; }
    const half = Math.max(1, Math.floor(remainingMin/2));
    it.estimateMin = remainingMin - half;
    const order = (settings.plans.filter(p=>p.date===it.date).reduce((m,p)=>Math.max(m, p.order||0), 0) + 1);
    settings.plans.push({ id: uuid(), date: it.date, templateId: it.templateId||null, name: it.name, estimateMin: half, scheduledAt: it.scheduledAt||'', status:'todo', order });
    persistAll();
    renderPlan();
  }

  function skipPlan(id) {
    const it = (settings.plans||[]).find(p=>p.id===id);
    if (!it) return;
    const prev = it.status||'todo';
    it.status = 'skipped';
    persistAll();
    renderPlan();
    showUndo && showUndo({ type:'planStatus', payload: { id, prev } });
  }

  function deletePlan(id) {
    const removed = (settings.plans||[]).find(p=>p.id===id);
    settings.plans = (settings.plans||[]).filter(p=>p.id!==id);
    persistAll();
    renderPlan();
    showUndo && showUndo({ type:'deletePlan', payload: removed });
  }

  function editPlan(id) {
    const it = (settings.plans||[]).find(p=>p.id===id);
    if (!it || !planEditBackdrop) return;
    planEditTargetId = id;
    planNameInput.value = it.name||'';
    if (planTimeTime) planTimeTime.value = it.scheduledAt || '';
    buildEstOptions(planEstSelect); planEstSelect.value = String(it.estimateMin||0);
    planEditBackdrop.classList.remove('hidden');
  }

  function rolloverIncompleteToTomorrow() {
    const todayKey = getPlanDateKey(Date.now());
    const d = new Date(); d.setDate(d.getDate()+1);
    const tomorrowKey = `${d.getFullYear()}-${('0'+(d.getMonth()+1)).slice( -2)}-${('0'+d.getDate()).slice( -2)}`;
    const todays = (settings.plans||[]).filter(p=>p.date===todayKey);
    const incomplete = todays.filter(p=>p.status!=='done');
    const maxOrderTomorrow = (settings.plans||[]).filter(p=>p.date===tomorrowKey).reduce((m,p)=>Math.max(m, p.order||0), 0);
    let order = maxOrderTomorrow;
    for (const p of incomplete) {
      order += 1;
      settings.plans.push({ id: uuid(), date: tomorrowKey, templateId: p.templateId||null, name: p.name||'', estimateMin: p.estimateMin||0, scheduledAt: p.scheduledAt||'', status: 'todo', order });
    }
    // 今日の未完は任意でdoneにせず残す（記録のため）。必要ならstatus変更ロジックを追加。
    persistAll();
    alert(`未完 ${incomplete.length}件を明日へ繰り越しました`);
  }

  function generateTomorrowPlanFromRoutines() {
    // ルーチン設定と今日の未達プランを元に、明日の雛形を作る
    const d = new Date(); d.setDate(d.getDate()+1);
    const tomorrowKey = `${d.getFullYear()}-${('0'+(d.getMonth()+1)).slice( -2)}-${('0'+d.getDate()).slice( -2)}`;
    const weekday = (d.getDay()+6)%7; // Monday=0
    const routines = templates.filter(t=>t.isRoutine && (!Array.isArray(t.routineDays) || t.routineDays.includes(weekday)));
    let order = (settings.plans||[]).filter(p=>p.date===tomorrowKey).reduce((m,p)=>Math.max(m, p.order||0), 0);
    for (const t of routines) {
      order += 1;
      settings.plans.push({ id: uuid(), date: tomorrowKey, templateId: t.id, name: t.name, estimateMin: t.targetDailyMin||0, scheduledAt: t.timeOfDay||'', status: 'todo', order });
    }
    persistAll();
    alert(`明日のプランにルーチン ${routines.length}件を追加しました`);
  }

  function renderRoutines() {
    if (!routineList) return;
    const today = new Date();
    const weekday = (today.getDay()+6)%7; // Monday=0
    routineList.innerHTML = '';
    const items = templates.filter(t => t.isRoutine && (!Array.isArray(t.routineDays) || t.routineDays.includes(weekday)));
    if (items.length === 0) {
      const d = document.createElement('div');
      d.className = 'meta';
      d.textContent = '今日は予定なし';
      routineList.appendChild(d);
      return;
    }
    const todayFrom = (()=>{ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
    const todayLogs = sessions.filter(s => s.startAt >= todayFrom);
    for (const t of items) {
      const spent = todayLogs.filter(s => s.templateId === t.id).reduce((sum,s)=>sum+s.durationSec,0);
      const targetSec = (t.targetDailyMin||0) * 60;
      const leftText = targetSec ? ` / 目標 ${formatDuration(targetSec)}` : '';
      const meta = `${t.timeOfDay ? `予定 ${t.timeOfDay} · `: ''}${spent>0?`達成 ${formatDuration(spent)}`:'未達'}${leftText}`;
      const row = document.createElement('div'); row.className='routine-item';
      const left = document.createElement('div'); left.innerHTML = `<div><strong>${escapeHtml(t.name)}</strong></div><div class=\"meta\">${meta}</div>`;
      const btn = document.createElement('button'); btn.className='btn'; btn.textContent='開始'; btn.onclick=()=>{
        const todayKey = getPlanDateKey(Date.now());
        const plan = (settings.plans||[]).find(p=>p.date===todayKey && p.templateId===t.id);
        startTask({ name: t.name, templateId: t.id, planId: plan ? plan.id : null });
      };
      const right = document.createElement('div');
      // 週/月ターゲットの進捗
      const startW = startOfWeekWallclock(Date.now());
      const endW = startW + 7*24*3600*1000;
      const weekSec = sessions.filter(s=> s.templateId===t.id && s.startAt>=startW && s.startAt<endW).reduce((sum,s)=>sum+s.durationSec,0);
      const weekBadge = document.createElement('span'); weekBadge.className = 'badge ' + ((t.weeklyTargetMin && weekSec/60>=t.weeklyTargetMin)?'ok':'warn'); weekBadge.style.marginRight='6px';
      weekBadge.textContent = `週 ${formatDuration(weekSec)} / ${(t.weeklyTargetMin||0)}分`;
      const m0 = new Date(); m0.setDate(1); m0.setHours(0,0,0,0);
      const nextM = new Date(m0.getFullYear(), m0.getMonth()+1, 1, 0,0,0,0);
      const monthSec = sessions.filter(s=> s.templateId===t.id && s.startAt>=m0.getTime() && s.startAt<nextM.getTime()).reduce((sum,s)=>sum+s.durationSec,0);
      const monthBadge = document.createElement('span'); monthBadge.className = 'badge ' + ((t.monthlyTargetMin && monthSec/60>=t.monthlyTargetMin)?'ok':'warn'); monthBadge.style.marginRight='6px';
      monthBadge.textContent = `月 ${formatDuration(monthSec)} / ${(t.monthlyTargetMin||0)}分`;
      right.append(weekBadge, monthBadge, btn);
      row.appendChild(left); row.appendChild(right);
      routineList.appendChild(row);
    }
  }

  function renderControls() {
    if (isRunning()) {
      startStopBtn.textContent = '停止';
      startStopBtn.classList.add('danger');
      startStopBtn.classList.remove('primary');
      quickNoteBtn.style.display = 'inline-flex';
      if (typeof focusBtn !== 'undefined' && focusBtn) focusBtn.style.display = 'inline-flex';
      runningInfo.style.display = 'block';
      const elapsedSec = Math.floor((Date.now() - active.startAt)/1000);
      // ETA based on plan estimate when available
      let etaStr = '';
      const todayKey = getPlanDateKey(Date.now());
      const plan = (settings.plans||[]).find(p=>p.date===todayKey && ((active.planId && p.id===active.planId) || (active.templateId && p.templateId===active.templateId) || p.name===active.name));
      const estMin = plan?.estimateMin || 0;
      if (estMin > 0) {
        const eta = new Date(active.startAt + estMin*60000);
        etaStr = ` · 完了予定 ${pad2(eta.getHours())}:${pad2(eta.getMinutes())}`;
      }
      runningInfo.textContent = `${active.name} 実行中 · ${formatDuration(elapsedSec)} 経過${etaStr}`;
    } else {
      startStopBtn.textContent = '開始';
      startStopBtn.classList.remove('danger');
      startStopBtn.classList.add('primary');
      quickNoteBtn.style.display = 'none';
      if (typeof focusBtn !== 'undefined' && focusBtn) focusBtn.style.display = 'none';
      runningInfo.style.display = 'none';
      runningInfo.textContent = '';
    }
  }

  function renderTemplates() {
    templateList.innerHTML = '';
    if (templates.length === 0) {
      const help = document.createElement('div');
      help.style.color = '#94a3b8';
      help.textContent = 'よく使うタスクをルーチンとして追加してワンタップ開始！';
      templateList.appendChild(help);
      return;
    }
    const list = [...templates];
    // 予定時刻順に並べ替え（未設定は最後）
    const timeTs = (t) => {
      if (!t.timeOfDay) return Number.POSITIVE_INFINITY;
      const [hh,mm] = String(t.timeOfDay).split(':').map(x=>parseInt(x||'0',10));
      const d = new Date(); d.setHours(hh||0, mm||0, 0, 0); return d.getTime();
    };
    list.sort((a,b)=> timeTs(a) - timeTs(b));
    const todayKey = getPlanDateKey(Date.now());
    const plannedSet = new Set((settings.plans||[]).filter(p=>p.date===todayKey && p.templateId).map(p=>p.templateId));
    const suppressedSet = new Set((settings.planSuppressions && settings.planSuppressions[todayKey]) || []);
    for (const t of list) {
      const wrap = document.createElement('div'); wrap.className='chip'; wrap.style.cursor='default';
      const addBtn = document.createElement('button'); addBtn.className='btn small';
      const already = plannedSet.has(t.id);
      addBtn.textContent = already ? '追加済' : 'プランに追加';
      addBtn.disabled = already;
      if (!already) addBtn.onclick=()=>{ addPlanItem({ name: t.name, templateId: t.id, estimateMin: t.targetDailyMin||0, scheduledAt: t.timeOfDay||'' }); };
      const suppressBtn = document.createElement('button'); suppressBtn.className='btn small';
      if (t.isRoutine) {
        const suppressed = suppressedSet.has(t.id);
        suppressBtn.textContent = suppressed ? '抑止解除(今日)' : '今日抑止';
        suppressBtn.onclick = ()=>{
          settings.planSuppressions[todayKey] = settings.planSuppressions[todayKey] || [];
          const arr = settings.planSuppressions[todayKey];
          const idx = arr.indexOf(t.id);
          if (idx>=0) arr.splice(idx,1); else arr.push(t.id);
          // If suppressing now, remove already-injected plans for today
          if (arr.includes(t.id)) {
            settings.plans = (settings.plans||[]).filter(p=> !(p.date===todayKey && p.templateId===t.id));
          }
          persistAll(); renderTemplates(); renderPlan();
        };
        // 週抑止
        const suppressWeekBtn = document.createElement('button'); suppressWeekBtn.className='btn small';
        const weekKey = String(startOfWeekWallclock(Date.now()));
        const weekSet = new Set((settings.planSuppressionsWeek && settings.planSuppressionsWeek[weekKey]) || []);
        const suppressedW = weekSet.has(t.id);
        suppressWeekBtn.textContent = suppressedW ? '抑止解除(今週)' : '今週抑止';
        suppressWeekBtn.onclick = ()=>{
          settings.planSuppressionsWeek[weekKey] = settings.planSuppressionsWeek[weekKey] || [];
          const arrW = settings.planSuppressionsWeek[weekKey];
          const idxW = arrW.indexOf(t.id);
          if (idxW>=0) arrW.splice(idxW,1); else arrW.push(t.id);
          // 今日を含めて今週分の注入済みを削除
          const start = startOfWeekWallclock(Date.now());
          const end = start + 7*24*3600*1000;
          settings.plans = (settings.plans||[]).filter(p=>{
            const ts = new Date(p.date+'T00:00').getTime();
            if (ts<start || ts>=end) return true;
            return !(p.templateId===t.id);
          });
          persistAll(); renderTemplates(); renderPlan();
        };
      } else { suppressBtn.style.display='none'; }
      const editBtn = document.createElement('button'); editBtn.className='btn small'; editBtn.textContent='編集'; editBtn.onclick=()=>editRoutine(t.id);
      const delBtn = document.createElement('button'); delBtn.className='btn small'; delBtn.textContent='削除'; delBtn.onclick=()=>deleteRoutine(t.id);
      const label = document.createElement('span'); label.innerHTML = `<span class=\"dot\" style=\"background:${t.color}\"></span>${escapeHtml(t.name)} <span class=\"meta\">${t.timeOfDay?`予定 ${t.timeOfDay}`:'予定なし'} · 目標 ${t.targetDailyMin||0}分</span>`;
      const actions = document.createElement('span'); actions.className='chip-actions';
      if (t.isRoutine) {
        // Append both suppress buttons for routines
        const weekKey = String(startOfWeekWallclock(Date.now()));
        const suppressWeekBtn = document.createElement('button'); suppressWeekBtn.className='btn small';
        const weekSet = new Set((settings.planSuppressionsWeek && settings.planSuppressionsWeek[weekKey]) || []);
        const suppressedW = weekSet.has(t.id);
        suppressWeekBtn.textContent = suppressedW ? '抑止解除(今週)' : '今週抑止';
        suppressWeekBtn.onclick = ()=>{
          settings.planSuppressionsWeek[weekKey] = settings.planSuppressionsWeek[weekKey] || [];
          const arrW = settings.planSuppressionsWeek[weekKey];
          const idxW = arrW.indexOf(t.id);
          if (idxW>=0) arrW.splice(idxW,1); else arrW.push(t.id);
          const start = startOfWeekWallclock(Date.now());
          const end = start + 7*24*3600*1000;
          settings.plans = (settings.plans||[]).filter(p=>{
            const ts = new Date(p.date+'T00:00').getTime();
            if (ts<start || ts>=end) return true;
            return !(p.templateId===t.id);
          });
          persistAll(); renderTemplates(); renderPlan();
        };
        actions.append(addBtn, suppressBtn, suppressWeekBtn, editBtn, delBtn);
      } else {
        actions.append(addBtn, editBtn, delBtn);
      }
      wrap.append(label, actions);
      templateList.appendChild(wrap);
    }
  }

  // 並び替え矢印は廃止（時刻順/名称順に任せる）

  function editRoutine(id) {
    const t = templates.find(x=>x.id===id); if (!t || !routineEditBackdrop) return;
    routineEditTargetId = id;
    routineNameInput.value = t.name||'';
    // init days
    const boxes = Array.from(routineDaysWrap.querySelectorAll('input.rd'));
    boxes.forEach(b => { b.checked = Array.isArray(t.routineDays) ? t.routineDays.includes(parseInt(b.value,10)) : true; });
    if (routineTimeTime) routineTimeTime.value = t.timeOfDay||'';
    buildEstOptions(routineEstSelect); if (routineEstSelect) routineEstSelect.value = String(t.targetDailyMin||0);
    routineTagsInput.value = (t.defaultTags||[]).join(', ');
    if (routineWeeklyTarget) routineWeeklyTarget.value = String(t.weeklyTargetMin||0);
    if (routineMonthlyTarget) routineMonthlyTarget.value = String(t.monthlyTargetMin||0);
    routineEditBackdrop.classList.remove('hidden');
  }

  function deleteRoutine(id) {
    if (!confirm('このルーチンを削除しますか？')) return;
    templates = templates.filter(t=>t.id!==id);
    persistAll();
    renderTemplates();
    renderRoutines();
  }

  function getFilteredSessions() {
    const q = (searchInput.value||'').trim().toLowerCase();
    const range = rangeSelect.value;
    const now = Date.now();
    let from = 0;
    if (range === 'today') { const d=new Date(); d.setHours(0,0,0,0); from = d.getTime(); }
    else if (range === 'week') from = startOfWeek(now);
    return sessions
      .filter(s => s.startAt >= from)
      .filter(s => {
        if (!q) return true;
        const name = (s.name||'').toLowerCase();
        const tags = (s.tags||[]).join(' ').toLowerCase();
        return name.includes(q) || tags.includes(q);
      })
      .sort((a,b) => b.startAt - a.startAt);
  }

  function renderSummary() {
    const filtered = getFilteredSessions();
    const totalSec = filtered.reduce((sum, s) => sum + (s.durationSec||0), 0);
    const todayFrom = startOfDay(Date.now());
    let todaySec = sessions.filter(s=>s.startAt>=todayFrom).reduce((sum,s)=>sum+s.durationSec,0);
    if (isRunning() && active.startAt >= todayFrom) {
      todaySec += Math.floor((Date.now() - active.startAt)/1000);
    }
    if (todayTotalEl) todayTotalEl.textContent = `今日 合計 ${formatDuration(todaySec)}`;
    const byName = new Map();
    for (const s of filtered) {
      const key = s.name || '無題';
      byName.set(key, (byName.get(key)||0) + s.durationSec);
    }
    const top = [...byName.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3);
    summaryTotals.innerHTML = '';
    const pill1 = document.createElement('div'); pill1.className = 'total-pill'; pill1.textContent = `合計 ${formatDuration(totalSec)}`; summaryTotals.appendChild(pill1);
    if (top[0]) summaryTotals.appendChild(pill(`1位 ${top[0][0]} · ${formatDuration(top[0][1])}`));
    if (top[1]) summaryTotals.appendChild(pill(`2位 ${top[1][0]} · ${formatDuration(top[1][1])}`));
    if (top[2]) summaryTotals.appendChild(pill(`3位 ${top[2][0]} · ${formatDuration(top[2][1])}`));
    function pill(text){ const d=document.createElement('div'); d.className='total-pill'; d.textContent=text; return d; }
  }

  // ---- Dashboard ----
  function renderDashboard() {
    if (!dashboardContent) return;
    const range = (dashRangeSelect && dashRangeSelect.value) || 'today';
    const now = Date.now();
    let from = 0, to = now+1;
    if (range === 'today') { const d=new Date(); d.setHours(0,0,0,0); from=d.getTime(); }
    else if (range === 'week') { from = startOfWeek(now); }
    else if (range === 'month') { const d=new Date(); d.setDate(1); d.setHours(0,0,0,0); from=d.getTime(); }
    // all: from = 0
    const list = sessions.filter(s=> s.startAt>=from && s.startAt<to);
    const fmt = (sec)=> formatDuration(sec);
    const wrap = document.createElement('div');
    wrap.className = 'chips';
    if (dashTab === 'tag') {
      const by = new Map();
      for (const s of list) for (const t of (s.tags||[])) by.set(t, (by.get(t)||0)+s.durationSec);
      // merge small tags into "その他" to keep top clean
      let arr = [...by.entries()].sort((a,b)=>b[1]-a[1]);
      const top = arr.slice(0,9);
      const other = arr.slice(9).reduce((a,[_t,sec])=>a+sec,0);
      if (other>0) top.push(['その他', other]);
      arr = top;
      if (arr.length===0) wrap.innerHTML = '<div class="meta">タグの記録なし</div>';
      for (const [t,sec] of arr) {
        const d = document.createElement('div'); d.className='chip'; d.textContent = `${t} · ${fmt(sec)}`; wrap.appendChild(d);
      }
    } else if (dashTab === 'tpl') {
      const by = new Map();
      for (const s of list) {
        const key = s.templateId || (s.name||'無題');
        by.set(key, (by.get(key)||0)+s.durationSec);
      }
      const arr = [...by.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
      if (arr.length===0) wrap.innerHTML = '<div class="meta">テンプレ/名称の記録なし</div>';
      for (const [k,sec] of arr) {
        const label = (typeof k === 'string' && k.length>0 && k.includes('-')) ? k : (templates.find(t=>t.id===k)?.name || String(k));
        const d = document.createElement('div'); d.className='chip'; d.textContent = `${label} · ${fmt(sec)}`; wrap.appendChild(d);
      }
    } else if (dashTab === 'acc') {
      // Accuracy/Interrupt/Area budget snapshot
      const acc = buildAccuracySnapshot(range);
      if (!acc) { wrap.innerHTML = '<div class="meta">データなし</div>'; }
      else {
        const chips = [];
        chips.push(chipWithSpark(`平均誤差 ${acc.avgAbsDiffMin}分 · 過不足率 ${acc.biasPct}%`, acc.series));
        chips.push(chip(`割り込み ${acc.interrupt.count}件 / ${formatDuration(acc.interrupt.totalSec)}`));
        if (acc.area && acc.area.length>0) {
          for (const a of acc.area.slice(0,5)) chips.push(chip(`${a.label} ${a.achievedMin}/${a.budgetMin}分 (${a.ratePct}%)`));
        }
        if (acc.over && acc.over.length) {
          chips.push(chip('オーバー Top: ' + acc.over.map(o=>`${o.name} ${o.min}分超`).join(' · ')));
        }
        if (acc.under && acc.under.length) {
          chips.push(chip('アンダー Top: ' + acc.under.map(o=>`${o.name} ${o.min}分不足`).join(' · ')));
        }
        // Hourly heat (24h)
        try {
          const heat = renderHourlyHeat(acc.hourly||[]);
          const heatWrap = document.createElement('div'); heatWrap.className='chip'; heatWrap.style.flexDirection='column';
          const title = document.createElement('div'); title.textContent='時刻帯誤差(見積−実績)'; title.style.marginBottom='4px';
          heatWrap.append(title, heat);
          chips.push(heatWrap);
        } catch {}
        // Weekly x Hour heat (7x24) for week/month range
        if (range !== 'today') {
          try {
            const grid = buildWeeklyHourlyHeat(range);
            const wrapGrid = document.createElement('div'); wrapGrid.className='chip'; wrapGrid.style.flexDirection='column';
            const title2 = document.createElement('div'); title2.textContent = '週×時刻帯誤差'; title2.style.marginBottom='4px';
            wrapGrid.append(title2, renderWeeklyHeat(grid));
            chips.push(wrapGrid);
          } catch {}
        }
        wrap.append(...chips);
      }
    } else if (dashTab === 'heatTpl' || dashTab === 'heatTag') {
      if (range === 'today') { wrap.innerHTML='<div class="meta">今週/今月で表示</div>'; }
      else {
        const grid = buildWeeklyHourlyHeat(range);
        const box = document.createElement('div'); box.style.display='flex'; box.style.flexDirection='column'; box.style.gap='8px';
        // per template grids (top 3 by total time)
        if (dashTab === 'heatTpl') {
          const per = buildPerTemplateWeeklyHeat(range);
          const top = [...per.entries()].map(([id,g])=>({ id, sum: g.flat().reduce((a,b)=>a+Math.abs(b),0), grid:g }))
            .sort((a,b)=>b.sum-a.sum).slice(0,3);
          if (top.length===0) box.innerHTML='<div class="meta">テンプレの記録なし</div>';
          for (const t of top) {
            const name = templates.find(x=>x.id===t.id)?.name || '無題';
            const chip = document.createElement('div'); chip.className='chip'; chip.style.flexDirection='column';
            const title = document.createElement('div'); title.textContent = `テンプレ: ${name}`; title.style.marginBottom='4px';
            chip.append(title, renderWeeklyHeat(t.grid)); box.appendChild(chip);
          }
        } else {
          // per tag grids (top 3 by total)
          const per = buildPerTagWeeklyHeat(range);
          const top = [...per.entries()].map(([tag,g])=>({ tag, sum: g.flat().reduce((a,b)=>a+Math.abs(b),0), grid:g }))
            .sort((a,b)=>b.sum-a.sum).slice(0,3);
          if (top.length===0) box.innerHTML='<div class="meta">タグの記録なし</div>';
          for (const t of top) {
            const chip = document.createElement('div'); chip.className='chip'; chip.style.flexDirection='column';
            const title = document.createElement('div'); title.textContent = `タグ: ${t.tag}`; title.style.marginBottom='4px';
            chip.append(title, renderWeeklyHeat(t.grid)); box.appendChild(chip);
          }
        }
        wrap.appendChild(box);
      }
    }
    dashboardContent.innerHTML = '';
    dashboardContent.appendChild(wrap);

    function chip(text){ const d=document.createElement('div'); d.className='chip'; d.textContent=text; return d; }
    function chipWithSpark(text, series) {
      const d=document.createElement('div'); d.className='chip';
      const span=document.createElement('span'); span.textContent=text;
      const svg = renderSpark(series||[]);
      d.append(span, svg); return d;
    }
  }

  function renderSpark(series) {
    const w=90, h=24, pad=2;
    if (!Array.isArray(series) || series.length===0) {
      const s=document.createElementNS('http://www.w3.org/2000/svg','svg'); s.setAttribute('width', String(w)); s.setAttribute('height', String(h)); return s;
    }
    const vals = series.map(x=>x.diffMin);
    const min = Math.min(...vals, 0), max = Math.max(...vals, 0);
    const rng = Math.max(1, max-min);
    const xStep = (w - pad*2) / Math.max(1, series.length-1);
    const toX = (i)=> pad + i*xStep;
    const toY = (v)=> h - pad - ((v-min)/rng)*(h - pad*2);
    let d = '';
    series.forEach((pt,i)=>{ const x=toX(i), y=toY(pt.diffMin); d += (i===0?`M${x},${y}`:` L${x},${y}`); });
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h));
    const axis=document.createElementNS('http://www.w3.org/2000/svg','line'); axis.setAttribute('x1', '0'); axis.setAttribute('x2', String(w)); axis.setAttribute('y1', String(toY(0))); axis.setAttribute('y2', String(toY(0))); axis.setAttribute('stroke', '#334155'); axis.setAttribute('stroke-width', '1'); axis.setAttribute('opacity','0.7');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path'); path.setAttribute('d', d); path.setAttribute('fill','none'); path.setAttribute('stroke','#60a5fa'); path.setAttribute('stroke-width','1.5');
    // average line
    const avg = vals.reduce((a,b)=>a+b,0) / vals.length;
    const avgLine=document.createElementNS('http://www.w3.org/2000/svg','line'); avgLine.setAttribute('x1', '0'); avgLine.setAttribute('x2', String(w)); avgLine.setAttribute('y1', String(toY(avg))); avgLine.setAttribute('y2', String(toY(avg))); avgLine.setAttribute('stroke', '#94a3b8'); avgLine.setAttribute('stroke-width', '1'); avgLine.setAttribute('stroke-dasharray', '3,3'); avgLine.setAttribute('opacity','0.8');
    svg.append(axis, path, avgLine); return svg;
  }

  function renderHourlyHeat(arr) {
    const maxAbs = Math.max(1, ...arr.map(v=>Math.abs(v)));
    const wrap = document.createElement('div'); wrap.className='heat24';
    for (let h=0; h<24; h++) {
      const v = arr[h]||0; const ratio = Math.min(1, Math.abs(v)/maxAbs);
      const c = v>=0 ? [34,197,94] : [239,68,68]; // green / red
      const col = `rgba(${c[0]},${c[1]},${c[2]},${0.15 + 0.65*ratio})`;
      const cell = document.createElement('div'); cell.className='heat-cell'; cell.title = `${String(h).padStart(2,'0')}:00 ${Math.round(v/60)}分`;
      cell.style.background = col; wrap.appendChild(cell);
    }
    return wrap;
  }

  function buildWeeklyHourlyHeat(range) {
    const now = Date.now();
    let from = 0, to = now+1;
    if (range === 'week') { from = startOfWeek(now); }
    else if (range === 'month') { const d=new Date(); d.setDate(1); d.setHours(0,0,0,0); from=d.getTime(); }
    else { const d=new Date(); d.setHours(0,0,0,0); from=d.getTime(); }
    const logs = sessions.filter(s=> s.startAt>=from && s.startAt<to);
    const ps = (settings.plans||[]).filter(p=>{
      const ts = new Date(p.date+'T00:00').getTime(); return ts>=from && ts<to;
    });
    const grid = Array.from({length:7}, ()=> new Array(24).fill(0));
    // actuals
    for (const s of logs) {
      let t = new Date(s.startAt); const end=new Date(s.endAt);
      while (t < end) {
        const dow = (t.getDay()+6)%7; const h=t.getHours(); grid[dow][h] -= 60; t = new Date(t.getTime()+60000);
      }
    }
    // estimates (roughly attribute to scheduled hour or default bucket)
    for (const p of ps) {
      const d = new Date(p.date+'T00:00'); const dow = (d.getDay()+6)%7; const estMin=p.estimateMin||0; if (!estMin) continue;
      let h = 9; if (p.scheduledAt && /^\d{1,2}:\d{2}$/.test(p.scheduledAt)) { h = Math.max(0, Math.min(23, parseInt(p.scheduledAt.split(':')[0],10)||9)); }
      grid[dow][h] += estMin*60;
    }
    // also build per-area (template) grids for future use (not rendered yet)
    const byTpl = new Map();
    for (const t of templates) byTpl.set(t.id, Array.from({length:7}, ()=> new Array(24).fill(0)));
    // attribute sessions to template grids
    for (const s of logs) {
      if (!s.templateId || !byTpl.has(s.templateId)) continue;
      let t = new Date(s.startAt); const end=new Date(s.endAt);
      const g = byTpl.get(s.templateId);
      while (t < end) { const dow=(t.getDay()+6)%7; const h=t.getHours(); g[dow][h] += 60; t=new Date(t.getTime()+60000); }
    }
    return grid; // could return {grid, byTpl} when UIを拡張する時に使用
  }

  function buildPerTemplateWeeklyHeat(range) {
    const now = Date.now();
    let from = 0, to = now+1;
    if (range === 'week') { from = startOfWeek(now); }
    else if (range === 'month') { const d=new Date(); d.setDate(1); d.setHours(0,0,0,0); from=d.getTime(); }
    else { const d=new Date(); d.setHours(0,0,0,0); from=d.getTime(); }
    const logs = sessions.filter(s=> s.startAt>=from && s.startAt<to && s.templateId);
    const per = new Map();
    for (const s of logs) {
      if (!per.has(s.templateId)) per.set(s.templateId, Array.from({length:7}, ()=> new Array(24).fill(0)));
      const g = per.get(s.templateId);
      let t = new Date(s.startAt); const end=new Date(s.endAt);
      while (t < end) { const dow=(t.getDay()+6)%7; const h=t.getHours(); g[dow][h] += 60; t = new Date(t.getTime()+60000); }
    }
    return per;
  }

  function buildPerTagWeeklyHeat(range) {
    const now = Date.now();
    let from = 0, to = now+1;
    if (range === 'week') { from = startOfWeek(now); }
    else if (range === 'month') { const d=new Date(); d.setDate(1); d.setHours(0,0,0,0); from=d.getTime(); }
    else { const d=new Date(); d.setHours(0,0,0,0); from=d.getTime(); }
    const logs = sessions.filter(s=> s.startAt>=from && s.startAt<to);
    const per = new Map();
    for (const s of logs) {
      const tags = (s.tags||[]); if (!tags.length) continue;
      for (const tag of tags) {
        if (!per.has(tag)) per.set(tag, Array.from({length:7}, ()=> new Array(24).fill(0)));
        const g = per.get(tag);
        let t = new Date(s.startAt); const end=new Date(s.endAt);
        while (t < end) { const dow=(t.getDay()+6)%7; const h=t.getHours(); g[dow][h] += 60; t = new Date(t.getTime()+60000); }
      }
    }
    return per;
  }

  function renderWeeklyHeat(grid) {
    // grid: 7 x 24 seconds
    const maxAbs = Math.max(1, ...grid.flat().map(v=>Math.abs(v)));
    const container = document.createElement('div'); container.className='heat-scroll';
    const gridWrap = document.createElement('div'); gridWrap.className='heat24';
    // mean and std per hour across week
    const perHour = new Array(24).fill(0).map(()=>[]);
    for (let d=0; d<7; d++) for (let h=0; h<24; h++) perHour[h].push(grid[d][h]||0);
    const mean = perHour.map(arr=> arr.reduce((a,b)=>a+b,0)/arr.length);
    const std = perHour.map((arr,i)=> {
      const m=mean[i]; const v = arr.reduce((a,b)=> a + Math.pow(b-m,2), 0)/arr.length; return Math.sqrt(v);
    });
    // show legend for μ±σ and budget bands
    const warnPct = Math.max(50, Math.min(120, settings.budgetWarnPct||80));
    const overPct = Math.max(90, Math.min(200, settings.budgetOverPct||110));
    const legend = document.createElement('div'); legend.className='heat-legend'; legend.textContent=`濃:偏差大 / 薄:μ±σ内 ・ 達成率: ok < ${warnPct}% < warn < ${overPct}% <= over`;
    container.appendChild(legend);
    for (let d=0; d<7; d++) {
      for (let h=0; h<24; h++) {
        const v = grid[d][h]||0; const ratio = Math.min(1, Math.abs(v)/maxAbs);
        const c = v>=0 ? [34,197,94] : [239,68,68];
        // mean band highlight: if within mean±std, lighten a bit
        let alpha = 0.15 + 0.65*ratio;
        const within = Math.abs(v - mean[h]) <= std[h]; if (within) alpha *= 0.85;
        const col = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
        const cell = document.createElement('div'); cell.className='heat-cell'; cell.title=`${['月','火','水','木','金','土','日'][d]} ${String(h).padStart(2,'0')}:00 ${Math.round(v/60)}分 (μ=${Math.round(mean[h]/60)}分, σ=${Math.round(std[h]/60)}分)`;
        // strict budget contrast using template targets when available (weekly/month context)
        try {
          const range = (dashRangeSelect && dashRangeSelect.value) || 'today';
          if (range !== 'today') {
            // compute weekly/monthly targets aggregated per hour if scheduledAt is set
            // For simplicity: if any template has timeOfDay matching this hour, compare its target (per day for week, per day avg for month)
            let targetMin = 0;
            for (const t of templates) {
              if (!t.timeOfDay) continue;
              const hh = parseInt(t.timeOfDay.split(':')[0]||'0',10)||0;
              if (hh !== h) continue;
              if (range==='week' && t.weeklyTargetMin) targetMin += Math.max(0, t.weeklyTargetMin/7);
              if (range==='month' && t.monthlyTargetMin) {
                const m0 = new Date(); m0.setDate(1); m0.setHours(0,0,0,0);
                const nextM = new Date(m0.getFullYear(), m0.getMonth()+1, 1, 0,0,0,0);
                const daysInMonth = Math.round((nextM.getTime()-m0.getTime())/(24*3600*1000));
                targetMin += Math.max(0, t.monthlyTargetMin/daysInMonth);
              }
            }
            // distribute for templates without timeOfDay (equal across 24h)
            // refine: if template has defaultTags, distribute to hours where those tags appear within range
            // gather logs in range once
            let from = 0, to = Date.now()+1;
            if (range==='week') from = startOfWeek(Date.now());
            else if (range==='month') { const d0=new Date(); d0.setDate(1); d0.setHours(0,0,0,0); from=d0.getTime(); }
            else { const d0=new Date(); d0.setHours(0,0,0,0); from=d0.getTime(); }
            const logsRng = sessions.filter(s=> s.startAt>=from && s.startAt<to);
            for (const t of templates) {
              if (t.timeOfDay) continue;
              const perDay = (range==='week' ? (t.weeklyTargetMin||0)/7 : (range==='month' ? (()=>{ const m0=new Date(); m0.setDate(1); m0.setHours(0,0,0,0); const nextM=new Date(m0.getFullYear(), m0.getMonth()+1, 1,0,0,0); const daysInMonth=Math.round((nextM.getTime()-m0.getTime())/(24*3600*1000)); return (t.monthlyTargetMin||0)/daysInMonth; })() : 0));
              if (perDay<=0) continue;
              let weightH = 0, totalW = 0;
              const tags = Array.isArray(t.defaultTags)? t.defaultTags : [];
              if (tags.length>0) {
                // approximate: attribute each session's minutes to start hour only for speed
                for (const s of logsRng) {
                  const sTags = s.tags||[];
                  const intersects = sTags.some(x=> tags.includes(x));
                  if (!intersects) continue;
                  const minutes = Math.max(1, Math.round((s.endAt - s.startAt)/60000));
                  const sh = new Date(s.startAt).getHours();
                  totalW += minutes;
                  if (sh===h) weightH += minutes;
                }
              }
              const share = totalW>0 ? (weightH/totalW) : (1/24);
              targetMin += perDay * share;
            }
            if (targetMin > 0) {
              const actualMin = Math.abs(v/60);
              const rate = actualMin / targetMin;
              const warnPct = Math.max(50, Math.min(120, settings.budgetWarnPct||80))/100;
              const overPct = Math.max(90, Math.min(200, settings.budgetOverPct||110))/100;
              if (rate >= overPct) cell.classList.add('budget-over');
              else if (rate >= warnPct) cell.classList.add('budget-warn');
              else cell.classList.add('budget-ok');
            }
          }
        } catch {}
        cell.style.background = col; gridWrap.appendChild(cell);
      }
    }
    container.appendChild(gridWrap);
    return container;
  }

  function buildAccuracySnapshot(range) {
    const now = Date.now();
    let from = 0, to = now+1;
    if (range === 'today') { const d=new Date(); d.setHours(0,0,0,0); from=d.getTime(); }
    else if (range === 'week') { from = startOfWeek(now); }
    else if (range === 'month') { const d=new Date(); d.setDate(1); d.setHours(0,0,0,0); from=d.getTime(); }
    // Plans in range (wall clock for days spanned)
    const days = []; // YYYY-MM-DD
    const d0 = new Date(from); d0.setHours(0,0,0,0);
    for (let t=d0.getTime(); t<to; t+=24*3600*1000) days.push(formatDateWall(t));
    const ps = (settings.plans||[]).filter(p=> days.includes(p.date));
    const logs = sessions.filter(s=> s.startAt>=from && s.startAt<to);
    const byPlanSpent = new Map();
    for (const s of logs) if (s.planId) byPlanSpent.set(s.planId, (byPlanSpent.get(s.planId)||0)+s.durationSec);
    const diffs = [];
    const diffByName = new Map();
    for (const p of ps) {
      const estMin = p.estimateMin||0; if (!estMin) continue;
      const spentSec = byPlanSpent.get(p.id)||0;
      diffs.push((estMin*60) - spentSec);
      const name = p.name || (p.templateId ? (templates.find(t=>t.id===p.templateId)?.name||'無題') : '無題');
      diffByName.set(name, (diffByName.get(name)||0) + ((estMin*60) - spentSec));
    }
    const abs = diffs.map(x=>Math.abs(x));
    const avgAbsDiffMin = abs.length? Math.round(abs.reduce((a,b)=>a+b,0)/abs.length/60) : 0;
    const biasSec = diffs.reduce((a,b)=>a+b,0);
    const totalEstSec = ps.reduce((a,p)=>a+(p.estimateMin||0)*60,0);
    const biasPct = totalEstSec? Math.round((biasSec/totalEstSec)*100) : 0;
    // Interrupts
    const inter = logs.filter(s=> s.interruptGroupId);
    const interrupt = { count: inter.length, totalSec: inter.reduce((a,b)=>a+b.durationSec,0) };
    // Area budgets (template weekly/monthly against range)
    const area = [];
    if (range==='week' || range==='month') {
      for (const t of templates) {
        const label = t.name;
        const budgetMin = range==='week' ? (t.weeklyTargetMin||0) : (t.monthlyTargetMin||0);
        if (!budgetMin) continue;
        const achievedSec = logs.filter(s=> s.templateId===t.id).reduce((a,b)=>a+b.durationSec,0);
        area.push({ label, budgetMin, achievedMin: Math.round(achievedSec/60), ratePct: Math.round((achievedSec/60)/Math.max(1,budgetMin)*100) });
      }
      area.sort((a,b)=> b.ratePct - a.ratePct);
    }
    // Build daily error series for sparkline (last 14 days)
    const series = buildDailyErrorSeries(14);
    // Top over/under by task name
    const over = [...diffByName.entries()].filter(([_n,sec])=> sec<0).sort((a,b)=> a[1]-b[1]).slice(0,3)
      .map(([n,sec])=> ({ name:n, min: Math.round(Math.abs(sec)/60) }));
    const under = [...diffByName.entries()].filter(([_n,sec])=> sec>0).sort((a,b)=> b[1]-a[1]).slice(0,3)
      .map(([n,sec])=> ({ name:n, min: Math.round(sec/60) }));
    return { avgAbsDiffMin, biasPct, interrupt, area, series, over, under };
  }

  function buildDailyErrorSeries(daysBack) {
    const out = [];
    const todayWall = new Date(); todayWall.setHours(0,0,0,0);
    for (let i = daysBack - 1; i >= 0; i--) {
      const dayStart = new Date(todayWall.getTime() - i*24*3600*1000).getTime();
      const dayEnd = dayStart + 24*3600*1000;
      const dkey = formatDateWall(dayStart);
      const plans = (settings.plans||[]).filter(p=> p.date === dkey);
      const logs = sessions.filter(s=> s.startAt >= dayStart && s.startAt < dayEnd);
      const byPlan = new Map();
      for (const s of logs) if (s.planId) byPlan.set(s.planId, (byPlan.get(s.planId)||0)+s.durationSec);
      let total = 0;
      for (const p of plans) { const estSec = (p.estimateMin||0)*60; total += (estSec - (byPlan.get(p.id)||0)); }
      out.push({ ts: dayStart, diffMin: Math.round(total/60) });
    }
    return out;
  }

  // ---- Daily Review ----
  function renderReview() {
    if (!reviewContent) return;
    const from = (()=>{ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
    const to = from + 24*3600*1000;
    const dayLogs = sessions.filter(s=> s.startAt>=from && s.startAt<to);
    // 達成/未完（プラン基準）
    const todayKey = getPlanDateKey(Date.now());
    const todays = (settings.plans||[]).filter(p=>p.date===todayKey);
    const done = todays.filter(p=>p.status==='done');
    const undone = todays.filter(p=>p.status!=='done');
    // 誤差Top（見積-実績）
    const spentByPlan = new Map();
    for (const s of dayLogs) {
      const pid = s.planId || null;
      if (!pid) continue;
      spentByPlan.set(pid, (spentByPlan.get(pid)||0) + s.durationSec);
    }
    const diffs = todays.map(p=>{
      const spent = spentByPlan.get(p.id)||0;
      const estSec = (p.estimateMin||0)*60;
      return { name: p.name, diffSec: estSec - spent };
    }).filter(x=>x.diffSec!==0);
    const overTop = [...diffs].filter(x=>x.diffSec<0).sort((a,b)=>a.diffSec-b.diffSec).slice(0,3);
    const underTop = [...diffs].filter(x=>x.diffSec>0).sort((a,b)=>b.diffSec-a.diffSec).slice(0,3);
    // タグ/テンプレ集計（簡易）
    const byTag = new Map();
    for (const s of dayLogs) {
      for (const t of (s.tags||[])) byTag.set(t, (byTag.get(t)||0)+s.durationSec);
    }
    const topTags = [...byTag.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3);
    // Render
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="totals" style="margin:6px 0; gap:8px; display:flex; flex-wrap:wrap;">
        <div class="total-pill">達成 ${done.length}/${todays.length}</div>
        <div class="total-pill">記録 ${formatDuration(dayLogs.reduce((s,x)=>s+x.durationSec,0))}</div>
      </div>
      <div class="label">誤差(オーバー) Top</div>
      <div class="totals">${overTop.map(x=>`<div class="total-pill">${escapeHtml(x.name)} · ${formatDuration(Math.abs(x.diffSec))}超</div>`).join('')||'<span class="meta">なし</span>'}</div>
      <div class="label" style="margin-top:8px;">誤差(アンダー) Top</div>
      <div class="totals">${underTop.map(x=>`<div class="total-pill">${escapeHtml(x.name)} · ${formatDuration(x.diffSec)}不足</div>`).join('')||'<span class="meta">なし</span>'}</div>
      <div class="label" style="margin-top:8px;">タグ Top</div>
      <div class="totals">${topTags.map(([t,sec])=>`<div class="total-pill">${escapeHtml(t)} · ${formatDuration(sec)}</div>`).join('')||'<span class="meta">タグなし</span>'}</div>
    `;
    reviewContent.innerHTML = '';
    reviewContent.appendChild(div);
    // load saved memo
    try {
      const key = getPlanDateKey(Date.now());
      const mem = (settings.reviewMemos && settings.reviewMemos[key]) || {};
      if (reviewMemo) reviewMemo.value = mem.memo || '';
      if (tomorrowNote) tomorrowNote.value = mem.tomorrow || '';
    } catch {}
  }

  function renderWeekReview() {
    if (!reviewWeekContent) return;
    const start = startOfWeekWallclock(Date.now());
    const end = start + 7*24*3600*1000;
    const weekLogs = sessions.filter(s=> s.startAt>=start && s.startAt<end);
    const total = weekLogs.reduce((sum,s)=>sum+s.durationSec,0);
    // by tag
    const byTag = new Map();
    for (const s of weekLogs) for (const t of (s.tags||[])) byTag.set(t,(byTag.get(t)||0)+s.durationSec);
    const tagTop = [...byTag.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
    // by template/name
    const byName = new Map();
    for (const s of weekLogs) byName.set(s.name||'無題',(byName.get(s.name||'無題')||0)+s.durationSec);
    const nameTop = [...byName.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
    // estimate error (plan-linked only)
    const byPlan = new Map();
    for (const s of weekLogs) if (s.planId) byPlan.set(s.planId,(byPlan.get(s.planId)||0)+s.durationSec);
    const allPlans = (settings.plans||[]).filter(p=>{
      const ts = new Date(p.date+'T00:00').getTime();
      return ts>=start && ts<end;
    });
    const diffs = allPlans.map(p=> ({ name:p.name, diffSec:(p.estimateMin||0)*60 - (byPlan.get(p.id)||0) }))
      .filter(x=>x.diffSec!==0);
    const overTop = diffs.filter(x=>x.diffSec<0).sort((a,b)=>a.diffSec-b.diffSec).slice(0,5);
    const underTop = diffs.filter(x=>x.diffSec>0).sort((a,b)=>b.diffSec-a.diffSec).slice(0,5);
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="totals" style="margin:6px 0; gap:8px; display:flex; flex-wrap:wrap;">
        <div class="total-pill">週合計 ${formatDuration(total)}</div>
      </div>
      <div class="label">タグ Top</div>
      <div class="totals">${tagTop.map(([t,sec])=>`<div class="total-pill">${escapeHtml(t)} · ${formatDuration(sec)}</div>`).join('')||'<span class="meta">タグなし</span>'}</div>
      <div class="label" style="margin-top:8px;">タスク名 Top</div>
      <div class="totals">${nameTop.map(([n,sec])=>`<div class="total-pill">${escapeHtml(n)} · ${formatDuration(sec)}</div>`).join('')||'<span class="meta">なし</span>'}</div>
      <div class="label" style="margin-top:8px;">誤差(オーバー) Top</div>
      <div class="totals">${overTop.map(x=>`<div class="total-pill">${escapeHtml(x.name)} · ${formatDuration(Math.abs(x.diffSec))}超</div>`).join('')||'<span class="meta">なし</span>'}</div>
      <div class="label" style="margin-top:8px;">誤差(アンダー) Top</div>
      <div class="totals">${underTop.map(x=>`<div class="total-pill">${escapeHtml(x.name)} · ${formatDuration(x.diffSec)}不足</div>`).join('')||'<span class="meta">なし</span>'}</div>
    `;
    reviewWeekContent.innerHTML = '';
    reviewWeekContent.appendChild(div);
  }

  function renderReviewHistory() {
    if (!reviewHistory) return;
    const keys = Object.keys(settings.reviewMemos||{}).sort().reverse().slice(0,7);
    const list = document.createElement('div');
    for (const k of keys) {
      const mem = settings.reviewMemos[k];
      const item = document.createElement('div'); item.className='log-item';
      item.innerHTML = `<div><strong>${k}</strong><div class="meta">${escapeHtml(mem.memo||'')}</div><div class="meta">明日: ${escapeHtml(mem.tomorrow||'')}</div></div>`;
      list.appendChild(item);
    }
    reviewHistory.innerHTML='';
    reviewHistory.appendChild(list);
  }

  function renderLogs() {
    const list = getFilteredSessions();
    const groups = groupByDay(list);
    logList.innerHTML = '';
    const todayKey = getPlanDateKey(Date.now());
    settings.logCollapsed = settings.logCollapsed || {};
    for (const g of groups) {
      const dayDiv = document.createElement('div');
      dayDiv.className = 'log-day';
      const total = g.items.reduce((sum, s)=>sum+s.durationSec, 0);
      const header = document.createElement('div');
      header.className = 'log-day-header';
      const leftH = document.createElement('div');
      const arrow = document.createElement('span');
      arrow.style.marginRight = '6px';
      leftH.appendChild(arrow);
      leftH.append(g.label);
      const rightH = document.createElement('div'); rightH.className = 'badge ok'; rightH.textContent = `合計 ${formatDuration(total)}`;
      header.appendChild(leftH); header.appendChild(rightH);
      dayDiv.appendChild(header);

      // Collapsible items container
      const itemsWrap = document.createElement('div');
      itemsWrap.className = 'log-items';
      for (const s of g.items) {
        const row = document.createElement('div');
        row.className = 'log-item';
        const left = document.createElement('div');
        const right = document.createElement('div'); right.className='log-actions';
        left.innerHTML = `
          <div><strong>${escapeHtml(s.name||'無題')}</strong></div>
          <div class="meta">${formatTime(s.startAt)} - ${formatTime(s.endAt)} · ${formatDuration(s.durationSec)}</div>
          ${s.note ? `<div class="meta">📝 ${escapeHtml(s.note)}</div>` : ''}
          <div class="tags">${(s.tags||[]).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        `;
        const edit = document.createElement('button'); edit.className='btn'; edit.textContent='編集'; edit.onclick=()=> openLogEdit(s.id);
        const del = document.createElement('button'); del.className='btn'; del.textContent='削除'; del.onclick=()=>{ if(confirm('削除しますか？')) deleteLog(s.id); };
        right.append(edit, del);
        row.appendChild(left); row.appendChild(right);
        itemsWrap.appendChild(row);
      }
      dayDiv.appendChild(itemsWrap);

      // Determine collapsed state (default: collapse today only once)
      let collapsed = settings.logCollapsed[g.key];
      if (typeof collapsed === 'undefined' && g.key === todayKey) {
        collapsed = true;
        settings.logCollapsed[g.key] = true;
        persistAll();
      }
      const applyCollapsed = () => {
        itemsWrap.style.display = collapsed ? 'none' : 'block';
        arrow.textContent = collapsed ? '▶' : '▼';
      };
      applyCollapsed();
      header.addEventListener('click', () => {
        collapsed = !collapsed;
        settings.logCollapsed[g.key] = collapsed;
        persistAll();
        applyCollapsed();
      });
      logList.appendChild(dayDiv);
    }
  }

  // ---- Log edit ----
  function openLogEdit(id) {
    const s = sessions.find(x=>x.id===id);
    if (!s || !logEditBackdrop) return;
    logEditBackdrop.classList.remove('hidden');
    try { (logEditName||logEditStart||logEditEnd)?.focus(); } catch {}
    if (logEditName) logEditName.value = s.name||'';
    if (logEditTags) logEditTags.value = (s.tags||[]).join(', ');
    if (logEditNote) logEditNote.value = s.note||'';
    if (logEditStart) logEditStart.value = new Date(s.startAt).toISOString().slice(0,16);
    if (logEditEnd) logEditEnd.value = new Date(s.endAt).toISOString().slice(0,16);
    logEditBackdrop.dataset.editId = id;
  }
  if (logEditCancelBtn && logEditBackdrop) {
    logEditCancelBtn.addEventListener('click', ()=>{ logEditBackdrop.classList.add('hidden'); logEditBackdrop.dataset.editId=''; });
    logEditBackdrop.addEventListener('click', (e)=>{ if (e.target===logEditBackdrop) { logEditBackdrop.classList.add('hidden'); logEditBackdrop.dataset.editId=''; } });
  }
  // ESC to close log edit
  document.addEventListener('keydown', (e)=>{
    if (!logEditBackdrop || logEditBackdrop.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); logEditBackdrop.classList.add('hidden'); logEditBackdrop.dataset.editId=''; }
  });
  if (logEditSaveBtn) logEditSaveBtn.addEventListener('click', ()=>{
    const id = logEditBackdrop && logEditBackdrop.dataset.editId;
    if (!id) { if (logEditBackdrop) logEditBackdrop.classList.add('hidden'); return; }
    const s = sessions.find(x=>x.id===id);
    if (!s) { if (logEditBackdrop) logEditBackdrop.classList.add('hidden'); return; }
    s.name = (logEditName&&logEditName.value)||s.name;
    const tagsStr = (logEditTags&&logEditTags.value)||''; s.tags = tagsStr.split(',').map(x=>x.trim()).filter(Boolean);
    s.note = (logEditNote&&logEditNote.value)||'';
    try { if (logEditStart&&logEditStart.value) s.startAt = new Date(logEditStart.value).getTime(); } catch {}
    try { if (logEditEnd&&logEditEnd.value) s.endAt = new Date(logEditEnd.value).getTime(); } catch {}
    if (s.endAt <= s.startAt) { alert('終了は開始より後の時刻にしてください'); return; }
    s.durationSec = Math.max(1, Math.floor((s.endAt - s.startAt)/1000));
    persistAll();
    if (logEditBackdrop) { logEditBackdrop.classList.add('hidden'); logEditBackdrop.dataset.editId=''; }
    render();
  });

  function groupByDay(items) {
    const byKey = new Map();
    for (const it of items) {
      const key = formatDate(it.startAt);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(it);
    }
    const arr = [...byKey.entries()].map(([k, v]) => ({ key:k, label: k, items: v.sort((a,b)=>b.startAt-a.startAt) }));
    arr.sort((a,b)=> b.key.localeCompare(a.key));
    return arr;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
  }

  // -------- Timers / Alerts --------
  let tickTimer = null;
  function startTick() {
    stopTick();
    tickTimer = setInterval(() => {
      if (isRunning()) {
        // 長時間アラート
        const elapsedMin = (Date.now() - active.startAt) / 60000;
        if (settings.alertAfterMin && elapsedMin > settings.alertAfterMin && !active.meta.alerted) {
          active.meta.alerted = true;
          alert(`開始から${Math.round(elapsedMin)}分経過しました。区切りますか？`);
        }
        // 集中モードのタイマー更新
        if (typeof focusTimer !== 'undefined' && typeof focusOverlay !== 'undefined' && focusTimer && focusOverlay && !focusOverlay.classList.contains('hidden')) {
          const sec = Math.floor((Date.now() - active.startAt)/1000);
          const mm = String(Math.floor(sec/60)).padStart(2,'0');
          const ss = String(sec%60).padStart(2,'0');
          focusTimer.textContent = `${mm}:${ss}`;
        }
        // ネイティブ層: バッジに経過分を表示（対応環境）
        try {
          const mins = Math.max(1, Math.floor((Date.now() - active.startAt)/60000));
          if (navigator.setAppBadge) navigator.setAppBadge(mins);
        } catch {}
      } else {
        try { if (navigator.clearAppBadge) navigator.clearAppBadge(); } catch {}
      }
    try { renderControls(); } catch {}
    try { renderRoutines(); } catch {}
    try { renderSummary(); } catch {}
    // Ensure Now/Next bar reflects latest state (IDB load, timers, etc.)
    try {
      if (nowNextBar && !planViewDateKey) {
        const todayKey = getPlanDateKey(Date.now());
        const todays = (settings.plans||[]).filter(p=>p.date===todayKey);
        renderNowNextBar(todays);
      }
    } catch {}
    try {
      const nowSec = Math.floor(Date.now()/1000);
      const visible = (document.visibilityState === 'visible');
      if (visible && timelineVisible && (nowSec % 60 === 0)) renderTimeline();
    } catch {}
    maybeNotifyUpcoming();
    maybeWeeklyBackupReminder();
    }, 1000);
  }

  // 画面復帰時にUI/バッジを再計算
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      renderControls(); renderSummary(); renderTimeline && renderTimeline();
      try {
        if (isRunning() && navigator.setAppBadge) {
          const mins = Math.max(1, Math.floor((Date.now() - active.startAt)/60000));
          navigator.setAppBadge(mins);
        } else if (navigator.clearAppBadge) {
          navigator.clearAppBadge();
        }
      } catch {}
    }
  });

  // Multi-tab consistency: reload state when other tabs update localStorage
  window.addEventListener('storage', (e)=>{
    if (!e.key) return;
    const keys = Object.values(LS_KEYS);
    if (!keys.includes(e.key)) return;
    try {
      templates = readLS(LS_KEYS.templates, templates);
      sessions = readLS(LS_KEYS.sessions, sessions);
      active = readLS(LS_KEYS.active, active);
      settings = readLS(LS_KEYS.settings, settings);
      render();
    } catch {}
  });

  function maybeNotifyUpcoming() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = Date.now();
    const todayKey = getPlanDateKey(now);
    const list = (settings.plans||[]).filter(p=>p.date===todayKey && p.status!=='done' && p.scheduledAt);
    for (const p of list) {
      const [hh,mm] = String(p.scheduledAt).split(':').map(x=>parseInt(x||'0',10));
      if (Number.isNaN(hh)) continue;
      const d = new Date(); d.setHours(hh||0, mm||0, 0, 0);
      const diffMin = Math.round((d.getTime() - now)/60000);
      // 5分前と時刻超過で通知（1回のみ、settingsに永続化）
      settings._noti = settings._noti || {};
      const notiKey = `${todayKey}:${p.id}`;
      const ns = settings._noti[notiKey] || {};
      if (diffMin === 5 && !ns.pre5) { new Notification('もうすぐ開始', { body: `${p.name||'タスク'}：5分前` }); ns.pre5=true; settings._noti[notiKey]=ns; persistAll(); }
      if (diffMin === 0 && !ns.now) { new Notification('開始時刻です', { body: `${p.name||'タスク'}：開始予定` }); ns.now=true; settings._noti[notiKey]=ns; persistAll(); }
      if (diffMin < 0 && !ns.over) { new Notification('予定超過', { body: `${p.name||'タスク'}：予定時刻を過ぎています` }); ns.over=true; settings._noti[notiKey]=ns; persistAll(); }
    }
  }
  function stopTick() { if (tickTimer) clearInterval(tickTimer); tickTimer = null; }

  // 週次バックアップ通知（日曜20:00、1回/週）：JSONエクスポートを促す
  function maybeWeeklyBackupReminder() {
    if (!settings.weeklyBackupReminder) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = new Date();
    const isSunday = now.getDay() === 0; // Sunday
    const hh = now.getHours(); const mm = now.getMinutes();
    const key = `backup:${now.getFullYear()}-W${getIsoWeek(now)}`;
    settings._noti = settings._noti || {};
    if (isSunday && hh === 20 && mm === 0 && !settings._noti[key]) {
      try { new Notification('バックアップの時間', { body: 'JSONエクスポートまたはWebDAVに保存しましょう' }); } catch {}
      try { if (settings.autoDownloadBackup) exportAllJson(); } catch {}
      settings._noti[key] = { fired: true }; persistAll();
    }
  }
  function getIsoWeek(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(),0,4));
    const weekNum = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay()+6)%7)) / 7);
    return weekNum;
  }

  // -------- Events --------
  startStopBtn.addEventListener('click', () => {
    if (isRunning()) {
      stopTaskWithModal();
    } else {
      const name = (taskNameInput?.value||'').trim();
      // Ad-hoc起動時はクイック紐付けモーダルを表示
      if (!name) {
        openQuickStart('');
      } else {
        openQuickStart(name);
      }
      if (taskNameInput) taskNameInput.value = '';
    }
  });
  quickNoteBtn.addEventListener('click', () => {
    const memo = prompt('メモを入力');
    if (!memo) return;
    if (!active) return;
    active.meta.quickNote = (active.meta.quickNote||'') + (active.meta.quickNote? '\n':'') + memo;
    persistAll();
  });
  // Break/Pomodoro quick workflows (Focus overlay)
  if (focusBreakBtn) focusBreakBtn.addEventListener('click', () => {
    // Treat break as interruption: stop current, log interruption, then auto-resume
    if (!active) return;
    const baseName = active.name;
    const baseTemplateId = active.templateId || null;
    // Reuse interruption flow to resume after break
    const groupId = (settings.resumeAfterInterruption && settings.resumeAfterInterruption.groupId) || (Math.random().toString(36).slice(2) + Date.now().toString(36));
    const nextIndex = (settings.resumeAfterInterruption && settings.resumeAfterInterruption.nextIndex) || 2;
    active.meta = active.meta || {}; active.meta.interruptGroupId = groupId; active.meta.segmentIndex = nextIndex - 1;
    persistAll();
    confirmStopTask({ tags: [], note: '' });
    startTask({ name: '休憩', templateId: null, planId: null });
    settings.resumeAfterInterruption = { baseName, templateId: baseTemplateId, groupId, nextIndex, interruptSessionId: active.id };
    persistAll();
  });
  let pomodoroTimer = null; let pomodoroUntil = null;
  function clearPomodoroTimer() {
    if (pomodoroTimer) { clearInterval(pomodoroTimer); pomodoroTimer = null; }
  }
  if (focusPomodoroBtn) focusPomodoroBtn.addEventListener('click', () => {
    const defaultMin = 25;
    const workMin = parseInt(prompt('作業分（分）', String(defaultMin))||String(defaultMin), 10) || defaultMin;
    const breakMin = parseInt(prompt('休憩（分）', '5')||'5', 10) || 5;
    // Start or annotate current task as Pomodoro
    if (!isRunning()) {
      startTask({ name: `作業`, templateId: null });
    }
    // Visual countdown only, does not rename the task
    clearPomodoroTimer();
    pomodoroUntil = Date.now() + Math.max(1, workMin)*60000;
    if (pomodoroCountdown) pomodoroCountdown.style.display = 'block';
    pomodoroTimer = setInterval(() => {
      const left = Math.max(0, pomodoroUntil - Date.now());
      const mm = String(Math.floor(left/60000)).padStart(2,'0');
      const ss = String(Math.floor((left%60000)/1000)).padStart(2,'0');
      if (pomodoroCountdown) pomodoroCountdown.textContent = `${mm}:${ss}`;
      if (left <= 0) {
        clearPomodoroTimer();
        if (pomodoroCountdown) { pomodoroCountdown.style.display='none'; pomodoroCountdown.textContent=''; }
        pomodoroUntil = null;
        // End work segment, start break as interruption
        if (isRunning()) {
          // Work is done; instead of強制休憩に入らず、通知だけ出す
          try { new Notification && new Notification('作業終了', { body: '休憩を開始しますか？' }); } catch {}
          const goBreak = confirm('作業が終了しました。休憩を開始しますか？');
          if (goBreak) {
            const baseName = active.name; const baseTemplateId = active.templateId || null;
            const groupId = Math.random().toString(36).slice(2) + Date.now().toString(36);
            active.meta = active.meta || {}; active.meta.interruptGroupId = groupId; active.meta.segmentIndex = 1; persistAll();
            confirmStopTask({ tags: [], note: '' });
            startTask({ name: '休憩', templateId: null });
            setTimeout(() => { if (isRunning()) confirmStopTask({ tags: [], note: '' }); }, Math.max(1, breakMin)*60000);
            settings.resumeAfterInterruption = { baseName, templateId: baseTemplateId, groupId, nextIndex: 2, interruptSessionId: active.id };
            persistAll();
          }
        }
      }
    }, 500);
  });
  if (focusExtendBtn) focusExtendBtn.addEventListener('click', () => {
    if (!pomodoroUntil) return;
    pomodoroUntil += 5*60000; // extend 5 minutes
  });
  // Stop pomodoro countdown on manual stop or visibility changes
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') clearPomodoroTimer(); });
  // Initialize stop modal radios default: continue
  (()=>{ const radios = Array.from(document.querySelectorAll('input[name="stopPlanAction"]')); const c = radios.find(r=>r.value==='continue'); if (c) c.checked = true; })();
  // 集中モード イベント
  if (focusBtn) focusBtn.addEventListener('click', () => { openFocus(); });
  if (focusCloseBtn) focusCloseBtn.addEventListener('click', () => { closeFocus(); });
  if (focusStopBtn) focusStopBtn.addEventListener('click', () => { closeFocus(); stopTaskWithModal(); });
  if (focusMemoBtn) focusMemoBtn.addEventListener('click', () => {
    const m = prompt('メモ');
    if (!m || !active) return;
    active.meta.quickNote = (active.meta.quickNote||'') + (active.meta.quickNote?'\n':'') + m;
    persistAll();
  });
  if (focusInterruptBtn) focusInterruptBtn.addEventListener('click', () => {
    if (!active) return;
    const baseName = active.name;
    const baseTemplateId = active.templateId || null;
    const newName = prompt('割り込みタスク名');
    if (!newName) return;
    // 割り込みグループIDと次のセグメント番号を用意
    const groupId = (settings.resumeAfterInterruption && settings.resumeAfterInterruption.groupId) || (Math.random().toString(36).slice(2) + Date.now().toString(36));
    const nextIndex = (settings.resumeAfterInterruption && settings.resumeAfterInterruption.nextIndex) || 2;
    // 元タスク（現在のactive）に前半メタを付与してから停止
    active.meta = active.meta || {};
    active.meta.interruptGroupId = groupId;
    active.meta.segmentIndex = nextIndex - 1; // 1から開始
    persistAll();
    // 区切って割り込みタスク開始
    confirmStopTask({ tags: [], note: '' });
    startTask({ name: newName, templateId: null, planId: null });
    // 割り込みセッションIDを保存（この停止の次は割り込みの停止なので、そのときだけ復帰）
    if (active) {
      settings.resumeAfterInterruption = { baseName, templateId: baseTemplateId, groupId, nextIndex, interruptSessionId: active.id };
      persistAll();
    }
    openFocus && openFocus();
  });

  function openFocus() {
    if (!active || !focusOverlay) return;
    // remember plan id for scroll return
    const todayKey = getPlanDateKey(Date.now());
    const plan = (settings.plans||[]).find(p=>p.date===todayKey && ((active.planId && p.id===active.planId) || (active.templateId && p.templateId===active.templateId) || p.name===active.name));
    lastFocusPlanId = plan ? plan.id : null;
    if (focusTaskName) focusTaskName.textContent = active.name;
    // Reset pomodoro countdown UI on open
    if (pomodoroCountdown) { pomodoroCountdown.style.display='none'; pomodoroCountdown.textContent=''; }
    renderFocusSuggestions();
    focusOverlay.classList.remove('hidden');
  }
  function closeFocus() {
    if (!focusOverlay) return;
    focusOverlay.classList.add('hidden');
    // Stop pomodoro countdown when closing focus
    try { clearPomodoroTimer(); } catch {}
    // Scroll back to originating plan row if available
    if (lastFocusPlanId && planList) {
      const row = planList.querySelector(`.plan-item[data-plan-id="${lastFocusPlanId}"]`);
      if (row && typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  function renderFocusSuggestions() {
    if (!focusSuggestions) return;
    focusSuggestions.innerHTML = '';
    const todayKey = getPlanDateKey(Date.now());
    const list = (settings.plans||[]).filter(p=>p.date===todayKey && p.status!=='done');
    const timeTs = (p) => {
      if (!p.scheduledAt) return Number.POSITIVE_INFINITY;
      const [hh, mm] = String(p.scheduledAt).split(':').map(x=>parseInt(x||'0',10));
      const d = new Date(); d.setHours(hh||0, mm||0, 0, 0); return d.getTime();
    };
    const ordered = [...list].sort((a,b)=> timeTs(a)-timeTs(b));
    const running = isRunning()? ordered.find(p=> (active.planId && p.id===active.planId) || (p.templateId && active.templateId && p.templateId===active.templateId) || p.name===active.name) : null;
    const candidates = ordered.filter(p=> !running || p.id!==running.id).slice(0,2);
    for (const p of candidates) {
      const chip = document.createElement('button'); chip.className='chip';
      chip.textContent = p.name + (p.scheduledAt?` (${p.scheduledAt})`: '');
      chip.onclick = () => { startTask({ name: p.name, templateId: p.templateId||null, planId: p.id||null }); };
      focusSuggestions.appendChild(chip);
    }
  }
  // New: Routine create via modal (unify with edit)
  addTemplateBtn.addEventListener('click', () => {
    if (!routineEditBackdrop) return;
    routineEditMode = 'create'; routineEditTargetId = null;
    routineNameInput.value = '';
    // clear days
    const boxes = Array.from(routineDaysWrap.querySelectorAll('input.rd'));
    boxes.forEach(b => { b.checked = false; });
    if (routineTimeTime) routineTimeTime.value = '';
    buildEstOptions(routineEstSelect); if (routineEstSelect) routineEstSelect.value = '0';
    routineTagsInput.value = '';
    routineEditBackdrop.classList.remove('hidden');
  });
  exportCsvBtn.addEventListener('click', exportCsv);
  if (exportIcsBtn) exportIcsBtn.addEventListener('click', exportTodayIcs);
  if (exportJsonBtn) exportJsonBtn.addEventListener('click', exportAllJson);
  if (importJsonBtn && importJsonFile) {
    importJsonBtn.addEventListener('click', ()=> importJsonFile.click());
    importJsonFile.addEventListener('change', async (e)=>{
      const file = e.target.files && e.target.files[0]; if (!file) return;
      const text = await file.text();
      importAllJson(text);
      importJsonFile.value = '';
    });
  }
  searchInput.addEventListener('input', () => { renderSummary(); renderLogs(); });
  rangeSelect.addEventListener('change', () => { renderSummary(); renderLogs(); });
  if (dashRangeSelect) dashRangeSelect.addEventListener('change', renderDashboard);
  if (dashTabTag) dashTabTag.addEventListener('click', ()=>{ dashTab='tag'; renderDashboard(); });
  if (dashTabTpl) dashTabTpl.addEventListener('click', ()=>{ dashTab='tpl'; renderDashboard(); });
  if (dashTabAccuracy) dashTabAccuracy.addEventListener('click', ()=>{ dashTab='acc'; renderDashboard(); });
  if (dashTabHeatTpl) dashTabHeatTpl.addEventListener('click', ()=>{ dashTab='heatTpl'; renderDashboard(); });
  if (dashTabHeatTag) dashTabHeatTag.addEventListener('click', ()=>{ dashTab='heatTag'; renderDashboard(); });
  if (addPlanFreeBtn) addPlanFreeBtn.addEventListener('click', () => {
    planEditMode = 'create'; planEditTargetId = null;
    planNameInput.value = '';
    if (planDateInput) planDateInput.value = planViewDateKey || getPlanDateKey(Date.now());
    // Flatpickr for plan edit date input
    try { if (window.flatpickr && planDateInput) window.flatpickr(planDateInput, { dateFormat:'Y-m-d', disableMobile:true }); } catch {}
    if (planTimeTime) planTimeTime.value = '';
    buildEstOptions(planEstSelect); planEstSelect.value = '0';
    planEditBackdrop.classList.remove('hidden');
  });
  if (addPlanFromTplBtn) addPlanFromTplBtn.addEventListener('click', () => {
    if (!templates.length) { alert('先にテンプレを追加してください'); return; }
    if (!tplSelectBackdrop) return;
    // 一覧を描画
    tplSelectList.innerHTML = '';
    const list = [...templates].filter(t=>t.isRoutine);
    list.sort((a,b)=> (a.timeOfDay||'').localeCompare(b.timeOfDay||''));
    for (const t of list) {
      const chip = document.createElement('button'); chip.className='chip selectable';
      chip.innerHTML = `<span class="dot" style="background:${t.color}"></span>${escapeHtml(t.name)}<span class="meta">${t.timeOfDay||'予定なし'} · ${t.targetDailyMin||0}分</span>`;
      chip.onclick = () => {
        tplSelectBackdrop.classList.add('hidden');
        planEditMode = 'create'; planEditTargetId = null;
    planNameInput.value = t.name||'';
    if (planTimeTime) planTimeTime.value = t.timeOfDay||'';
    buildEstOptions(planEstSelect); planEstSelect.value = String(t.targetDailyMin||0);
        planEditBackdrop.classList.remove('hidden');
        planEditBackdrop.dataset.templateId = t.id;
        if (planDateInput) planDateInput.value = planViewDateKey || getPlanDateKey(Date.now());
      };
      tplSelectList.appendChild(chip);
    }
    tplSelectBackdrop.classList.remove('hidden');
  });
  if (tplSelectCancelBtn && tplSelectBackdrop) {
    tplSelectCancelBtn.addEventListener('click', ()=> tplSelectBackdrop.classList.add('hidden'));
    tplSelectBackdrop.addEventListener('click', (e)=>{ if (e.target===tplSelectBackdrop) tplSelectBackdrop.classList.add('hidden'); });
  }
  // Switch custom estimate inputs visibility
  function wireCustomEstimate(selectEl, customEl) {
    if (!selectEl || !customEl) return;
    const sync = ()=> { customEl.style.display = (selectEl.value==='custom') ? 'block' : 'none'; };
    selectEl.addEventListener('change', sync); sync();
  }
  wireCustomEstimate(planEstSelect, planEstCustom);
  wireCustomEstimate(routineEstSelect, routineEstCustom);
  if (rolloverBtn) rolloverBtn.addEventListener('click', rolloverIncompleteToTomorrow);
  if (genTomorrowBtn) genTomorrowBtn.addEventListener('click', generateTomorrowPlanFromRoutines);
  // Quick Start modal events
  if (qsSkipBtn && quickStartBackdrop) {
    // 紐付けせず開始（未紐づけ）
    qsSkipBtn.addEventListener('click', ()=>{
      const name = (qsNameInput&&qsNameInput.value.trim()) || pendingQuickStartName || '無題';
      const tags = (qsTagsInput&&qsTagsInput.value||'').split(',').map(s=>s.trim()).filter(Boolean);
      quickStartBackdrop.classList.add('hidden');
      startTask({ name, templateId: null, planId: null });
      if (active) { active.meta.quickDefaultTags = tags; persistAll(); }
    });
    // 背景クリックはキャンセル（開始しない）
    quickStartBackdrop.addEventListener('click', (e)=>{ if (e.target===quickStartBackdrop) quickStartBackdrop.classList.add('hidden'); });
    // ESC to close (cancel)
    document.addEventListener('keydown', (e)=>{
      if (!quickStartBackdrop || quickStartBackdrop.classList.contains('hidden')) return;
      if (e.key === 'Escape') { e.preventDefault(); quickStartBackdrop.classList.add('hidden'); }
    });
  }
  if (qsSaveBtn) qsSaveBtn.addEventListener('click', ()=>{
    const name = (qsNameInput&&qsNameInput.value.trim()) || pendingQuickStartName || '無題';
    let estimateMin = 0;
    if (qsEstSelect && qsEstSelect.value === 'custom') estimateMin = parseInt((qsEstCustom&&qsEstCustom.value)||'0',10)||0;
    else estimateMin = parseInt((qsEstSelect&&qsEstSelect.value)||'0',10)||0;
    const tags = (qsTagsInput&&qsTagsInput.value||'').split(',').map(s=>s.trim()).filter(Boolean);
    // 当日プランに追加して開始
    const dateKey = getPlanDateKey(Date.now());
    const order = (settings.plans.filter(p=>p.date===dateKey).reduce((m,p)=>Math.max(m, p.order||0), 0) + 1);
    const plan = { id: uuid(), date: dateKey, templateId: null, name, estimateMin, scheduledAt: '', status: 'todo', order };
    settings.plans.push(plan);
    persistAll();
    quickStartBackdrop && quickStartBackdrop.classList.add('hidden');
    // 開始 + デフォルトタグをactive.metaへ一時保持（停止時にマージ）
    startTask({ name, templateId: null, planId: plan.id });
    if (active) { active.meta.quickDefaultTags = tags; persistAll(); }
  });
  if (prevWeekBtn) prevWeekBtn.addEventListener('click', () => { timelineStart -= 7*24*3600*1000; renderTimeline(); });
  if (thisWeekBtn) thisWeekBtn.addEventListener('click', () => { timelineStart = startOfWeekWallclock(Date.now()); renderTimeline(); });
  if (nextWeekBtn) nextWeekBtn.addEventListener('click', () => { timelineStart += 7*24*3600*1000; renderTimeline(); });
  if (zoomSelect) zoomSelect.addEventListener('change', () => {
    const v = parseInt(zoomSelect.value||'60',10);
    TIMELINE_HOUR_PX = ([36,40,48,60,72].includes(v)) ? v : 60;
    applyTimelineCssVar();
    renderTimeline();
  });
  if (icsImportBtn && icsFileInput) {
    icsImportBtn.addEventListener('click', ()=> icsFileInput.click());
    icsFileInput.addEventListener('change', async (e)=>{
      const file = e.target.files && e.target.files[0]; if (!file) return;
      const text = await file.text();
      importIcsText(text);
      icsFileInput.value = '';
    });
  }

  // ---- Settings: day boundary ----
  const applyBoundaryToPlanCheckbox = document.querySelector('#applyBoundaryToPlanCheckbox');
  if (dayBoundaryInput) {
    dayBoundaryInput.value = String(settings.dayBoundaryHour||0);
    dayBoundaryInput.addEventListener('change', ()=>{
      let v = parseInt(dayBoundaryInput.value||'0',10);
      if (Number.isNaN(v) || v<0) v = 0; if (v>12) v=12;
      settings.dayBoundaryHour = v;
      persistAll();
      // 再注入: 境界変更でtodayKeyが変わるケースに対応
      ensureTodayRoutinesInPlan();
      render();
    });
  }
  const autoDoneOnStopCheckbox = document.querySelector('#autoDoneOnStopCheckbox');
  const autoStartNextCheckbox = document.querySelector('#autoStartNextCheckbox');
  const autoEstimateLearnCheckbox = document.querySelector('#autoEstimateLearnCheckbox');
  const weeklyBackupReminderCheckbox = document.querySelector('#weeklyBackupReminderCheckbox');
  const autoDownloadBackupCheckbox = document.querySelector('#autoDownloadBackupCheckbox');
  const chainEnabledCheckbox = document.querySelector('#chainEnabledCheckbox');
  const chainBaseSelect = document.querySelector('#chainBaseSelect');
  const workStartInput = document.querySelector('#workStartInput');
  const workEndInput = document.querySelector('#workEndInput');
  const lunchMinInput = document.querySelector('#lunchMinInput');
  const lunchStartInput = document.querySelector('#lunchStartInput');
  const lunchEndInput = document.querySelector('#lunchEndInput');
  const autoBackupEnabledCheckbox = document.querySelector('#autoBackupEnabledCheckbox');
  const autoBackupIntervalInput = document.querySelector('#autoBackupIntervalInput');
  const logLevelSelect = document.querySelector('#logLevelSelect');
  if (applyBoundaryToPlanCheckbox) {
    applyBoundaryToPlanCheckbox.checked = !!settings.applyBoundaryToPlan;
    applyBoundaryToPlanCheckbox.addEventListener('change', ()=>{
      settings.applyBoundaryToPlan = !!applyBoundaryToPlanCheckbox.checked;
      persistAll();
      renderPlan();
    });
  }
  if (autoDoneOnStopCheckbox) {
    autoDoneOnStopCheckbox.checked = !!settings.autoDoneOnStop;
    autoDoneOnStopCheckbox.addEventListener('change', ()=>{
      settings.autoDoneOnStop = !!autoDoneOnStopCheckbox.checked;
      persistAll();
    });
  }
  if (autoStartNextCheckbox) {
    autoStartNextCheckbox.checked = !!settings.autoStartNext;
    autoStartNextCheckbox.addEventListener('change', ()=>{ settings.autoStartNext = !!autoStartNextCheckbox.checked; persistAll(); });
  }
  if (autoEstimateLearnCheckbox) {
    autoEstimateLearnCheckbox.checked = !!settings.autoEstimateLearn;
    autoEstimateLearnCheckbox.addEventListener('change', ()=>{ settings.autoEstimateLearn = !!autoEstimateLearnCheckbox.checked; persistAll(); });
  }
  if (weeklyBackupReminderCheckbox) {
    weeklyBackupReminderCheckbox.checked = !!settings.weeklyBackupReminder;
    weeklyBackupReminderCheckbox.addEventListener('change', ()=>{ settings.weeklyBackupReminder = !!weeklyBackupReminderCheckbox.checked; persistAll(); });
  }
  if (autoDownloadBackupCheckbox) {
    if (typeof settings.autoDownloadBackup === 'undefined') settings.autoDownloadBackup = false;
    autoDownloadBackupCheckbox.checked = !!settings.autoDownloadBackup;
    autoDownloadBackupCheckbox.addEventListener('change', ()=>{ settings.autoDownloadBackup = !!autoDownloadBackupCheckbox.checked; persistAll(); });
  }
  // Chain settings wiring
  if (chainEnabledCheckbox) {
    chainEnabledCheckbox.checked = !!settings.chainEnabled;
    chainEnabledCheckbox.addEventListener('change', ()=>{ settings.chainEnabled = !!chainEnabledCheckbox.checked; persistAll(); render(); });
  }
  if (chainBaseSelect) {
    chainBaseSelect.value = (settings.chainBase==='first') ? 'first' : 'now';
    chainBaseSelect.addEventListener('change', ()=>{ settings.chainBase = chainBaseSelect.value === 'first' ? 'first' : 'now'; persistAll(); render(); });
  }
  if (logLevelSelect) {
    if (typeof settings.logLevel === 'undefined') settings.logLevel = 'warn';
    logLevelSelect.value = settings.logLevel;
    logLevelSelect.addEventListener('change', ()=>{ settings.logLevel = logLevelSelect.value; persistAll(); });
  }
  const icsExpandDaysInput = document.querySelector('#icsExpandDaysInput');
  const icsMaxEventsInput = document.querySelector('#icsMaxEventsInput');
  const budgetWarnThresholdInput = document.querySelector('#budgetWarnThresholdInput');
  const budgetOverThresholdInput = document.querySelector('#budgetOverThresholdInput');
  if (icsExpandDaysInput) {
    if (typeof settings.icsExpandDays === 'undefined') settings.icsExpandDays = 35;
    icsExpandDaysInput.value = String(settings.icsExpandDays||35);
    icsExpandDaysInput.addEventListener('change', ()=>{
      let v = parseInt(icsExpandDaysInput.value||'35',10);
      if (Number.isNaN(v) || v<7) v = 7; if (v>180) v=180;
      settings.icsExpandDays = v; persistAll();
    });
  }
  if (icsMaxEventsInput) {
    if (typeof settings.icsMaxEvents === 'undefined') settings.icsMaxEvents = 2000;
    icsMaxEventsInput.value = String(settings.icsMaxEvents||2000);
    icsMaxEventsInput.addEventListener('change', ()=>{
      let v = parseInt(icsMaxEventsInput.value||'2000',10);
      if (Number.isNaN(v) || v<200) v = 200; if (v>20000) v=20000;
      settings.icsMaxEvents = v; persistAll();
    });
  }
  if (budgetWarnThresholdInput && budgetOverThresholdInput) {
    if (typeof settings.budgetWarnPct === 'undefined') settings.budgetWarnPct = 80;
    if (typeof settings.budgetOverPct === 'undefined') settings.budgetOverPct = 110;
    budgetWarnThresholdInput.value = String(settings.budgetWarnPct);
    budgetOverThresholdInput.value = String(settings.budgetOverPct);
    budgetWarnThresholdInput.addEventListener('change', ()=>{
      let v = parseInt(budgetWarnThresholdInput.value||'80',10); if (Number.isNaN(v)) v=80; v=Math.max(50,Math.min(120,v)); settings.budgetWarnPct=v; persistAll();
    });
    budgetOverThresholdInput.addEventListener('change', ()=>{
      let v = parseInt(budgetOverThresholdInput.value||'110',10); if (Number.isNaN(v)) v=110; v=Math.max(90,Math.min(200,v)); settings.budgetOverPct=v; persistAll();
    });
  }
  // Bedtime setting
  const bedtimeInput = document.querySelector('#bedtimeInput');
  if (bedtimeInput) {
    if (settings.bedtime) bedtimeInput.value = settings.bedtime;
    bedtimeInput.addEventListener('change', ()=>{
      settings.bedtime = bedtimeInput.value || '';
      persistAll();
      try { renderNowNextBar((settings.plans||[]).filter(p=>p.date===getPlanDateKey(Date.now()))); } catch {}
    });
  }
  // Capacity inputs wiring
  if (workStartInput) { if (settings.workStart) workStartInput.value = settings.workStart; workStartInput.addEventListener('change', ()=>{ settings.workStart = workStartInput.value||''; persistAll(); renderNowNextBar((settings.plans||[]).filter(p=>p.date===getPlanDateKey(Date.now()))); }); }
  if (workEndInput) { if (settings.workEnd) workEndInput.value = settings.workEnd; workEndInput.addEventListener('change', ()=>{ settings.workEnd = workEndInput.value||''; persistAll(); renderNowNextBar((settings.plans||[]).filter(p=>p.date===getPlanDateKey(Date.now()))); }); }
  if (lunchMinInput) { lunchMinInput.value = String(settings.lunchMin||0); lunchMinInput.addEventListener('change', ()=>{ let v=parseInt(lunchMinInput.value||'0',10)||0; v=Math.max(0,Math.min(180,v)); settings.lunchMin=v; persistAll(); renderNowNextBar((settings.plans||[]).filter(p=>p.date===getPlanDateKey(Date.now()))); }); }
  if (lunchStartInput) { if (settings.lunchStart) lunchStartInput.value = settings.lunchStart; lunchStartInput.addEventListener('change', ()=>{ settings.lunchStart = lunchStartInput.value||''; persistAll(); renderNowNextBar((settings.plans||[]).filter(p=>p.date===getPlanDateKey(Date.now()))); }); }
  if (lunchEndInput) { if (settings.lunchEnd) lunchEndInput.value = settings.lunchEnd; lunchEndInput.addEventListener('change', ()=>{ settings.lunchEnd = lunchEndInput.value||''; persistAll(); renderNowNextBar((settings.plans||[]).filter(p=>p.date===getPlanDateKey(Date.now()))); }); }
  // Auto-backup wiring
  if (autoBackupEnabledCheckbox) { autoBackupEnabledCheckbox.checked = !!settings.autoBackupEnabled; autoBackupEnabledCheckbox.addEventListener('change', ()=>{ settings.autoBackupEnabled = !!autoBackupEnabledCheckbox.checked; persistAll(); setupAutoBackupTimer(); }); }
  if (autoBackupIntervalInput) { autoBackupIntervalInput.value = String(settings.autoBackupIntervalMin||60); autoBackupIntervalInput.addEventListener('change', ()=>{ let v=parseInt(autoBackupIntervalInput.value||'60',10)||60; v=Math.max(5,Math.min(720,v)); settings.autoBackupIntervalMin=v; persistAll(); setupAutoBackupTimer(); }); }

  // ---- Keyboard Shortcuts ----
  document.addEventListener('keydown', (e)=>{
    const isMac = navigator.platform && navigator.platform.toUpperCase().includes('MAC');
    const mod = isMac ? e.metaKey : e.ctrlKey;
    // Start/Stop
    if (!mod && e.code === 'Space') { e.preventDefault(); startStopBtn && startStopBtn.click(); }
    if (mod && e.key === 'Enter') { e.preventDefault(); startStopBtn && startStopBtn.click(); }
    // Quick memo
    if (!mod && e.key.toLowerCase() === 'm') { e.preventDefault(); quickNoteBtn && quickNoteBtn.click(); }
    if (!mod && e.key === '/') { if (searchInput) { e.preventDefault(); searchInput.focus(); } }
    if (!mod && e.key.toLowerCase() === 'f') { if (focusBtn) { e.preventDefault(); focusBtn.click(); } }
    // Stop modal quick choices: 1=完了, 2=分割, 3=続ける
    if (!mod && ['1','2','3'].includes(e.key)) {
      const radios = stopPlanActionRadios && stopPlanActionRadios();
      if (radios && radios.length>0 && backdrop && !backdrop.classList.contains('hidden')) {
        e.preventDefault();
        const map = { '1':'complete','2':'split','3':'continue' };
        const val = map[e.key];
        radios.forEach(r=>{ if (r.value===val) r.checked=true; });
        modalSaveBtn && modalSaveBtn.click();
      }
    }
    // Plan move j/k (today only)
    if (!mod && (e.key.toLowerCase()==='j' || e.key.toLowerCase()==='k')) {
      const todayKey = getPlanDateKey(Date.now());
      const list = (settings.plans||[]).filter(p=>p.date===todayKey).sort((a,b)=> (a.order||0)-(b.order||0));
      const running = isRunning()? list.find(p=> (active.planId && p.id===active.planId) || (p.templateId && active.templateId && p.templateId===active.templateId) || p.name===active.name) : null;
      if (running) {
        e.preventDefault();
        const idx = list.findIndex(p=>p.id===running.id);
        const delta = (e.key.toLowerCase()==='j') ? 1 : -1;
        const neighbor = list[idx+delta];
        if (neighbor) {
          const oi = running.order||0; running.order = neighbor.order||0; neighbor.order = oi; persistAll(); renderPlan();
        }
      }
    }
    // Pomodoro quick
    if (!mod && e.key.toLowerCase()==='p') { const btn = document.querySelector('#focusPomodoroBtn'); if (btn) { e.preventDefault(); btn.click(); } }
  });
  // Plan date navigator
  if (planViewDate) {
    planViewDate.value = formatDateWall(Date.now());
    // Initialize Flatpickr if available
    try {
      if (window.flatpickr) {
        window.flatpickr(planViewDate, {
          dateFormat: 'Y-m-d',
          defaultDate: planViewDate.value,
          disableMobile: true,
          onChange: (selectedDates, dateStr) => {
            planViewDate.value = dateStr;
            const todayStr = formatDateWall(Date.now());
            planViewDateKey = (dateStr && dateStr === todayStr) ? null : ((dateStr||'').trim() || null);
            renderPlan();
          }
        });
      }
    } catch {}
    planViewDate.addEventListener('change', ()=>{
      const v = (planViewDate.value||'').trim();
      const todayStr = formatDateWall(Date.now());
      planViewDateKey = v ? (v === todayStr ? null : v) : null;
      renderPlan();
    });
  }
  if (planPrevDayBtn) planPrevDayBtn.addEventListener('click', ()=>{
    const todayStr = getPlanDateKey(Date.now());
    const base = planViewDateKey || todayStr;
    const d = new Date(base+'T00:00'); d.setDate(d.getDate()-1);
    planViewDateKey = formatDateWall(d.getTime());
    const wallToday = formatDateWall(Date.now());
    if (planViewDateKey === wallToday) planViewDateKey = null;
    if (planViewDate) planViewDate.value = planViewDateKey;
    renderPlan();
  });
  if (planTodayBtn) planTodayBtn.addEventListener('click', ()=>{
    planViewDateKey = null; // null means today
    if (planViewDate) planViewDate.value = formatDateWall(Date.now());
    renderPlan();
    try {
      if (nowNextBar) {
        const todayKey = getPlanDateKey(Date.now());
        const todays = (settings.plans||[]).filter(p=>p.date===todayKey);
        renderNowNextBar(todays);
      }
    } catch {}
  });
  if (planNextDayBtn) planNextDayBtn.addEventListener('click', ()=>{
    const todayStr = getPlanDateKey(Date.now());
    const base = planViewDateKey || todayStr;
    const d = new Date(base+'T00:00'); d.setDate(d.getDate()+1);
    planViewDateKey = formatDateWall(d.getTime());
    const wallToday = formatDateWall(Date.now());
    if (planViewDateKey === wallToday) planViewDateKey = null;
    if (planViewDate) planViewDate.value = planViewDateKey;
    renderPlan();
  });
  if (icsParseBtn && icsTextInput) {
    icsParseBtn.addEventListener('click', ()=> importIcsText(icsTextInput.value||''));
  }

  // ---- Review Save ----
  if (!settings.reviewMemos) settings.reviewMemos = {};
  if (reviewSaveBtn) {
    reviewSaveBtn.addEventListener('click', ()=>{
      const key = formatDateWall(Date.now());
      settings.reviewMemos[key] = { memo: (reviewMemo&&reviewMemo.value)||'', tomorrow: (tomorrowNote&&tomorrowNote.value)||'' };
      persistAll();
      renderReviewHistory();
      alert('レビューを保存しました');
    });
  }
  // Close Day: require memo, rollover incomplete, lock today's plans (mark skipped as carried)
  const closeDayBtn = document.querySelector('#closeDayBtn');
  if (closeDayBtn) {
    closeDayBtn.addEventListener('click', ()=>{
      const key = formatDateWall(Date.now());
      const memo = (reviewMemo&&reviewMemo.value||'').trim();
      if (!memo) { alert('日次レビューの「今日の所感」を入力してください'); return; }
      settings.reviewMemos[key] = { memo, tomorrow: (tomorrowNote&&tomorrowNote.value)||'' };
      // Rollover incomplete to tomorrow
      try { rolloverIncompleteToTomorrow(); } catch {}
      // Mark today's non-done as skipped-locked (optional minimal lock)
      const todayKey = getPlanDateKey(Date.now());
      for (const p of (settings.plans||[])) if (p.date===todayKey && p.status!=='done') { p.status = p.status||'todo'; }
      persistAll(); renderPlan(); renderReviewHistory();
      alert('日次を締めました');
    });
  }
  // ---- WebDAV sync wiring ----

  function importIcsText(text) {
    if (!text.trim()) { alert('ICSテキストが空です'); return; }
    // 超簡易ICSパーサ（VEVENTのみ, unfold + TZID対応最小）
    const todayKey = getPlanDateKey(Date.now());
    const rawLines = text.split(/\r?\n/);
    // Unfold (RFC5545): 改行後の先頭スペースは前行に連結
    const lines = [];
    for (let i=0;i<rawLines.length;i++) {
      const ln = rawLines[i];
      if (i>0 && (/^[ \t]/).test(ln)) { lines[lines.length-1] += ln.slice(1); } else { lines.push(ln); }
    }
    let cur = null; let count = 0;
    const events = [];
    for (const ln of lines) {
      if (ln.startsWith('BEGIN:VEVENT')) { cur = {}; }
      else if (ln.startsWith('END:VEVENT')) { if (cur) { events.push(cur); cur=null; } }
      else if (cur) {
        if (ln.startsWith('SUMMARY:')) cur.summary = ln.slice(8).trim();
        else if (ln.startsWith('DTSTART')) {
          const [prop, val] = ln.split(/:(.+)/);
          const tz = (prop.match(/TZID=([^;:]+)/)||[])[1]||'';
          cur.dtstart = parseIcsDateWithTz(val, tz);
        }
        else if (ln.startsWith('DTEND')) {
          const [prop, val] = ln.split(/:(.+)/);
          const tz = (prop.match(/TZID=([^;:]+)/)||[])[1]||'';
          cur.dtend = parseIcsDateWithTz(val, tz);
        }
        else if (ln.startsWith('UID:')) { cur.uid = ln.slice(4).trim(); }
        else if (ln.startsWith('RRULE:')) { cur.rrule = ln.slice(6).trim(); }
        else if (ln.startsWith('EXDATE')) { (cur.exdates||(cur.exdates=[])).push(ln.split(':').pop().trim()); }
      }
    }
    // 各イベント発生日のプランに追加
    settings._icsUid = settings._icsUid || {};
    const added = [];
    let producedBefore = 0;
    for (const ev of expandRecurrences(events)) {
      if (!ev.dtstart || !ev.dtend) continue;
      const uidKey = (ev.uid||'') + '|' + toIcsUtc(new Date(ev.dtstart));
      if (ev.uid && settings._icsUid[uidKey]) continue; // duplicate guard
      const dkey = formatDateWall(ev.dtstart.getTime());
      const hh = String(ev.dtstart.getHours()).padStart(2,'0');
      const mm = String(ev.dtstart.getMinutes()).padStart(2,'0');
      const mins = Math.max(1, Math.round((ev.dtend - ev.dtstart)/60000));
      addPlanItemAtDate(dkey, { name: ev.summary||'予定', templateId: null, estimateMin: mins, scheduledAt: `${hh}:${mm}` });
      if (ev.uid) settings._icsUid[uidKey] = true;
      added.push((ev.summary||'予定')+` @${dkey}`);
    }
    // show count; if likely truncated by maxEvents, inform
    try {
      const maxEvents = Math.max(200, Math.min(20000, settings.icsMaxEvents||2000));
      if (added.length >= maxEvents) {
        const goSetting = confirm(`${added.length} 件取り込みました（上限に達した可能性があります）。設定を開きますか？`);
        if (goSetting) {
          try {
            const el = document.querySelector('#settings');
            if (el && typeof el.scrollIntoView==='function') el.scrollIntoView({ behavior:'smooth', block:'start' });
          } catch {}
        }
      } else {
        alert(`${added.length} 件取り込みました`);
      }
    } catch { alert(`${added.length} 件取り込みました`); }
  }

  function parseIcsDate(v) {
    // 例: 20250105T090000Z or 20250105T090000
    const m = v.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/);
    if (!m) return null;
    const [_,y,mo,d,h,mi,s,z] = m;
    if (z==='Z') return new Date(Date.UTC(+y,+mo-1,+d,+h,+mi,+s));
    return new Date(+y,+mo-1,+d,+h,+mi,+s);
  }

  function parseIcsDateWithTz(v, tzid) {
    const d = parseIcsDate(v);
    if (!d) return null;
    if (!tzid) return d; // local as-is or UTC handled above
    try {
      // naive TZ shift using Intl: format parts in tz then rebuild Date in local
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tzid, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
      const parts = fmt.formatToParts(d).reduce((o,p)=> (o[p.type]=p.value, o), {});
      const y = +parts.year, mo = +parts.month, da = +parts.day, hh = +parts.hour, mm = +parts.minute, ss = +parts.second;
      return new Date(y, mo-1, da, hh, mm, ss);
    } catch { return d; }
  }

  function expandRecurrences(events) {
    const out = [];
    const now = new Date();
    const days = Math.max(7, Math.min(180, settings.icsExpandDays||35));
    const until = new Date(now.getTime() + days*24*3600*1000);
    const maxEvents = Math.max(200, Math.min(20000, settings.icsMaxEvents||2000));
    let produced = 0;
    for (const ev of events) {
      if (!ev.rrule) { out.push(ev); continue; }
      // Very small RRULE support: FREQ=DAILY|WEEKLY;INTERVAL=n;COUNT=?;UNTIL=YYYYMMDDT...
      const rule = Object.fromEntries(ev.rrule.split(';').map(x=>x.split('=')));
      const freq = rule.FREQ||''; const interval = Math.max(1, parseInt(rule.INTERVAL||'1',10)||1);
      let untilDate = rule.UNTIL ? parseIcsDate(rule.UNTIL) : until;
      let count = parseInt(rule.COUNT||'0',10)||0;
      const exSet = new Set((ev.exdates||[]).map(x=> (parseIcsDate(x)||new Date(0)).toDateString()));
      let i = 0; let curStart = new Date(ev.dtstart); let curEnd = new Date(ev.dtend);
      if (freq==='WEEKLY' && rule.BYDAY) {
        // Support BYDAY like MO,TU,... within each week window
        const map = { MO:0, TU:1, WE:2, TH:3, FR:4, SA:5, SU:6 };
        const days = String(rule.BYDAY).split(',').map(x=>map[x] ?? null).filter(v=> v!=null);
        // start from the week of DTSTART (Monday=0 as in startOfWeekWallclock)
        const week0 = startOfWeekWallclock(curStart.getTime());
        let w = 0; let emitted = 0;
        while (true) {
          const weekStart = week0 + w*interval*7*24*3600*1000;
          if (weekStart > untilDate.getTime()) break;
          for (const d of days) {
            const dt = new Date(weekStart + d*24*3600*1000);
            // apply original time components
            dt.setHours(curStart.getHours(), curStart.getMinutes(), curStart.getSeconds(), 0);
            const dtEnd = new Date(dt.getTime() + (curEnd.getTime()-curStart.getTime()));
            if (dt < curStart) continue; // do not emit before DTSTART
            if (dt > untilDate) break;
            if (!exSet.has(dt.toDateString())) { out.push({ ...ev, dtstart: dt, dtend: dtEnd }); emitted++; produced++; if (produced>=maxEvents) return out; }
            if (count>0 && emitted>=count) break;
          }
          if (count>0 && emitted>=count) break;
          w++;
        }
      } else if (freq==='MONTHLY' && rule.BYMONTHDAY) {
        // Support BYMONTHDAY like 1,15,28 (positive only)
        const days = String(rule.BYMONTHDAY).split(',').map(x=>parseInt(x,10)).filter(n=>!Number.isNaN(n));
        let emitted = 0;
        let cursor = new Date(curStart.getFullYear(), curStart.getMonth(), 1, curStart.getHours(), curStart.getMinutes(), curStart.getSeconds());
        while (cursor <= untilDate && (count===0 || emitted<count)) {
          for (const d of days) {
            const dt = new Date(cursor.getFullYear(), cursor.getMonth(), d, curStart.getHours(), curStart.getMinutes(), curStart.getSeconds());
            if (dt < curStart) continue;
            if (dt > untilDate) break;
            const dtEnd = new Date(dt.getTime() + (curEnd.getTime()-curStart.getTime()));
            if (!exSet.has(dt.toDateString())) { out.push({ ...ev, dtstart: dt, dtend: dtEnd }); emitted++; produced++; if (produced>=maxEvents) return out; }
            if (count>0 && emitted>=count) break;
          }
          // step months by interval
          cursor = new Date(cursor.getFullYear(), cursor.getMonth()+interval, 1, cursor.getHours(), cursor.getMinutes(), cursor.getSeconds());
        }
      } else if (freq==='MONTHLY' && rule.BYDAY && rule.BYSETPOS) {
        // Example: FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1 => first Monday each month
        const map = { MO:1, TU:2, WE:3, TH:4, FR:5, SA:6, SU:0 };
        const days = String(rule.BYDAY).split(',').map(x=> map[x] ?? null).filter(v=> v!=null);
        const setposes = String(rule.BYSETPOS).split(',').map(x=>parseInt(x,10)).filter(n=>!Number.isNaN(n) && n!==0); // allow 1..4 or -1
        const monthFilter = rule.BYMONTH ? new Set(String(rule.BYMONTH).split(',').map(x=>parseInt(x,10)).filter(n=>!Number.isNaN(n))) : null;
        let emitted = 0;
        let cursor = new Date(curStart.getFullYear(), curStart.getMonth(), 1, curStart.getHours(), curStart.getMinutes(), curStart.getSeconds());
        while (cursor <= untilDate && (count===0 || emitted<count)) {
          const year = cursor.getFullYear(); const month = cursor.getMonth();
          if (monthFilter && !monthFilter.has(month+1)) { cursor = new Date(year, month+interval, 1, curStart.getHours(), curStart.getMinutes(), curStart.getSeconds()); continue; }
          for (const dow of days) {
            for (const setpos of setposes) {
              let dt = null;
              if (setpos > 0) {
                // find first 'dow' in month, then add weeks
                const first = new Date(year, month, 1, curStart.getHours(), curStart.getMinutes(), curStart.getSeconds());
                const firstDow = first.getDay();
                const diff = (dow - firstDow + 7) % 7;
                const day = 1 + diff + (setpos-1)*7;
                dt = new Date(year, month, day, curStart.getHours(), curStart.getMinutes(), curStart.getSeconds());
              } else {
                // last occurrence: go to last day of month and step back
                const last = new Date(year, month+1, 0, curStart.getHours(), curStart.getMinutes(), curStart.getSeconds());
                const lastDow = last.getDay();
                const diff = (lastDow - dow + 7) % 7;
                dt = new Date(year, month, last.getDate() - diff, curStart.getHours(), curStart.getMinutes(), curStart.getSeconds());
              }
              if (!dt || dt < curStart) continue;
              if (dt > untilDate) break;
              const dtEnd = new Date(dt.getTime() + (curEnd.getTime()-curStart.getTime()));
              if (!exSet.has(dt.toDateString())) { out.push({ ...ev, dtstart: dt, dtend: dtEnd }); emitted++; }
              if (count>0 && emitted>=count) break;
            }
            if (count>0 && emitted>=count) break;
          }
          cursor = new Date(year, month+interval, 1, curStart.getHours(), curStart.getMinutes(), curStart.getSeconds());
        }
      } else if (rule.BYMONTH) {
        // If BYMONTH specified, restrict generations to the listed months
        const months = String(rule.BYMONTH).split(',').map(x=>parseInt(x,10)).filter(n=>!Number.isNaN(n));
        const monthSet = new Set(months);
        while (curStart <= untilDate && (count===0 || i<count)) {
          if (monthSet.has(curStart.getMonth()+1)) {
            if (!exSet.has(curStart.toDateString())) { out.push({ ...ev, dtstart: new Date(curStart), dtend: new Date(curEnd) }); produced++; if (produced>=maxEvents) return out; }
            i++;
          }
          if (freq==='DAILY') { curStart = new Date(curStart.getTime() + interval*24*3600*1000); curEnd = new Date(curEnd.getTime() + interval*24*3600*1000); }
          else if (freq==='WEEKLY') { curStart = new Date(curStart.getTime() + interval*7*24*3600*1000); curEnd = new Date(curEnd.getTime() + interval*7*24*3600*1000); }
          else if (freq==='MONTHLY') { curStart = new Date(curStart.getFullYear(), curStart.getMonth()+1, curStart.getDate(), curStart.getHours(), curStart.getMinutes(), curStart.getSeconds()); curEnd = new Date(curEnd.getFullYear(), curEnd.getMonth()+1, curEnd.getDate(), curEnd.getHours(), curEnd.getMinutes(), curEnd.getSeconds()); }
          else break;
        }
      } else {
        while (curStart <= untilDate && (count===0 || i<count)) {
          if (!exSet.has(curStart.toDateString())) { out.push({ ...ev, dtstart: new Date(curStart), dtend: new Date(curEnd) }); produced++; if (produced>=maxEvents) return out; }
          i++;
          if (freq==='DAILY') { curStart = new Date(curStart.getTime() + interval*24*3600*1000); curEnd = new Date(curEnd.getTime() + interval*24*3600*1000); }
          else if (freq==='WEEKLY') { curStart = new Date(curStart.getTime() + interval*7*24*3600*1000); curEnd = new Date(curEnd.getTime() + interval*7*24*3600*1000); }
          else break; // unsupported
        }
      }
    }
    return out;
  }

  // 4) カレンダー書き込み（最小）：今日のログをICSとしてエクスポート
  function exportTodayIcs() {
    const from = startOfDay(Date.now());
    const to = from + 24*3600*1000;
    const dayLogs = sessions.filter(s=> s.startAt>=from && s.startAt<to);
    const lines = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//TaskShoot Mini//JP');
    lines.push('CALSCALE:GREGORIAN');
    for (const s of dayLogs) {
      lines.push('BEGIN:VEVENT');
      lines.push('SUMMARY:' + icsFold('SUMMARY:' + icsEscape(s.name||'タスク')));
      lines.push('DTSTART:' + toIcsUtc(new Date(s.startAt)));
      lines.push('DTEND:' + toIcsUtc(new Date(s.endAt)));
      if (s.note) lines.push(icsFold('DESCRIPTION:' + icsEscape(s.note)));
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\n')], { type: 'text/calendar;charset=utf-8;' });
    shareOrDownload('text/calendar', `taskshoot_${getPlanDateKey(Date.now())}.ics`, blob);
  }
  function toIcsUtc(d) {
    const y=d.getUTCFullYear(); const m=String(d.getUTCMonth()+1).padStart(2,'0'); const dd=String(d.getUTCDate()).padStart(2,'0');
    const hh=String(d.getUTCHours()).padStart(2,'0'); const mm=String(d.getUTCMinutes()).padStart(2,'0'); const ss=String(d.getUTCSeconds()).padStart(2,'0');
    return `${y}${m}${dd}T${hh}${mm}${ss}Z`;
  }
  function icsEscape(s) {
    return String(s).replace(/[\\,;]/g, '\\$&').replace(/\n/g, '\\n');
  }
  // Fold long ICS lines to 75 octets with CRLF + space continuation
  function icsFold(line) {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      let j = Math.min(i + 75, bytes.length);
      // avoid splitting surrogate pairs: back up if we cut mid-UTF-8
      // find a safe split by decoding
      let chunk = bytes.slice(i, j);
      // try decoding; if fails, back off
      while (j > i) {
        try { chunk = bytes.slice(i, j); new TextDecoder().decode(chunk); break; } catch { j--; }
      }
      out += (i===0 ? '' : '\r\n ') + new TextDecoder().decode(chunk);
      i = j;
    }
    return out;
  }

  // JSON Export/Import (5) クラウド同期の前段（手動バックアップ）
  function exportAllJson() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        templates,
        sessions,
        active,
        settings,
      }
    };
    const blob = new Blob([JSON.stringify(payload,null,2)], { type: 'application/json;charset=utf-8;' });
    shareOrDownload('application/json', `taskshoot_backup_${getPlanDateKey(Date.now())}.json`, blob);
  }
  // WebDAV関連のイベント/ヘルパーは削除
  function importAllJson(text) {
    try {
      const obj = JSON.parse(text);
      if (!obj || !obj.data) throw new Error('invalid');
      const d = obj.data;
      if (!Array.isArray(d.templates) || !Array.isArray(d.sessions)) throw new Error('invalid');
      templates = d.templates; sessions = d.sessions; active = d.active || null; settings = d.settings || settings;
      persistAll();
      render();
      alert('インポート完了');
    } catch (e) {
      alert('JSONの形式が正しくありません');
    }
  }

  // Share via OS sheet if supported; fallback to download
  async function shareOrDownload(mime, filename, blob) {
    try {
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'TaskShoot Mini', text: filename });
        return;
      }
      if (navigator.share) {
        const url = URL.createObjectURL(blob);
        await navigator.share({ title: filename, url });
        URL.revokeObjectURL(url);
        return;
      }
    } catch (e) { /* fallthrough */ }
    // add timestamp suffix to filenames to keep generations
    try {
      const dot = filename.lastIndexOf('.');
      const base = dot>0 ? filename.slice(0,dot) : filename;
      const ext = dot>0 ? filename.slice(dot) : '';
      const stamp = '_' + new Date().toISOString().replace(/[:.]/g,'-');
      filename = base + stamp + ext;
    } catch {}
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  }

  // ---- Auto JSON backup timer ----
  let autoBackupTimer = null;
  function setupAutoBackupTimer() {
    try { if (autoBackupTimer) clearInterval(autoBackupTimer); } catch {}
    if (!settings.autoBackupEnabled) return;
    const intervalMs = Math.max(5, Math.min(720, settings.autoBackupIntervalMin||60)) * 60000;
    autoBackupTimer = setInterval(()=>{
      try {
        const payload = {
          version: 1,
          exportedAt: new Date().toISOString(),
          data: { templates, sessions, active, settings }
        };
        const blob = new Blob([JSON.stringify(payload,null,2)], { type: 'application/json;charset=utf-8;' });
        shareOrDownload('application/json', `auto_backup_${getPlanDateKey(Date.now())}.json`, blob);
      } catch {}
    }, intervalMs);
  }

  // ---- IndexedDB Mirror (lightweight, non-blocking) ----
  let idbDb = null; let idbInitStarted = false; let idbTimer = null; let idbRetryTimer = null; let idbBackoff = 1000;
  let idbRetryCount = 0; let idbRetryMax = 5;
  async function idbOpen() {
    if (idbDb || idbInitStarted) return idbDb;
    idbInitStarted = true;
    return new Promise((resolve)=>{
      try {
        const req = indexedDB.open('taskshoot-mini', 1);
        req.onupgradeneeded = (e)=>{
          const db = req.result;
          if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('sessions')) {
            const s = db.createObjectStore('sessions', { keyPath: 'id' });
            try { s.createIndex('startAt', 'startAt'); } catch {}
          }
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('active')) db.createObjectStore('active', { keyPath: 'key' });
        };
        req.onsuccess = ()=>{ idbDb = req.result; resolve(idbDb); };
        req.onerror = ()=>{ resolve(null); };
      } catch { resolve(null); }
    });
  }
  function idbTx(store, mode) {
    if (!idbDb) return null;
    try { return idbDb.transaction(store, mode).objectStore(store); } catch { return null; }
  }
  async function idbMirrorAll() {
    const db = await idbOpen(); if (!db) return;
    try {
      // templates (upsert)
      const st = idbTx('templates', 'readwrite');
      if (st) { for (const t of (templates||[])) st.put(t); }
      // sessions (upsert + deletions)
      const ss = idbTx('sessions', 'readwrite');
      if (ss) {
        // chunk upserts to avoid blocking
        const chunk = 500; for (let i=0;i<sessions.length;i+=chunk) {
          for (const s of sessions.slice(i,i+chunk)) ss.put(s);
        }
        const del = (settings._deleted && settings._deleted.sessions) || [];
        for (const id of del) { try { ss.delete(id); } catch {} }
        if (del.length) { settings._deleted.sessions = []; }
      }
      // settings
      const se = idbTx('settings', 'readwrite');
      if (se) se.put({ key: 'settings', value: settings });
      const ac = idbTx('active', 'readwrite');
      if (ac) ac.put({ key: 'active', value: active });
      // success: reset backoff and retry counter
      idbBackoff = 1000; idbRetryCount = 0;
    } catch (e) {
      // exponential backoff retry with cap and levelled logging
      try {
        if ((settings.logLevel||'warn') === 'info' || (settings.logLevel||'warn') === 'warn') console.warn('IDB mirror failed', e);
      } catch {}
      idbRetryCount += 1;
      if (idbRetryCount >= idbRetryMax) {
        // notify user once with retry button
        try {
          if (toast && toastMsg && toastRetryBtn) {
            toastMsg.textContent = 'ローカル保存のバックアップに失敗（再試行停止）。再試行しますか？';
            toastUndoBtn.style.display='none'; if (toastDetailBtn) toastDetailBtn.style.display=''; toastRetryBtn.style.display='';
            toast.classList.remove('hidden');
            const errText = String(e && (e.stack||e.message||e.name||e))
            toastRetryBtn.onclick = ()=>{ try { toast.classList.add('hidden'); } catch {} idbRetryCount = 0; idbBackoff = 1000; idbMirrorAll(); };
            if (toastDetailBtn) toastDetailBtn.onclick = ()=>{ if (logDetailBackdrop && logDetailText) { logDetailText.value = errText; logDetailBackdrop.classList.remove('hidden'); setTimeout(()=>{ try { logDetailText.focus(); } catch {} }, 0); } else { alert('エラー詳細:\n' + errText); } };
          } else { showInfoToast('ローカル保存のバックアップに失敗しました（再試行停止）。'); }
        } catch {}
        return;
      }
      idbBackoff = Math.min(idbBackoff*2, 60000);
      clearTimeout(idbRetryTimer); idbRetryTimer = setTimeout(()=>{ idbMirrorAll(); }, idbBackoff);
    }
  }
  function idbMirrorDebounced() {
    if (idbTimer) clearTimeout(idbTimer);
    idbTimer = setTimeout(()=>{ idbMirrorAll(); }, 400);
  }
  // Load from IDB once (if exists) to seed state on cold start
  (async ()=>{
    try {
      const db = await idbOpen(); if (!db) return;
      const load = (store, key)=> new Promise((resolve)=>{
        try {
          const st = idbTx(store, 'readonly'); if (!st) return resolve(null);
          const req = key? st.get(key) : st.getAll();
          req.onsuccess = ()=> resolve(req.result||null);
          req.onerror = ()=> resolve(null);
        } catch { resolve(null); }
      });
      const [tAll, sAll, setObj, actObj] = await Promise.all([
        load('templates'), load('sessions'), load('settings','settings'), load('active','active')
      ]);
      if (Array.isArray(tAll) && tAll.length>0) templates = tAll;
      if (Array.isArray(sAll) && sAll.length>0) sessions = sAll;
      if (setObj && setObj.value) settings = setObj.value;
      if (actObj && actObj.value) active = actObj.value;
      render();
      try { setupAutoBackupTimer(); } catch {}
    } catch {}
  })();

  // 3) ドラッグ編集（最小）: 横移動で開始/終了を同幅でシフト、Alt押下で伸縮
  function enableDragResize(block, session) {
    let startX = 0; let origStart = 0; let origEnd = 0; let dragging=false;
    block.addEventListener('mousedown', (e)=>{
      dragging=true; startX=e.clientX; origStart=session.startAt; origEnd=session.endAt; block.style.cursor='grabbing';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e)=>{
      if (!dragging) return;
      const dayStart = startOfDay(session.startAt);
      const dayMs = 24*3600*1000; const trackWidth = block.parentElement.clientWidth;
      const dx = e.movementX; const deltaMs = Math.round((dx/trackWidth)*dayMs/60000)*60000; // 約1分刻み
      if (e.altKey) {
        // Altで伸縮（右側）
        session.endAt = Math.max(session.startAt+60000, origEnd + deltaMs);
      } else {
        // 横移動（シフト）
        session.startAt = Math.max(dayStart, origStart + deltaMs);
        session.endAt = Math.max(session.startAt+60000, origEnd + deltaMs);
      }
      session.durationSec = Math.max(1, Math.floor((session.endAt - session.startAt)/1000));
      persistAll();
      renderTimeline();
    });
    window.addEventListener('mouseup', ()=>{ if (dragging) { dragging=false; block.style.cursor='grab'; persistAll(); renderLogs(); }});
  }

  // ---- Undo toast ----
  function showUndo(action) {
    if (!toast || !toastMsg || !toastUndoBtn || !action) return;
    lastAction = action;
    const map = { deleteLog:'ログを削除', deletePlan:'プランを削除', planStatus:'変更を適用' };
    toastMsg.textContent = (map[action.type]||'操作を実行') + 'しました';
    toast.classList.remove('hidden');
    const timer = setTimeout(()=>{ toast.classList.add('hidden'); lastAction=null; }, 5000);
    toastUndoBtn.onclick = ()=>{ clearTimeout(timer); toast.classList.add('hidden'); undoLast(); };
  }
  function showInfoToast(message) {
    if (!toast || !toastMsg) return;
    toastUndoBtn.style.display = 'none'; if (toastRetryBtn) toastRetryBtn.style.display='none';
    lastAction = null;
    toastMsg.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(()=>{ try { toast.classList.add('hidden'); toastUndoBtn.style.display=''; if (toastRetryBtn) toastRetryBtn.style.display='none'; } catch {} }, 6000);
  }
  function undoLast() {
    if (!lastAction) return;
    const a = lastAction; lastAction = null;
    if (a.type==='deleteLog' && a.payload) {
      sessions.push(a.payload); persistAll(); render();
    } else if (a.type==='deletePlan' && a.payload) {
      settings.plans.push(a.payload); persistAll(); renderPlan();
    } else if (a.type==='planStatus' && a.payload) {
      const it = (settings.plans||[]).find(p=>p.id===a.payload.id); if (it) { it.status = a.payload.prev||'todo'; persistAll(); renderPlan(); }
    }
  }

  modalCancelBtn.addEventListener('click', () => {
    backdrop.classList.add('hidden');
    // デフォルトは「続ける」扱い（完了しない）
    confirmStopTask({ tags: [], note: '', completePlan: false });
  });
  modalSaveBtn.addEventListener('click', () => {
    const tags = tagsInput.value.split(',').map(s=>s.trim()).filter(Boolean);
    const note = noteInput.value.trim();
    backdrop.classList.add('hidden');
    const radios = stopPlanActionRadios();
    const choice = radios.find(r=>r.checked)?.value || 'continue';
    if (choice === 'complete') {
      confirmStopTask({ tags, note, completePlan: true });
    } else if (choice === 'split') {
      // 分割: 現在のセッションを確定し、未消化分を新規プランとして残す
      const currentPlanId = active?.planId || null;
      confirmStopTask({ tags, note, completePlan: false });
      if (currentPlanId) {
        const it = (settings.plans||[]).find(p=>p.id===currentPlanId);
        if (it && it.estimateMin) {
          // 今日の同プラン実績
          const from = (()=>{ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
          const todayLogs = sessions.filter(s=>s.startAt >= from);
          const spentSec = todayLogs.filter(s=>s.planId===currentPlanId).reduce((sum,s)=>sum+s.durationSec,0);
          const remainingMin = Math.max(0, it.estimateMin - Math.round(spentSec/60));
          if (remainingMin > 0) {
            // 同日末尾に残量プランを追加
            addPlanItemAtDate(it.date, { name: it.name, templateId: it.templateId||null, estimateMin: remainingMin, scheduledAt: '' });
            persistAll(); renderPlan();
          }
        }
      }
    } else if (choice === 'splitTomorrow') {
      const currentPlanId = active?.planId || null;
      confirmStopTask({ tags, note, completePlan: false });
      if (currentPlanId) {
        const it = (settings.plans||[]).find(p=>p.id===currentPlanId);
        if (it && it.estimateMin) {
          const from = (()=>{ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
          const todayLogs = sessions.filter(s=>s.startAt >= from);
          const spentSec = todayLogs.filter(s=>s.planId===currentPlanId).reduce((sum,s)=>sum+s.durationSec,0);
          const remainingMin = Math.max(0, it.estimateMin - Math.round(spentSec/60));
          if (remainingMin > 0) {
            const nd = new Date(); nd.setDate(nd.getDate()+1);
            const tomorrowKey = formatDateWall(nd.getTime());
            addPlanItemAtDate(tomorrowKey, { name: it.name, templateId: it.templateId||null, estimateMin: remainingMin, scheduledAt: it.scheduledAt||'' });
            persistAll(); renderPlan();
          }
        }
      }
    } else {
      confirmStopTask({ tags, note, completePlan: false });
    }
  });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      backdrop.classList.add('hidden');
      confirmStopTask({ tags: [], note: '', completePlan: false });
    }
  });

  // Plan edit modal events
  // populate select options for time and estimate
  function buildHourMinOptions(hourSel, minSel) {
    if (hourSel) {
      hourSel.innerHTML='';
      const opt = (v,l)=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; return o; };
      hourSel.appendChild(opt('', '指定なし'));
      for (let h=0; h<24; h++) hourSel.appendChild(opt(String(h).padStart(2,'0'), String(h).padStart(2,'0')));
    }
    if (minSel) {
      minSel.innerHTML='';
      const opt = (v,l)=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; return o; };
      for (let m=0; m<60; m++) minSel.appendChild(opt(String(m).padStart(2,'0'), String(m).padStart(2,'0')));
    }
  }
  function buildEstOptions(sel) {
    if (!sel) return; sel.innerHTML='';
    const opt = (v,l)=>{ const o=document.createElement('option'); o.value=String(v); o.textContent=l; return o; };
    const presets = [0,5,10,15,25,30,45,60,90,120];
    presets.forEach(m=> sel.appendChild(opt(m, `${m}分`)));
    sel.appendChild(opt('custom', 'カスタム…'));
  }
  if (planEditCancelBtn && planEditBackdrop) {
    planEditCancelBtn.addEventListener('click', ()=>{ planEditBackdrop.classList.add('hidden'); planEditTargetId=null; });
  }
  if (planEditBackdrop) {
    planEditBackdrop.addEventListener('click', (e)=>{ if (e.target===planEditBackdrop) { planEditBackdrop.classList.add('hidden'); planEditTargetId=null; } });
  }
  if (planEditSaveBtn) {
    planEditSaveBtn.addEventListener('click', ()=>{
      const name = (planNameInput.value||'').trim();
      const scheduledAt = (planTimeTime && planTimeTime.value) || '';
      const dateKey = (()=>{ const v = planDateInput && planDateInput.value; if (v) { return v; } return formatDateWall(Date.now()); })();
      let estimateMin = 0;
      if (planEstSelect && planEstSelect.value === 'custom') {
        estimateMin = parseInt((planEstCustom && planEstCustom.value) || '0', 10) || 0;
      } else {
        estimateMin = parseInt((planEstSelect && planEstSelect.value) || '0',10)||0;
      }

      if (planEditMode === 'create') {
        const templateId = planEditBackdrop.dataset.templateId || null;
        addPlanItemAtDate(dateKey, { name: name||'無題', templateId, estimateMin, scheduledAt });
        planEditBackdrop.dataset.templateId = '';
        persistAll();
        // 移動先の日付に切替して表示
        planViewDateKey = dateKey;
        if (planViewDate) planViewDate.value = dateKey;
        renderPlan();
      } else {
        if (!planEditTargetId) { planEditBackdrop.classList.add('hidden'); return; }
        const it = (settings.plans||[]).find(p=>p.id===planEditTargetId);
        if (!it) { planEditBackdrop.classList.add('hidden'); return; }
        it.name = name || it.name;
        it.scheduledAt = scheduledAt;
        if (dateKey && it.date !== dateKey) { it.date = dateKey; }
        it.estimateMin = estimateMin;
        persistAll();
        planViewDateKey = dateKey;
        if (planViewDate) planViewDate.value = dateKey;
        renderPlan();
      }
      planEditBackdrop.classList.add('hidden');
      planEditTargetId=null; planEditMode='edit';
    });
  }

  function addPlanItemAtDate(dateKey, { name, templateId, estimateMin, scheduledAt }) {
    settings.plans = settings.plans || [];
    const order = (settings.plans.filter(p=>p.date===dateKey).reduce((m,p)=>Math.max(m, p.order||0), 0) + 1);
    settings.plans.push({ id: uuid(), date: dateKey, templateId: templateId||null, name: name||'', estimateMin: estimateMin||0, scheduledAt: scheduledAt||'', status: 'todo', order });
  }

  function formatDateInputValue(d) {
    const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }

  // Routine edit modal events
  // remove old routine range listeners (now select only)
  if (routineEditCancelBtn && routineEditBackdrop) {
    routineEditCancelBtn.addEventListener('click', ()=>{ routineEditBackdrop.classList.add('hidden'); routineEditTargetId=null; });
  }
  if (routineEditBackdrop) {
    routineEditBackdrop.addEventListener('click', (e)=>{ if (e.target===routineEditBackdrop) { routineEditBackdrop.classList.add('hidden'); routineEditTargetId=null; } });
  }
  if (routineEditSaveBtn) {
    routineEditSaveBtn.addEventListener('click', ()=>{
      const name = (routineNameInput.value||'').trim();
      let timeOfDay = (routineTimeTime && routineTimeTime.value) || '';
      if (timeOfDay && !/^\d{1,2}:\d{2}$/.test(timeOfDay)) { alert('予定時刻は HH:MM 形式で入力してください'); return; }
      if (timeOfDay) { const [hh,mm] = timeOfDay.split(':'); timeOfDay = `${String(parseInt(hh||'0',10)||0).padStart(2,'0')}:${String(parseInt(mm||'0',10)||0).padStart(2,'0')}`; }
      let targetDailyMin = 0;
      if (routineEstSelect && routineEstSelect.value === 'custom') {
        targetDailyMin = parseInt((routineEstCustom && routineEstCustom.value) || '0', 10) || 0;
      } else {
        targetDailyMin = parseInt((routineEstSelect && routineEstSelect.value) || '0',10)||0;
      }
      const defaultTags = (routineTagsInput.value||'').split(',').map(s=>s.trim()).filter(Boolean);
      const weeklyTargetMin = parseInt((routineWeeklyTarget && routineWeeklyTarget.value) || '0', 10) || 0;
      const monthlyTargetMin = parseInt((routineMonthlyTarget && routineMonthlyTarget.value) || '0', 10) || 0;
      const boxes = Array.from(routineDaysWrap.querySelectorAll('input.rd'));
      let routineDays = boxes.filter(b=>b.checked).map(b=>parseInt(b.value,10));
      if (routineDays.length===7) routineDays = [0,1,2,3,4,5,6];

      if (routineEditMode === 'create') {
        const t = { id: uuid(), name: name||'無題', defaultTags, color: randomColor(), isRoutine: true, routineDays, timeOfDay, targetDailyMin, weeklyTargetMin, monthlyTargetMin };
        templates.push(t);
      } else {
        if (!routineEditTargetId) { routineEditBackdrop.classList.add('hidden'); return; }
        const t = templates.find(x=>x.id===routineEditTargetId);
        if (!t) { routineEditBackdrop.classList.add('hidden'); return; }
        t.name = name || t.name;
        t.routineDays = routineDays;
        t.timeOfDay = timeOfDay;
        t.targetDailyMin = targetDailyMin;
        t.defaultTags = defaultTags;
        t.weeklyTargetMin = weeklyTargetMin;
        t.monthlyTargetMin = monthlyTargetMin;
      }
      persistAll();
      routineEditBackdrop.classList.add('hidden'); routineEditTargetId=null; routineEditMode='edit';
      renderTemplates(); renderRoutines();
    });
  }

  // -------- Bootstrap --------
  render();
  startTick();
  // PWA: Service Worker registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  // A2HS handling (Add to Home Screen)
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.style.display = 'inline-flex';
  });
  if (installBtn) installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch {}
    deferredPrompt = null;
    installBtn.style.display = 'none';
  });
  // Notifications: permission prompt once
  if ('Notification' in window && Notification.permission === 'default') {
    // 軽い遅延で許可を促す（初回のみ）
    setTimeout(() => {
      try { Notification.requestPermission(); } catch {}
    }, 1500);
  }
})();
