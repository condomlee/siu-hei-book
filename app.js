(() => {
  'use strict';

  const STORAGE_KEY = 'siuHeiBook.v1';
  const GIST_CONFIG_KEY = 'siuHeiBook.gist';
  const GIST_FILENAME = 'siu-hei-book.json';
  const CASE_TYPES = ['缺點', '小過', '大過'];
  const CASE_POINTS = {'缺點': 1, '小過': 3, '大過': 6};
  const CASE_STATUSES = ['待處理', '等待道歉', '改善中', '已改善', '已赦免', '永久記錄'];
  const RELATIONS = ['另一半', '家人', '兒子／女兒', '朋友', '同事', '親戚', '自訂'];
  const MOODS = ['微嬲', '無奈', '心淡', '激氣', '嬲到震', '啼笑皆非'];
  const COLORS = ['#d7b49e', '#c8cfad', '#9db9bc', '#d6c1cf', '#dcc18f', '#aeb5c7'];
  const ACHIEVEMENT_DEFS = [
    ['first-case', '📌', '第一次犯錯', '正式踏入有案底人生'],
    ['first-major', '🚨', '第一次大過', '案情已引起高度關注'],
    ['again-you', '👀', '又係你', '同一人物累積 3 宗案件'],
    ['unchanged', '♻️', '死性不改', '同一類事件出現 3 次'],
    ['three-row', '🎯', '連續三次', '有人連續包辦最近 3 宗'],
    ['ten-year', '🗂️', '今年第十宗', '年度案卷已經疊高'],
    ['improved', '🌱', '知錯能改', '完成第一宗改善'],
    ['clean-slate', '🕊️', '成功洗底', '有人回復至 10 分或以下'],
    ['zero-30', '🗓️', '30 日零犯錯', '保持一個月清白紀錄'],
    ['annual-star', '🏆', '年度風頭躉', '暫居全年榜首']
  ];

  let db = loadData();
  let currentView = new URLSearchParams(location.search).get('view') || 'home';
  let selectedPersonId = null;
  let selectedCaseId = null;
  let pendingConfirm = null;
  let toastTimer = null;
  let oldCaseId = null;
  let receiptCanvas = null;

  // GitHub Gist auto-sync — credentials live only in localStorage, never hardcoded
  let gistConfig = loadGistConfig();
  let syncTimer = null;
  let isSyncing = false;
  let lastSyncAt = null;
  let lastSyncError = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const app = $('#app');

  function uid(prefix = 'id') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function isoDate(date = new Date()) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function nowTime() {
    return new Date().toTimeString().slice(0, 5);
  }

  function esc(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  }

  function formatDate(value, withYear = true) {
    if (!value) return '未有紀錄';
    const date = new Date(`${value}T00:00:00`);
    return new Intl.DateTimeFormat('zh-HK', {year: withYear ? 'numeric' : undefined, month: 'short', day: 'numeric'}).format(date);
  }

  function monthKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return isoDate(next);
  }

  function createDemoData() {
    const today = new Date();
    const people = [
      {id: uid('person'), name: '阿明', nickname: '時間觀念薄弱人士', relation: '朋友', emoji: '🧢', color: COLORS[2], avatar: '', demo: true, createdAt: new Date().toISOString()},
      {id: uid('person'), name: '老婆', nickname: '屋企最高決策人', relation: '另一半', emoji: '👩🏻', color: COLORS[3], avatar: '', demo: true, createdAt: new Date().toISOString()},
      {id: uid('person'), name: '阿仔', nickname: '零食失蹤案常客', relation: '兒子／女兒', emoji: '👦🏻', color: COLORS[1], avatar: '', demo: true, createdAt: new Date().toISOString()}
    ];
    const rawCases = [
      [people[0], '遲到 35 分鐘', '話五分鐘到，實際上足足等咗三十五分鐘，而且期間沒有交代。', -6, '咖啡店門口', '大過', 7, '無奈', '下次出門時才說已出門，並提前更新到達時間。', '等待道歉'],
      [people[1], '食晒最後一件蛋糕', '明知雪櫃最後一件蛋糕已經有人認領，仍然在深夜完成消滅。', -3, '屋企', '小過', 3, '心淡', '補回同款蛋糕一件，並不得只買自己口味。', '改善中'],
      [people[2], '答應買飲品但忘記', '放學時答應買飲品，返到屋企兩手空空，經查問後才記起。', -1, '屋企', '小過', 2, '啼笑皆非', '24 小時內補回一杯同款飲品。', '待處理']
    ];
    const cases = rawCases.map((item, index) => {
      const date = addDays(today, item[3]);
      return {
        id: uid('case'), number: caseNumber(index + 1, date), personId: item[0].id,
        title: item[1], description: item[2], date, time: index === 0 ? '19:30' : '21:15', place: item[4],
        type: item[5], points: CASE_POINTS[item[5]], mood: item[7], suggestion: item[8], dueDate: addDays(new Date(`${date}T12:00:00`), 3),
        status: item[9], notes: '', evidence: '', signature: '', isRepeat: index === 0, demo: true, createdAt: new Date().toISOString()
      };
    });
    return {
      version: 1,
      people,
      cases,
      scoreHistory: cases.map(c => ({id: uid('score'), personId: c.personId, caseId: c.id, amount: c.points, creditDelta: c.type === '大過' ? -8 : -2, reason: `案件立案：${c.title}`, date: c.date, demo: true, createdAt: c.createdAt})),
      achievements: [],
      settings: {ownerName: '本簿持有人', judgeMode: '公正模式', demoData: true, installedAt: new Date().toISOString()}
    };
  }

  function syncCaseScoreHistory(item, data = db) {
    const points = CASE_POINTS[item.type] || CASE_POINTS[CASE_TYPES[0]];
    const entries = data.scoreHistory.filter(entry => entry.caseId === item.id);
    entries.forEach(entry => { entry.personId = item.personId; });

    let original = entries.find(entry => String(entry.reason || '').startsWith('案件立案：'));
    if (!original) {
      original = {
        id: uid('score'), personId: item.personId, caseId: item.id, amount: points,
        creditDelta: creditDeltaForType(item.type), reason: `案件立案：${item.title}`,
        date: item.date, createdAt: item.createdAt || new Date().toISOString()
      };
      data.scoreHistory.push(original);
      entries.push(original);
    }
    Object.assign(original, {
      personId: item.personId,
      amount: points,
      creditDelta: creditDeltaForType(item.type),
      reason: `案件立案：${item.title}`,
      date: item.date
    });

    const improvements = entries.filter(entry => String(entry.reason || '').startsWith('完成改善方案：'));
    improvements.forEach(entry => {
      entry.amount = -Math.max(1, Math.ceil(points / 2));
      entry.reason = `完成改善方案：${item.title}`;
    });

    const pardons = entries.filter(entry => String(entry.reason || '').includes('赦免'));
    if (pardons.length) {
      pardons.forEach(entry => { entry.amount = 0; });
      const balance = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      pardons[0].amount = -Math.max(0, balance);
    }
  }

  function safeImageData(value) {
    const image = String(value || '');
    return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(image) ? image : '';
  }

  function normalizeData(source, strict = false) {
    if (!source || typeof source !== 'object' || !Array.isArray(source.people) || !Array.isArray(source.cases)) {
      throw new Error('格式不符');
    }
    const data = source;
    data.scoreHistory = Array.isArray(data.scoreHistory) ? data.scoreHistory : [];
    data.achievements = Array.isArray(data.achievements) ? data.achievements : [];
    data.settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
    data.version = Number(data.version) || 1;

    const safeId = value => /^[a-z0-9._:-]+$/i.test(String(value || ''));
    const personIds = new Set();
    data.people = data.people.filter(person => {
      const valid = person && typeof person === 'object' && safeId(person.id) && !personIds.has(String(person.id));
      if (!valid && strict) throw new Error('人物資料不完整或重複');
      if (!valid) return false;
      person.id = String(person.id);
      person.name = String(person.name || '未命名人物');
      person.nickname = String(person.nickname || '');
      person.relation = String(person.relation || '自訂');
      person.emoji = String(person.emoji || '🙂').slice(0, 12);
      person.color = /^#[0-9a-f]{6}$/i.test(String(person.color || '')) ? person.color : COLORS[0];
      person.avatar = safeImageData(person.avatar);
      personIds.add(person.id);
      return true;
    });

    const caseIds = new Set();
    data.cases = data.cases.filter((item, index) => {
      if (!item || typeof item !== 'object') {
        if (strict) throw new Error('案件資料不完整');
        return false;
      }
      item.id = item.id == null ? '' : String(item.id);
      item.personId = item.personId == null ? '' : String(item.personId);
      const valid = safeId(item.id) && !caseIds.has(item.id) && personIds.has(item.personId);
      if (!valid && strict) throw new Error('案件人物連結無效或案件重複');
      if (!valid) return false;
      caseIds.add(item.id);
      item.type = CASE_TYPES.includes(item.type) ? item.type : CASE_TYPES[0];
      item.points = CASE_POINTS[item.type];
      item.status = CASE_STATUSES.includes(item.status) ? item.status : CASE_STATUSES[0];
      item.title = String(item.title || '未命名案件');
      item.description = String(item.description || '未有案情內容');
      item.date = /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')) ? item.date : isoDate();
      item.number = String(item.number || caseNumber(index + 1, item.date));
      item.evidence = safeImageData(item.evidence);
      item.signature = safeImageData(item.signature);
      return true;
    });

    data.scoreHistory = data.scoreHistory.filter(entry => {
      if (!entry || typeof entry !== 'object') {
        if (strict) throw new Error('賞罰資料不完整');
        return false;
      }
      entry.personId = entry.personId == null ? '' : String(entry.personId);
      entry.caseId = entry.caseId == null ? null : String(entry.caseId);
      const linkedCase = entry.caseId ? data.cases.find(item => item.id === entry.caseId) : null;
      if (linkedCase) entry.personId = linkedCase.personId;
      const valid = personIds.has(entry.personId) && (!entry.caseId || caseIds.has(entry.caseId));
      if (!valid && strict) throw new Error('賞罰紀錄連結無效');
      if (!valid) return false;
      entry.id = safeId(entry.id) ? String(entry.id) : uid('score');
      entry.amount = Number.isFinite(Number(entry.amount)) ? Number(entry.amount) : 0;
      entry.creditDelta = Number.isFinite(Number(entry.creditDelta)) ? Number(entry.creditDelta) : 0;
      entry.reason = String(entry.reason || '手動調整');
      entry.date = /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || '')) ? entry.date : isoDate();
      return true;
    });

    data.cases.forEach(item => syncCaseScoreHistory(item, data));
    return data;
  }

  function loadData() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (stored && Array.isArray(stored.people) && Array.isArray(stored.cases)) {
        normalizeData(stored);
        if (stored.settings.demoData && !stored.people.some(person => person.demo)) {
          stored.people.forEach(person => { if (['阿明', '老婆', '阿仔'].includes(person.name)) person.demo = true; });
          stored.cases.forEach(item => { if (['遲到 35 分鐘', '食晒最後一件蛋糕', '答應買飲品但忘記'].includes(item.title)) item.demo = true; });
          const demoCaseIds = new Set(stored.cases.filter(item => item.demo).map(item => item.id));
          stored.scoreHistory.forEach(item => { if (demoCaseIds.has(item.caseId)) item.demo = true; });
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        return stored;
      }
    } catch (error) {
      console.warn('備份資料無法讀取，已載入示範資料。', error);
    }
    const initial = createDemoData();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(initial)); }
    catch (error) { console.warn('裝置儲存空間不足，示範資料暫時只會保留到關閉頁面。', error); }
    return initial;
  }

  function saveData() {
    try {
      db.achievements = calculateAchievements();
      db.settings = db.settings || {};
      db.settings.lastLocalSave = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      scheduleGistPush();
      return true;
    } catch (error) {
      console.warn('資料無法儲存。', error);
      showToast('無法儲存：裝置空間可能已滿，請先匯出備份或移除大型圖片。');
      return false;
    }
  }

  // ── GitHub Gist auto-sync ──────────────────────────────────────────
  function loadGistConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(GIST_CONFIG_KEY));
      if (saved && typeof saved.token === 'string' && typeof saved.gistId === 'string') {
        return { token: saved.token, gistId: saved.gistId };
      }
    } catch (_) {}
    return { token: '', gistId: '' };
  }

  function persistGistConfig() {
    if (gistConfig.token && gistConfig.gistId) {
      localStorage.setItem(GIST_CONFIG_KEY, JSON.stringify(gistConfig));
    } else {
      localStorage.removeItem(GIST_CONFIG_KEY);
    }
  }

  function isGistConfigured() {
    return Boolean(gistConfig.token && gistConfig.gistId);
  }

  function scheduleGistPush() {
    if (!isGistConfigured()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { pushToGist(); }, 2500);
  }

  async function pushToGist({ silent = true } = {}) {
    if (!isGistConfigured() || isSyncing) return false;
    isSyncing = true;
    lastSyncError = null;
    try {
      const content = JSON.stringify(db, null, 2);
      const res = await fetch(`https://api.github.com/gists/${gistConfig.gistId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${gistConfig.token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
          files: { [GIST_FILENAME]: { content } }
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      lastSyncAt = new Date().toISOString();
      if (!silent) showToast('已同步到 GitHub Gist');
      return true;
    } catch (err) {
      lastSyncError = err.message || String(err);
      console.warn('[Gist] push failed:', lastSyncError);
      if (!silent) showToast('同步失敗：' + lastSyncError);
      return false;
    } finally {
      isSyncing = false;
    }
  }

  async function pullFromGist({ force = false } = {}) {
    if (!isGistConfigured()) return false;
    try {
      const res = await fetch(`https://api.github.com/gists/${gistConfig.gistId}`, {
        headers: {
          'Authorization': `Bearer ${gistConfig.token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const gist = await res.json();
      const file = gist.files?.[GIST_FILENAME];
      if (!file?.content) return false;

      const remote = JSON.parse(file.content);
      if (!remote || !Array.isArray(remote.people) || !Array.isArray(remote.cases)) return false;

      const remoteTime = new Date(gist.updated_at).getTime();
      const localTime = db.settings?.lastLocalSave
        ? new Date(db.settings.lastLocalSave).getTime()
        : 0;

      if (!force && remoteTime <= localTime) {
        console.log('[Gist] local is newer or same, skip pull');
        return false;
      }

      normalizeData(remote, true);
      db = remote;
      lastSyncAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      return true;
    } catch (err) {
      lastSyncError = err.message || String(err);
      console.warn('[Gist] pull failed:', lastSyncError);
      return false;
    }
  }

  function gistStatusText() {
    if (!isGistConfigured()) return '尚未設定';
    if (lastSyncError) return `上次錯誤：${lastSyncError}`;
    if (lastSyncAt) return `上次同步：${new Date(lastSyncAt).toLocaleString('zh-HK')}`;
    return '已設定，等待首次同步';
  }

  function caseNumber(sequence = db?.cases?.length + 1 || 1, date = isoDate()) {
    return `SQ-${String(date).replaceAll('-', '')}-${String(sequence).padStart(3, '0')}`;
  }

  function personById(id) { return db.people.find(p => p.id === id); }
  function caseById(id) { return db.cases.find(c => c.id === id); }
  function casesForPerson(id) { return db.cases.filter(c => c.personId === id); }
  function historyForPerson(id) { return db.scoreHistory.filter(h => h.personId === id); }
  function personPoints(id) { return Math.max(0, historyForPerson(id).reduce((sum, item) => sum + Number(item.amount || 0), 0)); }
  function personCredit(id) { return Math.max(0, Math.min(100, 100 + historyForPerson(id).reduce((sum, item) => sum + Number(item.creditDelta || 0), 0))); }
  function totalPoints() { return db.people.reduce((sum, person) => sum + personPoints(person.id), 0); }

  function dangerStatus(points) {
    if (points <= 10) return '表現良好';
    if (points <= 25) return '觀察中';
    if (points <= 50) return '高危人士';
    if (points <= 80) return '重點監察';
    return '請小心開口';
  }

  function creditStatus(score) {
    if (score >= 90) return '模範市民';
    if (score >= 75) return '值得信任';
    if (score >= 60) return '尚可交往';
    if (score >= 40) return '需要觀察';
    if (score >= 20) return '高風險人士';
    return '信用破產';
  }

  function personStats(id) {
    const cases = casesForPerson(id);
    return {
      points: personPoints(id), credit: personCredit(id), total: cases.length,
      minor: cases.filter(c => c.type === '小過').length,
      major: cases.filter(c => c.type === '大過').length,
      flaw: cases.filter(c => c.type === '缺點').length,
      improved: cases.filter(c => ['已改善', '已赦免'].includes(c.status)).length,
      open: cases.filter(c => !['已改善', '已赦免'].includes(c.status)).length,
      lastDate: cases.map(c => c.date).sort().reverse()[0] || ''
    };
  }

  function rankedPeople(period = 'all') {
    const history = db.scoreHistory.filter(h => {
      if (period === 'month') return String(h.date).startsWith(monthKey());
      if (period === 'year') return String(h.date).startsWith(String(new Date().getFullYear()));
      return true;
    });
    return db.people.map(person => ({...person, points: Math.max(0, history.filter(h => h.personId === person.id).reduce((sum, h) => sum + Number(h.amount || 0), 0)), cases: db.cases.filter(c => c.personId === person.id && (period === 'all' || c.date.startsWith(period === 'month' ? monthKey() : String(new Date().getFullYear())))).length})).sort((a, b) => b.points - a.points);
  }

  function statusBadge(status) {
    const tone = ['已改善', '已赦免'].includes(status) ? 'green' : status === '永久記錄' ? 'red' : 'gold';
    return `<span class="badge ${tone}">${esc(status)}</span>`;
  }

  function typeBadge(type) {
    return `<span class="badge ${type === '大過' ? 'red' : type === '缺點' ? 'gold' : 'ink'}">${esc(type)}</span>`;
  }

  function avatarMarkup(person) {
    const image = person.avatar ? `background-image:url('${person.avatar}');background-size:cover;background-position:center;` : '';
    return `<span class="avatar" style="--avatar:${person.color};${image}">${person.avatar ? '' : esc(person.emoji)}</span>`;
  }

  function pageHead(kicker, title, description = '', action = '') {
    return `<div class="page-head"><div><span class="eyebrow">${esc(kicker)}</span><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ''}</div>${action}</div>`;
  }

  function caseRow(item) {
    const person = personById(item.personId) || {name: '未知人物'};
    return `<button class="case-row" data-action="case-detail" data-id="${item.id}"><span class="case-mark">${item.type === '大過' ? '大' : item.type === '缺點' ? '缺' : '小'}</span><span class="case-main"><strong>${esc(person.name)} · ${esc(item.title)}</strong><small>${formatDate(item.date)} · ${esc(item.number)} · ${esc(item.status)}</small></span><span class="points">+${item.points}</span></button>`;
  }

  function rankRows(items, limit = items.length) {
    return items.slice(0, limit).map((person, index) => `<button class="rank-row" data-action="person-detail" data-id="${person.id}"><span class="rank-no">${String(index + 1).padStart(2, '0')}</span><span><strong>${esc(person.name)}</strong><small>${esc(person.relation)} · ${person.cases} 宗案件</small></span><span class="points">${person.points} 分</span></button>`).join('') || '<div class="empty">暫時無人上榜，世界和平。</div>';
  }

  function renderHome() {
    const monthCases = db.cases.filter(c => c.date.startsWith(monthKey()));
    const ranking = rankedPeople('month');
    const risk = rankedPeople('all')[0];
    const recent = [...db.cases].sort((a,b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)).slice(0, 5);
    app.innerHTML = `
      <section class="hero">
        <span class="eyebrow">今日小氣 · DAILY DOSSIER</span>
        <h1>我沒有記仇，<br>我只是有完整紀錄。</h1>
        <p>每一段關係都值得被珍惜，每一次激氣都值得有文件編號。</p>
        <div class="hero-actions"><button class="btn primary" data-action="new-case">＋ 快速記一筆</button><button class="btn ghost" data-view="old">翻舊帳</button></div>
      </section>
      <section class="stats-grid">
        <article class="stat" data-index="01"><span>目前總犯錯點數</span><strong>${totalPoints()} 分</strong><em>有據可查</em></article>
        <article class="stat" data-index="02"><span>本月新增案件</span><strong>${monthCases.length} 宗</strong><em>${monthCases.filter(c => c.type === '大過').length} 宗屬大過</em></article>
        <article class="stat" data-index="03"><span>目前最高危人物</span><strong>${esc(risk?.name || '暫時安全')}</strong><em>${risk ? dangerStatus(personPoints(risk.id)) : '表現良好'}</em></article>
        <article class="stat" data-index="04"><span>最近犯錯事件</span><strong>${esc(recent[0]?.title || '無')}</strong><em>${recent[0] ? formatDate(recent[0].date, false) : '未有案底'}</em></article>
      </section>
      <section class="two-col">
        <div class="panel"><div class="panel-head"><h2>最近案件</h2><button data-view="cases">查看案卷 →</button></div><div class="panel-body case-list">${recent.map(caseRow).join('') || '<div class="empty">暫時沒有案件。</div>'}</div></div>
        <div class="panel"><div class="panel-head"><h2>本月排行榜</h2><button data-view="rankings">完整排名 →</button></div><div class="panel-body ranking-list">${rankRows(ranking, 5)}</div></div>
      </section>`;
  }

  function renderPeople() {
    const cards = db.people.map(person => {
      const s = personStats(person.id);
      return `<article class="person-card" role="button" data-action="person-detail" data-id="${person.id}" data-status="${dangerStatus(s.points)}" tabindex="0">${avatarMarkup(person)}<div><h3>${esc(person.name)}</h3><p>${esc(person.nickname || person.relation)} · ${esc(person.relation)}</p><div class="mini-stats"><span>犯錯點數 <b>${s.points}</b></span><span>案件 <b>${s.total}</b></span><span>信用 <b>${s.credit}</b></span></div><div class="danger-meter" style="--value:${Math.min(100, s.points)}%"><i></i></div><div class="meter-label"><span>${dangerStatus(s.points)}</span><span>危險指數 ${Math.min(100, s.points)}%</span></div></div></article>`;
    }).join('');
    app.innerHTML = `${pageHead('人物管理 · SUBJECT REGISTRY', '人物簿', '一人一檔，童叟無欺。', '<button class="btn primary" data-action="new-person">＋ 新增人物</button>')}<div class="toolbar"><input id="people-search" class="search" type="search" placeholder="搜尋姓名、暱稱或關係" aria-label="搜尋人物"></div><section id="people-grid" class="people-grid">${cards || '<div class="empty">人物簿仍然清白。</div>'}</section>`;
  }

  function renderCases() {
    const years = [...new Set(db.cases.map(c => c.date.slice(0,4)))].sort().reverse();
    app.innerHTML = `${pageHead('案件管理 · CASE FILES', '案件簿', `共 ${db.cases.length} 宗正式紀錄`, '<button class="btn primary" data-action="new-case">＋ 正式立案</button>')}
      <div class="toolbar">
        <input id="case-search" class="search" type="search" placeholder="搜尋人物、事件、內容或日期" aria-label="搜尋案件">
        <select id="case-type-filter" class="select" aria-label="分類"><option value="">全部分類</option>${CASE_TYPES.map(v => `<option>${v}</option>`).join('')}</select>
        <select id="case-status-filter" class="select" aria-label="狀態"><option value="">全部狀態</option>${CASE_STATUSES.map(v => `<option>${v}</option>`).join('')}</select>
        <select id="case-year-filter" class="select" aria-label="年份"><option value="">全部年份</option>${years.map(v => `<option>${v}</option>`).join('')}</select>
        <select id="case-month-filter" class="select" aria-label="月份"><option value="">全部月份</option>${Array.from({length:12},(_,i)=>`<option value="${String(i+1).padStart(2,'0')}">${i+1} 月</option>`).join('')}</select>
      </div>
      <section class="panel"><div id="case-results" class="panel-body case-list" style="padding-top:8px">${[...db.cases].sort((a,b)=>b.date.localeCompare(a.date)).map(caseRow).join('') || '<div class="empty">暫時沒有案件。</div>'}</div></section>`;
  }

  function renderJudge() {
    app.innerHTML = `${pageHead('自動判案 · SENTENCING DESK', '判案室', '本庭只講證據，偶爾也講心情。')}
      <section class="judge-card"><form id="judge-form"><div class="field"><label for="judge-person">涉案人物（用於檢查重犯）</label><select id="judge-person" name="personId"><option value="">未指定</option>${db.people.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div><div class="field"><label for="judge-event">呈堂事件</label><textarea id="judge-event" name="event" required placeholder="例如：答應幫我買咖啡，最後自己飲咗。"></textarea></div><div><span class="field"><label>判官模式</label></span><div class="judge-modes">${['公正模式','小氣模式','超級記仇模式','寬宏大量模式'].map((mode,i)=>`<label class="mode-option"><input type="radio" name="mode" value="${mode}" ${i===0?'checked':''}><span>${mode}</span></label>`).join('')}</div></div><button class="btn primary block" type="submit">⚖ 自動判案</button></form><div id="verdict-result"></div></section>`;
  }

  function renderMore() {
    const items = [
      ['rankings','🏆','小氣排行榜','本月、全年及各項殊榮'],
      ['report','▥','年度小氣報告','每月趨勢與分類統計'],
      ['old','↺','翻舊帳','隨機重溫珍貴案底'],
      ['achievements','✦','成就襟章','查看已解鎖的里程碑'],
      ['pardon','🕊','赦免中心','大赦天下，但保留歷史'],
      ['settings','⚙','設定及備份','匯出、匯入及資料管理']
    ];
    app.innerHTML = `${pageHead('其他部門 · ARCHIVE SERVICES', '更多', '所有儀式感功能，集中辦理。')}<section class="settings-list">${items.map(([view,icon,title,sub])=>`<button class="setting-row" data-view="${view}"><span><strong>${icon}　${title}</strong><small>${sub}</small></span><span>→</span></button>`).join('')}</section><footer class="creator-credit"><a href="https://www.threads.com/@bbbeeennnhk" target="_blank" rel="noopener noreferrer">由 Threads@bbbeeennnhk 制作</a></footer>`;
  }

  function renderRankings() {
    const all = rankedPeople('year');
    const mostMajor = db.people.map(p=>({...p,count:casesForPerson(p.id).filter(c=>c.type==='大過').length})).sort((a,b)=>b.count-a.count);
    const mostMinor = db.people.map(p=>({...p,count:casesForPerson(p.id).filter(c=>c.type==='小過').length})).sort((a,b)=>b.count-a.count);
    const improved = db.people.map(p=>({...p,count:casesForPerson(p.id).filter(c=>c.status==='已改善').length})).sort((a,b)=>b.count-a.count);
    const highest = [...db.cases].sort((a,b)=>b.points-a.points)[0];
    app.innerHTML = `${pageHead('榮譽榜 · LEAGUE TABLE', '小氣排行榜', '數字不會說謊，最多只會令人尷尬。', '<button class="btn ghost" data-view="more">返回</button>')}
      <div class="stats-grid"><article class="stat" data-index="冠"><span>全年犯錯最多</span><strong>${esc(all[0]?.name||'從缺')}</strong><em>${all[0]?.points||0} 分</em></article><article class="stat" data-index="大"><span>最多大過</span><strong>${esc(mostMajor[0]?.name||'從缺')}</strong><em>${mostMajor[0]?.count||0} 宗</em></article><article class="stat" data-index="小"><span>最多小過</span><strong>${esc(mostMinor[0]?.name||'從缺')}</strong><em>${mostMinor[0]?.count||0} 宗</em></article><article class="stat" data-index="高"><span>最高單次分數</span><strong>${highest?.points||0} 分</strong><em>${esc(highest?.title||'未有')}</em></article></div>
      <section class="two-col"><div class="panel"><div class="panel-head"><h2>全年總榜</h2></div><div class="panel-body ranking-list">${rankRows(all)}</div></div><div class="panel"><div class="panel-head"><h2>改善最多</h2></div><div class="panel-body ranking-list">${improved.map((p,i)=>`<button class="rank-row" data-action="person-detail" data-id="${p.id}"><span class="rank-no">${i+1}</span><span><strong>${esc(p.name)}</strong><small>完成改善方案</small></span><span class="points">${p.count} 宗</span></button>`).join('')}</div></div></section>`;
  }

  function renderReport() {
    const year = String(new Date().getFullYear());
    const cases = db.cases.filter(c=>c.date.startsWith(year));
    const monthCounts = Array.from({length:12},(_,i)=>cases.filter(c=>Number(c.date.slice(5,7))===i+1).length);
    const monthPoints = Array.from({length:12},(_,i)=>cases.filter(c=>Number(c.date.slice(5,7))===i+1).reduce((s,c)=>s+c.points,0));
    const max = Math.max(1,...monthPoints);
    const typeCounts = Object.fromEntries(CASE_TYPES.map(type=>[type,cases.filter(c=>c.type===type).length]));
    const types = CASE_TYPES.map(type=>typeCounts[type]);
    const total = Math.max(1, cases.length);
    const a = `${types[0]/total*100}%`, b = `${(types[0]+types[1])/total*100}%`;
    const risky = rankedPeople('year')[0];
    const largest = [...cases].sort((x,y)=>y.points-x.points)[0];
    app.innerHTML = `${pageHead(`${year} · ANNUAL REPORT`, '年度小氣報告', '本報告根據已保存案卷自動編製。', '<button class="btn ghost" data-view="more">返回</button>')}
      <div class="stats-grid"><article class="stat" data-index="01"><span>全年總案件</span><strong>${cases.length} 宗</strong><em>每一宗都有編號</em></article><article class="stat" data-index="02"><span>全年總犯錯分</span><strong>${cases.reduce((s,c)=>s+c.points,0)} 分</strong><em>未扣除人情</em></article><article class="stat" data-index="03"><span>最高危人物</span><strong>${esc(risky?.name||'從缺')}</strong><em>${risky?.points||0} 分</em></article><article class="stat" data-index="04"><span>最大單一事件</span><strong>${largest?.points||0} 分</strong><em>${esc(largest?.title||'未有')}</em></article></div>
      <section class="two-col"><div class="panel"><div class="panel-head"><h2>每月犯錯點數</h2></div><div class="panel-body"><div class="chart">${monthPoints.map((v,i)=>`<div class="bar-group"><i class="bar" style="height:${Math.max(2,v/max*100)}%" title="${i+1}月：${v}分"></i><label>${i+1}</label></div>`).join('')}</div><p class="date-code">每月案件數：${monthCounts.join(' / ')}</p></div></div><div class="panel"><div class="panel-head"><h2>分類分布</h2></div><div class="panel-body"><div class="donut-wrap"><div class="donut" style="--a:${a};--b:${b}" data-total="${cases.length}"></div></div><div class="mini-stats">${CASE_TYPES.map(type=>`<span>${type} <b>${typeCounts[type]}</b></span>`).join('')}</div></div></div></section>`;
  }

  function renderOld() {
    if (!db.cases.length) {
      app.innerHTML = `${pageHead('歷史重溫 · MEMORY LANE','翻舊帳','有些回憶值得保存，有些純粹不應被忘記。')}<div class="empty">沒有舊帳可以翻。</div>`;
      return;
    }
    if (!oldCaseId || !caseById(oldCaseId)) oldCaseId = db.cases[Math.floor(Math.random()*db.cases.length)].id;
    const c = caseById(oldCaseId), p = personById(c.personId);
    app.innerHTML = `${pageHead('歷史重溫 · MEMORY LANE','翻舊帳','隨機抽取一宗珍貴歷史。','<button class="btn ghost" data-view="more">返回</button>')}<article id="old-card" class="old-case"><span class="stamp small">案底</span><div class="quote">「你仲記唔記得？<br>${formatDate(c.date)}，${esc(p?.name||'你')}——${esc(c.description)}」</div><div class="case-code">${esc(c.number)} · ${esc(c.type)} · +${c.points} 分</div></article><div class="button-row wrap"><button class="btn primary" data-action="draw-old">再抽一次</button><button class="btn dark" data-action="share-old">生成分享圖片</button><button class="btn ghost" data-action="case-detail" data-id="${c.id}">查看原案</button></div>`;
  }

  function calculateAchievements() {
    const unlocked = new Set(db.achievements || []);
    if (db.cases.length) unlocked.add('first-case');
    if (db.cases.some(c=>c.type==='大過')) unlocked.add('first-major');
    if (db.people.some(p=>casesForPerson(p.id).length>=3)) unlocked.add('again-you');
    if (db.people.some(p=>{ const titles=casesForPerson(p.id).map(c=>c.title.toLowerCase()); return titles.some(t=>titles.filter(x=>x===t).length>=3); })) unlocked.add('unchanged');
    const recent=[...db.cases].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3); if(recent.length===3 && recent.every(c=>c.personId===recent[0].personId)) unlocked.add('three-row');
    if (db.cases.filter(c=>c.date.startsWith(String(new Date().getFullYear()))).length>=10) unlocked.add('ten-year');
    if (db.cases.some(c=>c.status==='已改善')) unlocked.add('improved');
    if (db.people.some(p=>casesForPerson(p.id).length>0 && personPoints(p.id)<=10)) unlocked.add('clean-slate');
    const newest=[...db.cases].sort((a,b)=>b.date.localeCompare(a.date))[0]; if(newest && (Date.now()-new Date(`${newest.date}T00:00:00`).getTime())/86400000>=30) unlocked.add('zero-30');
    if (db.cases.length) unlocked.add('annual-star');
    return [...unlocked];
  }

  function renderAchievements() {
    const unlocked = new Set(calculateAchievements());
    app.innerHTML = `${pageHead('嘉許制度 · ACHIEVEMENTS','成就襟章',`已解鎖 ${unlocked.size} / ${ACHIEVEMENT_DEFS.length} 項`,'<button class="btn ghost" data-view="more">返回</button>')}<section class="achievement-grid">${ACHIEVEMENT_DEFS.map(([id,icon,title,desc])=>`<article class="achievement ${unlocked.has(id)?'':'locked'}"><i>${unlocked.has(id)?icon:'🔒'}</i><strong>${title}</strong><small>${desc}</small></article>`).join('')}</section>`;
  }

  function renderPardon() {
    const pardonable=db.cases.filter(c=>!['已赦免','已改善'].includes(c.status));
    app.innerHTML = `${pageHead('特別安排 · AMNESTY OFFICE','赦免中心','赦免不等於刪除，歷史仍然存在。','<button class="btn ghost" data-view="more">返回</button>')}
      <section class="stats-grid"><article class="stat" data-index="恩"><span>今日心情好</span><strong>隨機赦免</strong><em>只限一宗小過</em><button class="btn primary small" style="margin-top:10px" data-action="random-pardon">即時抽選</button></article><article class="stat" data-index="壽"><span>生日特赦</span><strong>指定人物</strong><em>減少 5 點</em><button class="btn ghost small" style="margin-top:10px" data-action="birthday-pardon">辦理特赦</button></article><article class="stat" data-index="年"><span>新年大赦</span><strong>選擇案件</strong><em>標記為已赦免</em><button class="btn dark small" style="margin-top:10px" data-action="mass-pardon">選擇案卷</button></article></section>
      <section class="panel"><div class="panel-head"><h2>可供赦免案卷</h2></div><div class="panel-body case-list">${pardonable.map(caseRow).join('')||'<div class="empty">暫時沒有待赦免案件。</div>'}</div></section>`;
  }

  function renderSettings() {
    const configured = isGistConfigured();
    const maskedToken = gistConfig.token
      ? gistConfig.token.slice(0, 7) + '…' + gistConfig.token.slice(-4)
      : '';
    app.innerHTML = `${pageHead('資料管理 · ADMINISTRATION','設定及備份','所有資料只保存在這部裝置。','<button class="btn ghost" data-view="more">返回</button>')}
      <section class="settings-list">
        <div class="setting-row"><span><strong>📤 匯出全部資料</strong><small>下載一份 JSON 完整備份</small></span><button class="btn ghost small" data-action="export-data">下載</button></div>
        <div class="setting-row"><span><strong>📥 匯入及恢復</strong><small>從小氣簿 JSON 備份還原</small></span><button class="btn ghost small" data-action="import-data">選擇檔案</button></div>
        <div class="setting-row"><span><strong>🧹 清除示範資料</strong><small>移除首次開啟時提供的範例</small></span><button class="btn ghost small" data-action="clear-demo" ${db.settings.demoData?'':'disabled'}>${db.settings.demoData?'清除':'已清除'}</button></div>
        <div class="setting-row"><span><strong>🗑️ 清除全部資料</strong><small>這項操作需要二次確認</small></span><button class="btn danger small" data-action="clear-all">清除</button></div>
      </section>

      <section class="panel" style="margin-top:16px">
        <div class="panel-body" style="padding-top:17px">
          <span class="eyebrow">雲端自動同步 · GITHUB GIST</span>
          <p style="margin:8px 0 12px;font-size:0.9em;line-height:1.5">設定後每次儲存會自動同步到你的私密 Gist，換裝置時自動載入。Token 只存在本機，不會上傳到其他地方。</p>
          ${configured ? `
            <p style="font-size:0.88em;margin-bottom:8px"><strong>狀態：</strong>${esc(gistStatusText())}</p>
            <p style="font-size:0.85em;color:#666;margin-bottom:12px">Gist ID：${esc(gistConfig.gistId)}<br>Token：${esc(maskedToken)}</p>
            <div class="button-row wrap" style="margin-bottom:12px">
              <button class="btn ghost small" data-action="gist-force-push">立即上傳</button>
              <button class="btn ghost small" data-action="gist-force-pull">立即下載</button>
              <button class="btn danger small" data-action="gist-clear">解除同步</button>
            </div>
          ` : `
            <form id="gist-config-form">
              <div class="field"><label>Gist ID</label><input name="gistId" type="text" required placeholder="從 gist.github.com 網址複製" autocomplete="off"></div>
              <div class="field"><label>Personal Access Token</label><input name="token" type="password" required placeholder="ghp_…（只需 gist 權限）" autocomplete="off"></div>
              <p style="font-size:0.8em;color:#666;margin:0 0 12px">建立方式：GitHub → Settings → Developer settings → Personal access tokens → Generate new token (classic) → 只勾選 <code>gist</code>。Gist 請建立為 Secret，檔名 <code>${GIST_FILENAME}</code>。</p>
              <button class="btn primary block" type="submit">儲存並啟用自動同步</button>
            </form>
          `}
        </div>
      </section>

      <div class="panel" style="margin-top:16px"><div class="panel-body" style="padding-top:17px"><span class="eyebrow">系統狀態</span><p>人物 ${db.people.length} 位 · 案件 ${db.cases.length} 宗 · 賞罰紀錄 ${db.scoreHistory.length} 筆</p><p class="date-code" style="text-align:left">資料版本 ${db.version||1} · LocalStorage · PWA Offline Ready${configured ? ' · Gist Sync' : ''}</p></div></div>`;
  }

  function render() {
    window.scrollTo(0,0);
    const views={home:renderHome,people:renderPeople,cases:renderCases,judge:renderJudge,more:renderMore,rankings:renderRankings,report:renderReport,old:renderOld,achievements:renderAchievements,pardon:renderPardon,settings:renderSettings};
    (views[currentView]||renderHome)();
    $$('.bottom-nav button').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===currentView || (['rankings','report','old','achievements','pardon','settings'].includes(currentView)&&btn.dataset.view==='more')));
    app.focus({preventScroll:true});
  }

  function setView(view) {
    currentView=view;
    history.replaceState({},'',`${location.pathname}${view==='home'?'':`?view=${view}`}`);
    closeModal();
    render();
  }

  function openModal(title, body) {
    $('#modal-title').textContent=title;
    $('#modal-body').innerHTML=body;
    $('#modal').hidden=false;
    $('#modal').setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
    setTimeout(()=>$('#modal-body input, #modal-body select, #modal-body textarea, #modal-body button')?.focus(),30);
  }

  function closeModal() {
    $('#modal').hidden=true;
    $('#modal').setAttribute('aria-hidden','true');
    document.body.style.overflow='';
  }

  function showToast(message) {
    const toast=$('#toast'); toast.textContent=message; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>toast.classList.remove('show'),3200);
  }

  function confirmAction(title,message,callback) {
    pendingConfirm=callback; $('#confirm-title').textContent=title; $('#confirm-message').textContent=message; $('#confirm').hidden=false; $('#confirm').setAttribute('aria-hidden','false');
  }

  function closeConfirm() { pendingConfirm=null; $('#confirm').hidden=true; $('#confirm').setAttribute('aria-hidden','true'); }

  function personForm(person={}) {
    return `<form id="person-form" data-id="${person.id||''}"><div class="form-grid two"><div class="field"><label>姓名 *</label><input name="name" required maxlength="30" value="${esc(person.name||'')}" placeholder="例如：阿明"></div><div class="field"><label>暱稱</label><input name="nickname" maxlength="40" value="${esc(person.nickname||'')}" placeholder="例如：時間觀念薄弱人士"></div><div class="field"><label>關係</label><select name="relation">${RELATIONS.map(v=>`<option ${person.relation===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Emoji 頭像</label><input name="emoji" maxlength="6" value="${esc(person.emoji||'🙂')}" placeholder="🙂"></div><div class="field"><label>頭像顏色</label><input name="color" type="color" value="${person.color||COLORS[Math.floor(Math.random()*COLORS.length)]}"></div><div class="field"><label>上傳頭像（選填）</label><input name="avatarFile" type="file" accept="image/*"><small>上傳圖片會優先於 Emoji 顯示</small></div></div><button class="btn primary block" type="submit">${person.id?'儲存人物資料':'建立人物檔案'}</button></form>`;
  }

  function openPersonForm(id='') { openModal(id?'編輯人物資料':'新增人物檔案',personForm(id?personById(id):{})); }

  function caseForm(item={}) {
    const date=item.date||isoDate();
    const type=item.type||CASE_TYPES[0];
    const points=CASE_POINTS[type];
    return `<form id="case-form" data-id="${item.id||''}"><div class="form-grid two"><div class="field"><label>人物 *</label><select name="personId" required><option value="">請選擇</option>${db.people.map(p=>`<option value="${p.id}" ${item.personId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div><div class="field"><label>事件名稱 *</label><input name="title" required maxlength="60" value="${esc(item.title||'')}" placeholder="例如：遲到 35 分鐘"></div><div class="field"><label>發生日期 *</label><input name="date" type="date" required value="${date}"></div><div class="field"><label>發生時間</label><input name="time" type="time" value="${item.time||nowTime()}"></div><div class="field"><label>地點</label><input name="place" value="${esc(item.place||'')}" placeholder="例如：屋企"></div><div class="field"><label>心情</label><select name="mood">${MOODS.map(v=>`<option ${item.mood===v?'selected':''}>${v}</option>`).join('')}</select></div></div><div class="field"><label>事情經過 *</label><textarea name="description" required placeholder="請如實記錄案情，方便日後翻舊帳。">${esc(item.description||'')}</textarea></div><div class="form-section"><h3>判罰資料</h3><div class="form-grid three"><div class="field"><label>犯錯類型</label><select name="type" id="case-type">${CASE_TYPES.map(v=>`<option ${type===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>犯錯點數</label><input name="points" id="case-points" type="number" readonly aria-readonly="true" value="${points}"><small>固定分數：缺點 1；小過 3；大過 6</small></div><div class="field"><label>案件狀態</label><select name="status">${CASE_STATUSES.map(v=>`<option ${item.status===v?'selected':''}>${v}</option>`).join('')}</select></div></div></div><div class="field"><label>改善建議</label><textarea name="suggestion" placeholder="例如：24 小時內補回同款飲品。">${esc(item.suggestion||'')}</textarea></div><div class="form-grid two"><div class="field"><label>改善期限</label><input name="dueDate" type="date" value="${item.dueDate||addDays(new Date(),3)}"></div><div class="field"><label>證據圖片</label><input name="evidenceFile" type="file" accept="image/*"><small>圖片會壓縮後保存在這部裝置</small></div></div><div class="field"><label>備註</label><textarea name="notes">${esc(item.notes||'')}</textarea></div><label class="setting-row"><span><strong>重犯紀錄</strong><small>此人過往曾犯同類事件</small></span><input name="isRepeat" type="checkbox" ${item.isRepeat?'checked':''}></label><button class="btn primary block" type="submit">${item.id?'更新案件':'正式立案'}</button></form>`;
  }

  function openCaseForm(id='') {
    if (!db.people.length) { showToast('請先建立人物檔案，才可以正式立案。'); openPersonForm(); return; }
    openModal(id?'修訂案件':'新增犯錯案件',caseForm(id?caseById(id):{}));
  }

  function personDetail(id) {
    const p=personById(id); if(!p)return;
    selectedPersonId=id; const s=personStats(id); const cases=[...casesForPerson(id)].sort((a,b)=>b.date.localeCompare(a.date)); const history=[...historyForPerson(id)].sort((a,b)=>b.date.localeCompare(a.date));
    openModal('人物詳細檔案',`<div class="profile-head">${avatarMarkup(p)}<div><h1>${esc(p.name)}</h1><p>${esc(p.nickname||'')} · ${esc(p.relation)}</p></div></div><div class="credit-card"><small>關係信用分 · ${creditStatus(s.credit)}</small><div class="credit-value">${s.credit}<small> / 100</small></div><div class="credit-bar" style="--value:${s.credit}%"><i></i></div></div><div class="stats-grid"><article class="stat" data-index="分"><span>目前犯錯點數</span><strong>${s.points}</strong><em>${dangerStatus(s.points)}</em></article><article class="stat" data-index="案"><span>總案件數</span><strong>${s.total}</strong><em>${s.open} 宗尚未改善</em></article><article class="stat" data-index="過"><span>小過／大過／缺點</span><strong>${s.minor}/${s.major}/${s.flaw}</strong><em>分類統計</em></article><article class="stat" data-index="改"><span>已改善案件</span><strong>${s.improved}</strong><em>最近：${formatDate(s.lastDate,false)}</em></article></div><div class="danger-meter" style="--value:${Math.min(100,s.points)}%"><i></i></div><div class="meter-label"><span>${dangerStatus(s.points)}</span><span>危險指數 ${Math.min(100,s.points)}%</span></div><div class="button-row wrap"><button class="btn primary small" data-action="adjust-score" data-id="${id}">＋／− 賞罰</button><button class="btn ghost small" data-action="edit-person" data-id="${id}">編輯資料</button><button class="btn danger small" data-action="delete-person" data-id="${id}">刪除人物</button></div><div class="panel" style="margin-top:18px"><div class="panel-head"><h2>案件紀錄</h2><button data-action="new-case-for" data-id="${id}">＋ 新案件</button></div><div class="panel-body case-list">${cases.map(caseRow).join('')||'<div class="empty">暫時清白。</div>'}</div></div><div class="panel" style="margin-top:12px"><div class="panel-head"><h2>賞罰紀錄</h2></div><div class="panel-body history-list">${history.map(h=>`<div class="history-row" style="grid-template-columns:1fr auto"><span><strong>${esc(h.reason)}</strong><small>${formatDate(h.date)} · 信用 ${h.creditDelta>=0?'+':''}${h.creditDelta||0}</small></span><span class="points">${h.amount>=0?'+':''}${h.amount}</span></div>`).join('')||'<div class="empty">未有賞罰。</div>'}</div></div>`);
  }

  function adjustScoreForm(person) {
    return `<form id="score-form" data-id="${person.id}"><div class="score-preview">目前：${personPoints(person.id)} 犯錯點 · ${personCredit(person.id)} 信用分</div><div class="form-grid two"><div class="field"><label>犯錯點變動</label><input name="amount" type="number" required value="-3"><small>加分請填正數；減分請填負數</small></div><div class="field"><label>信用分變動</label><input name="creditDelta" type="number" required value="3"></div></div><div class="field"><label>賞罰原因</label><select name="preset"><option>主動道歉</option><option>主動補救</option><option>請食飯</option><option>買飲品</option><option>送禮物</option><option>表現良好</option><option>完成改善方案</option><option>特別赦免</option><option value="">自訂</option></select></div><div class="field"><label>自訂原因（選填）</label><input name="customReason" placeholder="請輸入原因"></div><button class="btn primary block" type="submit">記入賞罰紀錄</button></form>`;
  }

  function caseDetail(id) {
    const c=caseById(id); if(!c)return; const p=personById(c.personId); selectedCaseId=id;
    openModal('案件詳細檔案',`<div class="page-head" style="align-items:start"><div><span class="eyebrow">${esc(c.number)}</span><h1 style="font-size:29px">${esc(c.title)}</h1><p>${esc(p?.name||'未知人物')} · ${formatDate(c.date)} ${esc(c.time||'')}</p></div><span class="stamp small">${esc(c.type)}</span></div><div class="mini-stats"><span>犯錯點數 <b>+${c.points}</b></span><span>心情 <b>${esc(c.mood)}</b></span><span>狀態 <b>${esc(c.status)}</b></span></div><div class="panel" style="margin-top:16px"><div class="panel-body" style="padding-top:17px"><span class="eyebrow">案情撮要</span><p style="line-height:1.7;white-space:pre-wrap">${esc(c.description)}</p><span class="eyebrow">改善建議</span><p style="line-height:1.7;white-space:pre-wrap">${esc(c.suggestion||'未有指定')}</p><div class="form-grid two"><p><small>地點</small><br>${esc(c.place||'未有紀錄')}</p><p><small>改善期限</small><br>${formatDate(c.dueDate)}</p></div>${c.notes?`<span class="eyebrow">備註</span><p>${esc(c.notes)}</p>`:''}${c.evidence?`<img src="${c.evidence}" alt="案件證據" style="width:100%;border-radius:10px;margin-top:12px">`:''}</div></div><div class="button-row wrap"><button class="btn primary" data-action="open-receipt" data-id="${id}">生成回條</button><button class="btn ghost" data-action="improve-case" data-id="${id}" ${['已改善','已赦免'].includes(c.status)?'disabled':''}>完成改善</button><button class="btn ghost" data-action="edit-case" data-id="${id}">修訂</button><button class="btn danger" data-action="delete-case" data-id="${id}">刪除</button></div>`);
  }

  async function imageToDataUrl(file) {
    if (!file) return '';
    return new Promise((resolve,reject)=>{
      const reader=new FileReader(); reader.onerror=reject; reader.onload=()=>{
        const img=new Image(); img.onload=()=>{ const max=900, scale=Math.min(1,max/Math.max(img.width,img.height)); const canvas=document.createElement('canvas'); canvas.width=Math.round(img.width*scale); canvas.height=Math.round(img.height*scale); canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height); resolve(canvas.toDataURL('image/jpeg',.72)); }; img.onerror=reject; img.src=reader.result;
      }; reader.readAsDataURL(file);
    });
  }

  function creditDeltaForType(type) { return type==='大過'?-8:-2; }

  async function handlePersonSubmit(form) {
    const before=structuredClone(db);
    try {
      const fd=new FormData(form); const data=Object.fromEntries(fd); const existing=form.dataset.id?personById(form.dataset.id):null;
      const avatar=fd.get('avatarFile')?.size?await imageToDataUrl(fd.get('avatarFile')):(existing?.avatar||'');
      if(existing){ Object.assign(existing,{name:data.name.trim(),nickname:data.nickname.trim(),relation:data.relation,emoji:data.emoji||'🙂',color:data.color,avatar}); }
      else db.people.push({id:uid('person'),name:data.name.trim(),nickname:data.nickname.trim(),relation:data.relation,emoji:data.emoji||'🙂',color:data.color,avatar,demo:false,createdAt:new Date().toISOString()});
      if(!saveData()){db=before;return;} closeModal(); render(); showToast(form.dataset.id?'人物檔案已更新。':'人物檔案已正式建立。');
    } catch (error) {
      db=before; showToast('人物圖片無法讀取，請改用 JPG、PNG 或其他一般圖片格式。');
    }
  }

  async function handleCaseSubmit(form) {
    const before=structuredClone(db);
    try {
      const fd=new FormData(form); const data=Object.fromEntries(fd); const existing=form.dataset.id?caseById(form.dataset.id):null; const points=CASE_POINTS[data.type];
      const evidence=fd.get('evidenceFile')?.size?await imageToDataUrl(fd.get('evidenceFile')):(existing?.evidence||'');
      const payload={personId:data.personId,title:data.title.trim(),description:data.description.trim(),date:data.date,time:data.time,place:data.place.trim(),type:data.type,points,mood:data.mood,suggestion:data.suggestion.trim(),dueDate:data.dueDate,status:data.status,notes:data.notes.trim(),evidence,isRepeat:fd.has('isRepeat')};
      if(existing){
        Object.assign(existing,payload,{updatedAt:new Date().toISOString()});
        syncCaseScoreHistory(existing);
      }else{
        const item={id:uid('case'),number:caseNumber(db.cases.length+1,data.date),...payload,signature:'',createdAt:new Date().toISOString()}; db.cases.push(item); syncCaseScoreHistory(item);
      }
      if(!saveData()){db=before;return;} closeModal(); render(); showToast(existing?'案件資料已更新。':data.type==='大過'?'大過已正式立案。':'已正式記錄，此事現在有案底。');
    } catch (error) {
      db=before; showToast('案件證據圖片無法讀取，請改用 JPG、PNG 或其他一般圖片格式。');
    }
  }

  function handleScoreSubmit(form) {
    const data=Object.fromEntries(new FormData(form)); const amount=Number(data.amount), creditDelta=Number(data.creditDelta); const reason=data.customReason.trim()||data.preset||'手動調整';
    if(!Number.isFinite(amount)||!Number.isFinite(creditDelta)){showToast('請輸入有效的賞罰分數。');return;}
    const before=structuredClone(db); db.scoreHistory.push({id:uid('score'),personId:form.dataset.id,caseId:null,amount,creditDelta,reason,date:isoDate(),createdAt:new Date().toISOString()}); if(!saveData()){db=before;return;} personDetail(form.dataset.id); showToast('賞罰紀錄已保存，分數正式生效。');
  }

  function judgeEvent(event,personId,mode) {
    const text=event.toLowerCase(); let type='小過', points=2;
    const major=['放飛機','明知故犯','講大話','欺騙','失約','完全沒有','完全冇','多次','非常','嚴重','嬲到'];
    const flaw=['經常','成日','每次','總是','長期','又係','再一次','冇手尾'];
    if(major.some(k=>text.includes(k))||text.length>90){type='大過';points=6;}
    if(flaw.some(k=>text.includes(k))){type='缺點';points=Math.max(points,4);}
    const personCases=personId?casesForPerson(personId):[];
    const repeat=personCases.some(c=>text.includes(c.title.toLowerCase())||c.title.toLowerCase().split(' ').some(k=>k.length>1&&text.includes(k)));
    if(repeat) points+=2;
    const factor={'公正模式':1,'小氣模式':1.35,'超級記仇模式':1.8,'寬宏大量模式':.55}[mode]||1;
    points=Math.max(1,Math.min(10,Math.round(points*factor)));
    if(points>=4&&type==='小過')type='大過';
    points=CASE_POINTS[type];
    const comment=repeat?'翻查案卷後確認有重犯跡象，情節理應加重處理。':type==='大過'?'承諾或基本責任未有履行，對心情造成實質影響。':type==='缺點'?'事件呈現持續性習慣問題，建議設立明確改善期限。':'目前情節尚屬輕微，但仍有正式記錄的必要。';
    const suggestion=text.includes('飲')||text.includes('咖啡')?'24 小時內補回一杯同款飲品，並附上真誠道歉。':text.includes('遲到')?'下次提前 15 分鐘報告實際位置，連續三次準時方可洗底。':text.includes('食')?'補回同款食品一份，並於動手前確認擁有權。':'48 小時內主動道歉及提出一項具體補救安排。';
    return {type,points,comment,suggestion,repeat};
  }

  function renderVerdict(result,event,personId) {
    $('#verdict-result').innerHTML=`<article class="verdict"><span class="eyebrow">案件初步判決</span><h3>建議判決：${result.type}</h3><div class="verdict-points">建議 +${result.points} 分</div><dl><dt>案件評語</dt><dd>${esc(result.comment)}</dd><dt>改善方案</dt><dd>${esc(result.suggestion)}</dd><dt>重犯判定</dt><dd>${result.repeat?'是，已加重刑罰。':'暫未發現相同案底。'}</dd></dl><button class="btn primary block" style="margin-top:18px" data-action="verdict-to-case" data-event="${encodeURIComponent(event)}" data-person="${personId}" data-type="${result.type}" data-points="${result.points}" data-suggestion="${encodeURIComponent(result.suggestion)}">採納判決並立案</button></article>`;
  }

  function improveCase(id) {
    const c=caseById(id); if(!c)return;
    const before=structuredClone(db); c.status='已改善'; const deduction=-Math.max(1,Math.ceil(c.points/2)); db.scoreHistory.push({id:uid('score'),personId:c.personId,caseId:c.id,amount:deduction,creditDelta:5,reason:`完成改善方案：${c.title}`,date:isoDate(),createdAt:new Date().toISOString()}); if(!saveData()){db=before;return;} closeModal(); render(); showToast('本案已成功改善，可以暫時放低。');
  }

  function pardonCase(id, reason='特別赦免', options={}) {
    const c=caseById(id); if(!c||c.status==='已赦免')return;
    const before=options.save===false?null:structuredClone(db); c.status='已赦免'; const currentCaseBalance=db.scoreHistory.filter(h=>h.caseId===id).reduce((s,h)=>s+Number(h.amount||0),0); if(currentCaseBalance>0)db.scoreHistory.push({id:uid('score'),personId:c.personId,caseId:c.id,amount:-currentCaseBalance,creditDelta:4,reason,date:isoDate(),createdAt:new Date().toISOString()});
    if(options.save!==false&&!saveData()){db=before;return false;} if(!options.silent){closeModal();render();showToast('本案獲特別赦免，但歷史仍然存在。');} return true;
  }

  function receiptMarkup(c) {
    const p=personById(c.personId), s=personStats(c.personId);
    return `<article id="receipt" class="receipt"><header class="receipt-head"><div class="dept">私人紀律及人情事務處</div><h1>小氣簿</h1><h2>犯錯通知及改善回條</h2></header><div class="receipt-stamp">${esc(c.type)}</div><section class="receipt-meta"><div class="receipt-field"><label>案件編號</label><strong>${esc(c.number)}</strong></div><div class="receipt-field"><label>文件狀態</label><strong>${esc(c.status)}</strong></div><div class="receipt-field"><label>被投訴人</label><strong>${esc(p?.name||'')}</strong></div><div class="receipt-field"><label>關係</label><strong>${esc(p?.relation||'')}</strong></div><div class="receipt-field"><label>犯錯日期</label><strong>${formatDate(c.date)} ${esc(c.time||'')}</strong></div><div class="receipt-field"><label>犯錯級別／點數</label><strong>${esc(c.type)}　+${c.points} 分</strong></div><div class="receipt-field full"><label>犯錯事項</label><strong>${esc(c.title)}</strong></div><div class="receipt-field full"><label>案件內容</label><strong>${esc(c.description)}</strong></div><div class="receipt-field full"><label>本次影響</label><strong>投訴人心情：${esc(c.mood)}；關係信用分按既定準則調整。</strong></div><div class="receipt-field full"><label>改善建議</label><strong>${esc(c.suggestion||'請主動提出具體而可驗證之改善方案。')}</strong></div><div class="receipt-field"><label>改善期限</label><strong>${formatDate(c.dueDate)}</strong></div><div class="receipt-field"><label>目前累積犯錯點數</label><strong>${s.points} 分 · ${dangerStatus(s.points)}</strong></div></section><div class="receipt-notice">本人已閱讀以上內容，並知悉相關改善建議。本文件之目的為將日常小摩擦正式化、荒謬化及可供日後合理地翻閱，並不構成任何真正法律文件。</div><section class="signature-grid"><div><div class="signature-box"><label>犯錯人簽名</label><canvas id="signature-canvas" width="600" height="240" aria-label="手寫簽名區"></canvas></div></div><div><div class="signature-box"><label>投訴人確認</label><div class="complainant-signature">${esc(db.settings.ownerName||'本簿持有人')}</div></div><p class="receipt-date">日期：${formatDate(isoDate())}</p></div></section><footer class="receipt-foot">本文件由「小氣簿」自動生成 · 文件編號 ${esc(c.number)} · 完整歷史保留於本機案卷</footer></article>`;
  }

  function openReceipt(id) {
    const c=caseById(id); if(!c)return; closeModal(); $('#receipt-wrap').innerHTML=receiptMarkup(c); $('#receipt-screen').hidden=false; document.body.style.overflow='hidden'; selectedCaseId=id; setupSignature(c.signature);
  }

  function closeReceipt() { $('#receipt-screen').hidden=true; $('#receipt-wrap').innerHTML=''; document.body.style.overflow=''; receiptCanvas=null; }

  function setupSignature(saved='') {
    const canvas=$('#signature-canvas'); if(!canvas)return; receiptCanvas=canvas; const ctx=canvas.getContext('2d'); ctx.lineWidth=5;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#171412';
    if(saved){const img=new Image();img.onload=()=>ctx.drawImage(img,0,0,canvas.width,canvas.height);img.src=saved;}
    let drawing=false;
    const point=e=>{const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};};
    canvas.addEventListener('pointerdown',e=>{drawing=true;canvas.setPointerCapture(e.pointerId);const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});
    canvas.addEventListener('pointermove',e=>{if(!drawing)return;const p=point(e);ctx.lineTo(p.x,p.y);ctx.stroke();});
    const persistSignature=()=>{if(!drawing)return;drawing=false;const item=caseById(selectedCaseId);if(item){const previous=item.signature;item.signature=canvas.toDataURL('image/png');if(!saveData())item.signature=previous;}};
    canvas.addEventListener('pointerup',persistSignature); canvas.addEventListener('pointercancel',persistSignature);
  }

  async function receiptImage() {
    if(!window.html2canvas){showToast('圖片工具仍在載入，請稍後再試。');return null;}
    showToast('正在製作正式 JPG 文件…');
    return html2canvas($('#receipt'),{scale:2,backgroundColor:'#fffdf7',useCORS:true,logging:false});
  }

  async function downloadReceipt(share=false) {
    const canvas=await receiptImage(); if(!canvas)return; const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92)); const c=caseById(selectedCaseId); const file=new File([blob],`${c.number}-犯錯回條.jpg`,{type:'image/jpeg'});
    if(share&&navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({title:'小氣簿犯錯回條',text:`案件 ${c.number}`,files:[file]});showToast('分享完成。');return;}
    const url=URL.createObjectURL(blob), link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast(share?'此瀏覽器不支援檔案分享，已改為下載。':'JPG 回條已下載。');
  }

  async function shareOld() {
    if(!window.html2canvas){showToast('圖片工具仍在載入，請稍後再試。');return;} const canvas=await html2canvas($('#old-card'),{scale:2,backgroundColor:'#fffdf7'});const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.9));const file=new File([blob],'翻舊帳.jpg',{type:'image/jpeg'});
    if(navigator.share&&navigator.canShare?.({files:[file]}))await navigator.share({title:'你仲記唔記得？',files:[file]});else{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=file.name;a.click();} showToast('翻舊帳圖片已準備好。');
  }

  function exportData() { const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`小氣簿備份-${isoDate()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);showToast('完整資料備份已下載。'); }

  async function importData(file) {
    const before=db;
    try{const data=normalizeData(JSON.parse(await file.text()),true);db=data;if(!saveData()){db=before;return;}setView('home');showToast('資料已成功恢復，舊版分數亦已按現行規則修正。');}catch(error){db=before;showToast('無法匯入：備份格式不完整或資料連結有誤。');}
  }

  function filterCases() {
    const q=($('#case-search')?.value||'').trim().toLowerCase(),type=$('#case-type-filter')?.value||'',status=$('#case-status-filter')?.value||'',year=$('#case-year-filter')?.value||'',month=$('#case-month-filter')?.value||'';
    const items=[...db.cases].sort((a,b)=>b.date.localeCompare(a.date)).filter(c=>{const p=personById(c.personId);const hay=`${p?.name||''} ${c.title} ${c.description} ${c.date}`.toLowerCase();return(!q||hay.includes(q))&&(!type||c.type===type)&&(!status||c.status===status)&&(!year||c.date.startsWith(year))&&(!month||c.date.slice(5,7)===month);});
    $('#case-results').innerHTML=items.map(caseRow).join('')||'<div class="empty">找不到符合條件的案件。</div>';
  }

  function filterPeople() { const q=($('#people-search')?.value||'').toLowerCase();$$('.person-card').forEach(card=>{const p=personById(card.dataset.id);card.style.display=`${p.name} ${p.nickname} ${p.relation}`.toLowerCase().includes(q)?'':'none';}); }

  function massPardonForm() {
    const items=db.cases.filter(c=>!['已赦免','已改善'].includes(c.status));
    return `<form id="mass-pardon-form"><p>選擇需要在本次大赦中獲批的案卷。所有案件仍會保留。</p>${items.map(c=>`<label class="setting-row"><span><strong>${esc(c.title)}</strong><small>${esc(personById(c.personId)?.name||'')} · ${esc(c.number)}</small></span><input type="checkbox" name="caseId" value="${c.id}"></label>`).join('')||'<div class="empty">沒有合資格案件。</div>'}<button class="btn primary block" type="submit" ${items.length?'':'disabled'}>批出新年大赦</button></form>`;
  }

  document.addEventListener('click', event => {
    const viewTarget=event.target.closest('[data-view]'); if(viewTarget){setView(viewTarget.dataset.view);return;}
    const target=event.target.closest('[data-action]'); if(!target)return; const action=target.dataset.action,id=target.dataset.id;
    const actions={
      'open-more':()=>setView('more'),'close-modal':closeModal,'new-person':()=>openPersonForm(),'edit-person':()=>openPersonForm(id),'new-case':()=>openCaseForm(),'edit-case':()=>openCaseForm(id),
      'person-detail':()=>personDetail(id),'case-detail':()=>caseDetail(id),'new-case-for':()=>{const p=id;openCaseForm();setTimeout(()=>{$('#case-form [name=personId]').value=p},0);},
      'adjust-score':()=>openModal(`賞罰紀錄：${personById(id).name}`,adjustScoreForm(personById(id))),
      'delete-person':()=>confirmAction('刪除人物檔案',`將同時刪除「${personById(id).name}」的全部案件及賞罰紀錄。確定繼續？`,()=>{const caseIds=casesForPerson(id).map(c=>c.id);db.people=db.people.filter(p=>p.id!==id);db.cases=db.cases.filter(c=>c.personId!==id);db.scoreHistory=db.scoreHistory.filter(h=>h.personId!==id&&!caseIds.includes(h.caseId));saveData();closeConfirm();closeModal();render();showToast('人物及相關案卷已刪除。');}),
      'delete-case':()=>confirmAction('刪除案件',`案件 ${caseById(id).number} 將連同相關分數紀錄永久刪除。`,()=>{db.cases=db.cases.filter(c=>c.id!==id);db.scoreHistory=db.scoreHistory.filter(h=>h.caseId!==id);saveData();closeConfirm();closeModal();render();showToast('案件已刪除。');}),
      'improve-case':()=>improveCase(id),'open-receipt':()=>openReceipt(id),'close-receipt':closeReceipt,'print-receipt':()=>window.print(),'download-receipt':()=>downloadReceipt(false),'share-receipt':()=>downloadReceipt(true),
      'draw-old':()=>{const choices=db.cases.filter(c=>c.id!==oldCaseId);oldCaseId=(choices.length?choices:db.cases)[Math.floor(Math.random()*(choices.length||db.cases.length))].id;render();},'share-old':shareOld,
      'random-pardon':()=>{const items=db.cases.filter(c=>c.type==='小過'&&!['已赦免','已改善'].includes(c.status));if(!items.length)return showToast('今天找不到可赦免的小過。');pardonCase(items[Math.floor(Math.random()*items.length)].id,'今日心情好：隨機赦免');},
      'birthday-pardon':()=>openModal('生日特赦',`<form id="birthday-form"><div class="field"><label>壽星人物</label><select name="personId" required>${db.people.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div><p>批出後減少 5 點犯錯分，並增加 4 點信用分。</p><button class="btn primary block" type="submit">批出生日特赦</button></form>`),
      'mass-pardon':()=>openModal('新年大赦',massPardonForm()),'export-data':exportData,'import-data':()=>$('#import-file').click(),
      'clear-demo':()=>confirmAction('清除示範資料','只會清除系統首次建立的示範人物、案件及分數，確定嗎？',()=>{const demoPersonIds=new Set(db.people.filter(p=>p.demo).map(p=>p.id));const demoCaseIds=new Set(db.cases.filter(c=>c.demo).map(c=>c.id));db.people=db.people.filter(p=>!p.demo);db.cases=db.cases.filter(c=>!c.demo);db.scoreHistory=db.scoreHistory.filter(h=>!h.demo&&!demoPersonIds.has(h.personId)&&!demoCaseIds.has(h.caseId));db.settings.demoData=false;saveData();closeConfirm();render();showToast('示範資料已清除，可以開始建立你的紀錄。');}),
      'clear-all':()=>confirmAction('第一次確認','這會清除全部人物、案件、簽名及分數。按下後仍需最後一次確認。',()=>{closeConfirm();setTimeout(()=>confirmAction('最後確認','真的要把整本小氣簿清空？此操作不能復原。',()=>{db={version:1,people:[],cases:[],scoreHistory:[],achievements:[],settings:{ownerName:'本簿持有人',demoData:false}};saveData();closeConfirm();setView('home');showToast('全部資料已清除。');}),150);}),
      'gist-force-push':async()=>{showToast('正在上傳…');await pushToGist({silent:false});if(currentView==='settings')render();},
      'gist-force-pull':()=>confirmAction('從 Gist 下載','會用雲端資料覆蓋本機目前內容，確定嗎？',async()=>{closeConfirm();showToast('正在下載…');const ok=await pullFromGist({force:true});if(ok){render();showToast('已從 Gist 載入資料');}else showToast(lastSyncError?'下載失敗：'+lastSyncError:'雲端沒有較新資料或格式不符');}),
      'gist-clear':()=>confirmAction('解除雲端同步','只會清除本機儲存的 Token 與 Gist ID，不會刪除 Gist 本身。',()=>{gistConfig={token:'',gistId:''};persistGistConfig();lastSyncAt=null;lastSyncError=null;closeConfirm();render();showToast('已解除自動同步');}),
      'cancel-confirm':closeConfirm,
      'verdict-to-case':()=>{const verdict={personId:target.dataset.person,title:decodeURIComponent(target.dataset.event).slice(0,42),description:decodeURIComponent(target.dataset.event),type:target.dataset.type,points:Number(target.dataset.points),suggestion:decodeURIComponent(target.dataset.suggestion),date:isoDate(),time:nowTime(),status:'待處理',mood:'激氣'};openModal('採納判決並立案',caseForm(verdict));}
    };
    actions[action]?.();
  });

  document.addEventListener('submit', event => {
    event.preventDefault(); const form=event.target;
    if(form.id==='person-form')handlePersonSubmit(form);
    if(form.id==='case-form')handleCaseSubmit(form);
    if(form.id==='score-form')handleScoreSubmit(form);
    if(form.id==='judge-form'){const data=Object.fromEntries(new FormData(form));const result=judgeEvent(data.event,data.personId,data.mode);const previousMode=db.settings.judgeMode;db.settings.judgeMode=data.mode;if(!saveData())db.settings.judgeMode=previousMode;renderVerdict(result,data.event,data.personId);}
    if(form.id==='birthday-form'){const id=new FormData(form).get('personId');const deduction=Math.min(5,personPoints(id));if(!deduction){showToast('這位人物目前沒有犯錯點數可供減免。');return;}const before=structuredClone(db);db.scoreHistory.push({id:uid('score'),personId:id,caseId:null,amount:-deduction,creditDelta:4,reason:'生日特赦',date:isoDate(),createdAt:new Date().toISOString()});if(!saveData()){db=before;return;}closeModal();render();showToast(`生日特赦已減少 ${deduction} 點，歷史仍然存在。`);}
    if(form.id==='mass-pardon-form'){const ids=new FormData(form).getAll('caseId');if(!ids.length){showToast('請至少選擇一宗案件。');return;}const before=structuredClone(db);ids.forEach(id=>pardonCase(id,'新年大赦',{save:false,silent:true}));if(!saveData()){db=before;return;}closeModal();render();showToast(`已赦免 ${ids.length} 宗案件，歷史仍然存在。`);}
    if(form.id==='gist-config-form'){
      const data=Object.fromEntries(new FormData(form));
      const gistId=String(data.gistId||'').trim();
      const token=String(data.token||'').trim();
      if(!gistId||!token){showToast('請填寫 Gist ID 和 Token');return;}
      gistConfig={gistId,token};
      persistGistConfig();
      showToast('正在驗證連線…');
      pushToGist({silent:false}).then(ok=>{
        if(ok) showToast('自動同步已啟用');
        render();
      });
    }
  });

  document.addEventListener('input', event => { if(event.target.id==='case-search'||event.target.id==='people-search')event.target.id==='case-search'?filterCases():filterPeople(); });
  document.addEventListener('change', event => {
    if(['case-type-filter','case-status-filter','case-year-filter','case-month-filter'].includes(event.target.id))filterCases();
    if(event.target.id==='case-type'){const input=$('#case-points');if(input)input.value=CASE_POINTS[event.target.value];}
    if(event.target.id==='import-file'&&event.target.files[0]){importData(event.target.files[0]);event.target.value='';}
  });

  $('#confirm-ok').addEventListener('click',()=>pendingConfirm?.());
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(!$('#receipt-screen').hidden)closeReceipt();else if(!$('#modal').hidden)closeModal();else if(!$('#confirm').hidden)closeConfirm();return;}
    if((event.key==='Enter'||event.key===' ')&&event.target.matches('[role="button"][data-action], [role="button"][data-view]')){event.preventDefault();event.target.click();}
  });

  if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(error=>console.warn('離線模式註冊失敗',error)));

  const query=new URLSearchParams(location.search); render();
  if(query.get('action')==='new-case')setTimeout(()=>openCaseForm(),100);

  // Auto-pull from Gist on startup when configured
  if (isGistConfigured()) {
    pullFromGist().then(pulled => {
      if (pulled) {
        render();
        showToast('已從雲端載入較新資料');
      }
    });
  }

  window.SiuHeiBook={getData:()=>structuredClone(db),setView,judgeEvent,version:'1.0.1'};
})();
