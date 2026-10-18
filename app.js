const STORAGE_KEY = "holo-draw-state-v1";
const MAX_ROSTER = 1000;
const MAX_HISTORY = 20;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const els = {
  pasteInput: document.querySelector("#pasteInput"),
  importTextButton: document.querySelector("#importTextButton"),
  rosterFile: document.querySelector("#rosterFile"),
  fileButton: document.querySelector("#fileButton"),
  manualName: document.querySelector("#manualName"),
  addNameButton: document.querySelector("#addNameButton"),
  searchInput: document.querySelector("#searchInput"),
  rosterList: document.querySelector("#rosterList"),
  rosterEmpty: document.querySelector("#rosterEmpty"),
  rosterCount: document.querySelector("#rosterCount"),
  rosterNote: document.querySelector("#rosterNote"),
  clearRosterButton: document.querySelector("#clearRosterButton"),
  modeCount: document.querySelector("#modeCount"),
  modeSize: document.querySelector("#modeSize"),
  groupValue: document.querySelector("#groupValue"),
  groupValueLabel: document.querySelector("#groupValueLabel"),
  settingHint: document.querySelector("#settingHint"),
  decrementValue: document.querySelector("#decrementValue"),
  incrementValue: document.querySelector("#incrementValue"),
  groupPreview: document.querySelector("#groupPreviewText"),
  drawButton: document.querySelector("#drawButton"),
  rerollButton: document.querySelector("#rerollButton"),
  drawPanel: document.querySelector("#draw"),
  drawDescription: document.querySelector("#drawDescription"),
  appStatus: document.querySelector("#appStatus"),
  groupsGrid: document.querySelector("#groupsGrid"),
  resultState: document.querySelector("#resultState"),
  resultsDescription: document.querySelector("#resultsDescription"),
  confirmGroupsButton: document.querySelector("#confirmGroupsButton"),
  restartButton: document.querySelector("#restartButton"),
  exportJsonButton: document.querySelector("#exportJsonButton"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
  copyResultsButton: document.querySelector("#copyResultsButton"),
  backupFile: document.querySelector("#backupFile"),
  historyCount: document.querySelector("#historyCount"),
  historyList: document.querySelector("#historyList"),
  confirmDialog: document.querySelector("#confirmDialog"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogMessage: document.querySelector("#dialogMessage"),
  dialogSummary: document.querySelector("#dialogSummary"),
  dialogConfirmButton: document.querySelector("#dialogConfirmButton"),
  dialogCancelButton: document.querySelector("#dialogCancelButton"),
  dialogCloseButton: document.querySelector("#dialogCloseButton"),
  toast: document.querySelector("#toast"),
};

function blankState() {
  return { roster: [], mode: "count", groupCount: 3, membersPerGroup: 4, draft: null, confirmed: null, history: [] };
}

function normalizeName(name) {
  return String(name ?? "").replace(/\uFEFF/g, "").replace(/\s+/g, " ").trim();
}

function uniqueRoster(values) {
  const names = [];
  const seen = new Set();
  for (const value of values) {
    const name = normalizeName(value);
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
    if (names.length >= MAX_ROSTER) break;
  }
  return names;
}

function cleanGroups(groups, roster) {
  if (!Array.isArray(groups) || groups.length === 0 || groups.length > MAX_ROSTER) return null;
  const allowed = new Set(roster);
  const seen = new Set();
  const result = [];
  for (const group of groups) {
    if (!Array.isArray(group)) return null;
    const members = [];
    for (const member of group) {
      if (typeof member !== "string" || !allowed.has(member) || seen.has(member)) return null;
      seen.add(member);
      members.push(member);
    }
    result.push(members);
  }
  return result;
}

function restoreState(raw) {
  const data = raw?.state && raw?.app === "holo-draw" ? raw.state : raw;
  if (!data || !Array.isArray(data.roster) || data.roster.length > MAX_ROSTER) return null;
  const roster = uniqueRoster(data.roster);
  const next = blankState();
  next.roster = roster;
  next.mode = data.mode === "size" ? "size" : "count";
  next.groupCount = clampInteger(data.groupCount, 2, 100, 3);
  next.membersPerGroup = clampInteger(data.membersPerGroup, 1, 100, 4);
  const draft = cleanGroups(data.draft, roster);
  next.draft = draft && draft.flat().length === roster.length ? draft : null;
  if (data.confirmed && typeof data.confirmed === "object") {
    const groups = cleanGroups(data.confirmed.groups, roster);
    if (groups && groups.flat().length === roster.length) {
      next.confirmed = { groups, createdAt: validDate(data.confirmed.createdAt) };
      next.draft = groups;
    }
  }
  if (Array.isArray(data.history)) {
    next.history = data.history.slice(0, MAX_HISTORY).flatMap((entry) => {
      if (!entry || !Array.isArray(entry.groups)) return [];
      const groups = cleanGroups(entry.groups, roster);
      if (!groups || !groups.flat().length) return [];
      return [{ groups, createdAt: validDate(entry.createdAt) }];
    });
  }
  return next;
}

function validDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function readSavedState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return blankState();
    return restoreState(JSON.parse(saved)) ?? blankState();
  } catch {
    return blankState();
  }
}

let state = readSavedState();
let toastTimer = 0;
let dialogAction = null;
let drawLock = false;

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    showToast("無法儲存到本機。請檢查瀏覽器儲存空間或隱私設定。", "error");
    return false;
  }
}

function setStatus(message, type = "info") {
  els.appStatus.dataset.type = type;
  els.appStatus.lastElementChild.textContent = message;
}

function showToast(message, type = "success") {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.dataset.type = type;
  els.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 3200);
}

function hasConfirmedGroups() {
  return Boolean(state.confirmed?.groups?.length);
}

function currentGroups() {
  return state.confirmed?.groups ?? state.draft;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function renderRoster() {
  const query = normalizeName(els.searchInput.value).toLocaleLowerCase();
  const filtered = state.roster
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => !query || name.toLocaleLowerCase().includes(query));

  els.rosterCount.textContent = String(state.roster.length);
  els.rosterList.innerHTML = filtered.map(({ name, index }) => `
    <li class="roster-item" data-index="${index}">
      <span class="roster-index">${String(index + 1).padStart(2, "0")}</span>
      <span class="roster-name">${escapeHTML(name)}</span>
      <button class="remove-person" type="button" data-remove="${index}" aria-label="移除 ${escapeHTML(name)}" ${hasConfirmedGroups() ? "disabled" : ""}>×</button>
    </li>`).join("");

  els.rosterEmpty.hidden = filtered.length > 0;
  if (state.roster.length === 0) {
    els.rosterEmpty.innerHTML = "名單還是空的。<br /><span>貼上名單，準備好第一道訊號。</span>";
  } else if (filtered.length === 0) {
    els.rosterEmpty.innerHTML = "沒有找到符合的成員。<br /><span>試試其他搜尋關鍵字。</span>";
  }
  els.rosterNote.textContent = hasConfirmedGroups()
    ? "分組已確認。若需更改名單，請先解除確認並重新抽籤。"
    : "名單只保存在這台裝置的瀏覽器。";
  const locked = hasConfirmedGroups();
  els.pasteInput.disabled = locked;
  els.importTextButton.disabled = locked;
  els.rosterFile.disabled = locked;
  els.fileButton.classList.toggle("is-disabled", locked);
  els.manualName.disabled = locked;
  els.addNameButton.disabled = locked;
  els.clearRosterButton.disabled = locked || state.roster.length === 0;
}

function getGroupCount() {
  if (!state.roster.length) return 0;
  return state.mode === "count"
    ? Math.max(1, Math.min(state.groupCount, state.roster.length))
    : Math.max(1, Math.ceil(state.roster.length / state.membersPerGroup));
}

function renderSettings() {
  const locked = hasConfirmedGroups();
  els.modeCount.classList.toggle("is-active", state.mode === "count");
  els.modeSize.classList.toggle("is-active", state.mode === "size");
  els.modeCount.setAttribute("aria-pressed", String(state.mode === "count"));
  els.modeSize.setAttribute("aria-pressed", String(state.mode === "size"));
  els.modeCount.disabled = locked;
  els.modeSize.disabled = locked;
  els.groupValue.disabled = locked;
  els.decrementValue.disabled = locked;
  els.incrementValue.disabled = locked;

  if (state.mode === "count") {
    els.groupValueLabel.textContent = "總組數";
    els.settingHint.textContent = "建立幾個小隊？";
    els.groupValue.min = "2";
    els.groupValue.max = String(Math.max(2, Math.min(100, state.roster.length || 100)));
    els.groupValue.value = String(state.groupCount);
    els.decrementValue.setAttribute("aria-label", "減少一組");
    els.incrementValue.setAttribute("aria-label", "增加一組");
  } else {
    els.groupValueLabel.textContent = "每組人數";
    els.settingHint.textContent = "每隊預計幾位成員？";
    els.groupValue.min = "1";
    els.groupValue.max = "100";
    els.groupValue.value = String(state.membersPerGroup);
    els.decrementValue.setAttribute("aria-label", "減少每組人數");
    els.incrementValue.setAttribute("aria-label", "增加每組人數");
  }

  if (!state.roster.length) {
    els.groupPreview.textContent = "匯入名單後，這裡會顯示分組預覽。";
    return;
  }
  const count = getGroupCount();
  const base = Math.floor(state.roster.length / count);
  const remainder = state.roster.length % count;
  const sizes = Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
  const sizeSummary = [...new Set(sizes)].sort((a, b) => b - a).map((size) => `${sizes.filter((n) => n === size).length} 組 × ${size} 人`).join("　");
  els.groupPreview.textContent = `${state.roster.length} 位成員 · ${count} 組\n${sizeSummary}`;
}

function renderGroups() {
  const groups = currentGroups();
  const confirmed = hasConfirmedGroups();
  els.resultState.textContent = confirmed ? "已確認並保存" : state.draft ? "待確認" : "尚未抽籤";
  els.resultState.dataset.state = confirmed ? "confirmed" : state.draft ? "draft" : "empty";
  els.resultsDescription.textContent = confirmed
    ? `已確認 ${state.roster.length} 位成員，共 ${groups.length} 組。`
    : state.draft
      ? `暫定 ${state.roster.length} 位成員，共 ${groups.length} 組；確認前仍可重抽。`
      : "每一個名字，都會找到自己的隊伍。";

  if (!groups?.length) {
    els.groupsGrid.innerHTML = '<div class="groups-placeholder"><span aria-hidden="true">◌</span><p>分組結果將在這裡展開</p><small>匯入名單後啟動抽籤</small></div>';
  } else {
    els.groupsGrid.innerHTML = groups.map((group, index) => `
      <article class="group-card" aria-label="第 ${index + 1} 組，共 ${group.length} 人">
        <div class="group-card-header"><h3>第 ${index + 1} 組</h3><span>${group.length} 人</span></div>
        <ul class="group-members">${group.map((name) => `<li>${escapeHTML(name)}</li>`).join("")}</ul>
      </article>`).join("");
  }

  els.drawButton.disabled = state.roster.length < 2 || confirmed || drawLock;
  els.drawButton.querySelector("strong").textContent = state.draft ? (confirmed ? "分組已確認" : "再次抽籤") : "開始抽籤";
  els.drawButton.querySelector("small").textContent = state.draft ? (confirmed ? "DRAW / LOCKED" : "SHUFFLE / AGAIN") : "SHUFFLE / START";
  els.rerollButton.disabled = !state.draft || confirmed || drawLock;
  els.confirmGroupsButton.disabled = !state.draft || confirmed || drawLock;
  els.confirmGroupsButton.hidden = confirmed;
  els.restartButton.hidden = !confirmed;
  els.exportJsonButton.disabled = state.roster.length === 0;
  els.exportCsvButton.disabled = state.roster.length === 0;
  els.copyResultsButton.disabled = !groups?.length;

  if (confirmed) {
    els.drawDescription.textContent = "分組已鎖定並保存；如需更改，先解除確認再重新抽籤。";
  } else if (state.draft) {
    els.drawDescription.textContent = "結果已生成。確認之前，仍可再次洗牌。";
  } else {
    els.drawDescription.textContent = state.roster.length < 2
      ? "至少匯入 2 位參與者，才能開始分組抽籤。"
      : "名單就緒後，按下按鈕開始隨機分組。";
  }
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  } catch {
    return "最近";
  }
}

function renderHistory() {
  els.historyCount.textContent = `${state.history.length} 筆`;
  if (!state.history.length) {
    els.historyList.innerHTML = '<li class="history-empty">目前還沒有已確認的分組。</li>';
    return;
  }
  els.historyList.innerHTML = state.history.map((entry, index) => {
    const people = entry.groups.flat().length;
    const summary = entry.groups.slice(0, 3).map((group, groupIndex) => `第${groupIndex + 1}組：${group.slice(0, 3).join("、")}${group.length > 3 ? "…" : ""}`).join(" ／ ");
    return `<li class="history-item"><div class="history-meta"><strong>紀錄 ${String(state.history.length - index).padStart(2, "0")} · ${entry.groups.length} 組</strong><time>${formatDate(entry.createdAt)}</time></div><p class="history-preview">${people} 位成員 · ${escapeHTML(summary)}</p></li>`;
  }).join("");
}

function render() {
  renderRoster();
  renderSettings();
  renderGroups();
  renderHistory();
}

function parseCSVFirstField(line) {
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      break;
    } else {
      field += char;
    }
  }
  return normalizeName(field);
}

function parseNameText(text) {
  const lines = String(text).split(/\r?\n/);
  const parsed = [];
  let skippedHeaders = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const name = parseCSVFirstField(trimmed);
    if (/^(name|姓名|成員|成员|名單|名单|participant|member)$/i.test(name)) {
      skippedHeaders += 1;
      continue;
    }
    if (name) parsed.push(name);
  }
  const unique = uniqueRoster(parsed);
  return { names: unique, duplicates: parsed.length - unique.length, skippedHeaders };
}

function addNames(names, source = "名單") {
  if (hasConfirmedGroups()) {
    showToast("分組已確認；請先解除確認再編輯名單。", "error");
    return;
  }
  const existing = new Set(state.roster.map((name) => name.toLocaleLowerCase()));
  const additions = [];
  let duplicates = 0;
  for (const raw of names) {
    const name = normalizeName(raw);
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    if (existing.has(key)) {
      duplicates += 1;
      continue;
    }
    existing.add(key);
    additions.push(name);
  }
  const capacity = Math.max(0, MAX_ROSTER - state.roster.length);
  const accepted = additions.slice(0, capacity);
  state.roster.push(...accepted);
  invalidateDraft();
  saveState();
  render();
  if (!accepted.length) {
    showToast(duplicates ? `沒有新增項目，${duplicates} 個重複名稱已略過。` : "找不到可匯入的名稱。", duplicates ? "info" : "error");
    return;
  }
  const extra = duplicates ? `，略過 ${duplicates} 個重複名稱` : "";
  const limit = accepted.length < additions.length ? "；已達 1,000 人上限" : "";
  setStatus(`已從${source}匯入 ${accepted.length} 位參與者。`, "success");
  showToast(`成功匯入 ${accepted.length} 位參與者${extra}${limit}。`);
}

function invalidateDraft() {
  state.draft = null;
  state.confirmed = null;
}

function generateGroups() {
  const roster = [...state.roster];
  const groupCount = getGroupCount();
  if (roster.length < 2 || groupCount < 1) return null;
  for (let index = roster.length - 1; index > 0; index -= 1) {
    const target = secureRandomIndex(index + 1);
    [roster[index], roster[target]] = [roster[target], roster[index]];
  }
  const groups = Array.from({ length: groupCount }, () => []);
  const baseSize = Math.floor(roster.length / groupCount);
  let extra = roster.length % groupCount;
  let cursor = 0;
  for (const group of groups) {
    const size = baseSize + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    group.push(...roster.slice(cursor, cursor + size));
    cursor += size;
  }
  return groups;
}

function secureRandomIndex(maxExclusive) {
  if (globalThis.crypto?.getRandomValues) {
    const range = 0x100000000;
    const limit = Math.floor(range / maxExclusive) * maxExclusive;
    const value = new Uint32Array(1);
    do {
      crypto.getRandomValues(value);
    } while (value[0] >= limit);
    return value[0] % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

function runDraw() {
  if (drawLock || hasConfirmedGroups()) return;
  if (state.roster.length < 2) {
    setStatus("至少匯入 2 位參與者，才能開始抽籤。", "error");
    showToast("名單至少需要 2 位參與者。", "error");
    return;
  }
  drawLock = true;
  els.drawPanel.classList.add("is-shuffling");
  setStatus("正在洗牌與隨機分派……", "info");
  renderGroups();
  window.setTimeout(() => {
    state.draft = generateGroups();
    drawLock = false;
    els.drawPanel.classList.remove("is-shuffling");
    saveState();
    render();
    setStatus(`抽籤完成：${state.roster.length} 位參與者已分成 ${state.draft.length} 組。`, "success");
    showToast("分組訊號已完成。確認前可以再抽一次。");
  }, 220);
}

function groupSummary(groups) {
  return groups.map((group, index) => `第 ${index + 1} 組（${group.length} 位）：${group.join("、")}`).join("\n");
}

function openDialog({ title, message, summary, button, action }) {
  dialogAction = action;
  els.dialogTitle.textContent = title;
  els.dialogMessage.textContent = message;
  els.dialogSummary.textContent = summary ?? "";
  els.dialogSummary.hidden = !summary;
  els.dialogConfirmButton.textContent = button;
  if (typeof els.confirmDialog.showModal === "function") {
    if (!els.confirmDialog.open) els.confirmDialog.showModal();
  } else {
    els.confirmDialog.setAttribute("open", "");
    els.confirmDialog.classList.add("is-fallback-open");
  }
}

function closeDialog() {
  if (typeof els.confirmDialog.close === "function" && els.confirmDialog.open) {
    els.confirmDialog.close();
  } else {
    els.confirmDialog.removeAttribute("open");
    els.confirmDialog.classList.remove("is-fallback-open");
  }
  dialogAction = null;
}

function askToConfirmGroups() {
  if (!state.draft || hasConfirmedGroups()) return;
  openDialog({
    title: "確認這次分組？",
    message: "確認後會保存結果，並鎖定名單與分組設定。你仍可在之後解除確認並重新抽籤。",
    summary: groupSummary(state.draft),
    button: "確認分組",
    action: () => {
      const confirmed = { groups: state.draft.map((group) => [...group]), createdAt: new Date().toISOString() };
      state.confirmed = confirmed;
      state.history.unshift({ groups: confirmed.groups.map((group) => [...group]), createdAt: confirmed.createdAt });
      state.history = state.history.slice(0, MAX_HISTORY);
      saveState();
      render();
      setStatus("分組已確認並保存。你可以複製結果或匯出備份。", "success");
      showToast("分組確認完成，已保存到本機。\n現在可以複製或匯出。");
    },
  });
}

function askToRestart() {
  if (!hasConfirmedGroups()) return;
  openDialog({
    title: "解除確認並重抽？",
    message: "這會解除目前確認狀態，清除本次結果並解鎖名單與設定；先前確認紀錄仍會保留。",
    summary: `目前已確認 ${state.roster.length} 位成員、${state.confirmed.groups.length} 組。`,
    button: "解除並重抽",
    action: () => {
      invalidateDraft();
      saveState();
      render();
      setStatus("確認已解除。可以修改名單或重新抽籤。", "info");
      showToast("確認已解除，名單與設定已解鎖。", "info");
    },
  });
}

function askToClearRoster() {
  if (!state.roster.length || hasConfirmedGroups()) return;
  openDialog({
    title: "清空這份名單？",
    message: "這會清除目前的參與者與尚未確認的抽籤結果。已確認的歷史紀錄會保留。",
    summary: `即將移除 ${state.roster.length} 位參與者。`,
    button: "清空名單",
    action: () => {
      state.roster = [];
      invalidateDraft();
      saveState();
      render();
      setStatus("名單已清空。", "info");
      showToast("名單已清空。", "info");
    },
  });
}

function closeDialogAndRunAction() {
  const action = dialogAction;
  closeDialog();
  if (typeof action === "function") action();
}

async function copyText(text, successMessage) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const temp = document.createElement("textarea");
      temp.value = text;
      temp.setAttribute("readonly", "");
      temp.style.position = "fixed";
      temp.style.opacity = "0";
      temp.style.pointerEvents = "none";
      document.body.append(temp);
      temp.select();
      const copied = document.execCommand("copy");
      temp.remove();
      if (!copied) throw new Error("clipboard unavailable");
    }
    showToast(successMessage);
    setStatus(successMessage, "success");
  } catch {
    showToast("複製未成功。請確認瀏覽器允許剪貼簿操作。", "error");
    setStatus("複製未成功，請檢查瀏覽器的剪貼簿權限。", "error");
  }
}

function resultsText() {
  const groups = currentGroups();
  if (!groups?.length) return state.roster.join("\n");
  const prefix = hasConfirmedGroups() ? "【已確認分組】" : "【待確認分組】";
  return `${prefix}\n${groupSummary(groups)}`;
}

function downloadFile(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function fileStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function exportBackup() {
  if (!state.roster.length) return;
  const backup = {
    app: "holo-draw",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    state,
  };
  downloadFile(`holo-draw-backup-${fileStamp()}.json`, JSON.stringify(backup, null, 2), "application/json;charset=utf-8");
  showToast("完整 JSON 備份已匯出，可用「匯入 JSON 備份」還原。");
  setStatus("JSON 備份已匯出。", "success");
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function exportCSV() {
  if (!state.roster.length) return;
  const groups = currentGroups();
  const groupByName = new Map();
  (groups ?? []).forEach((group, index) => group.forEach((name) => groupByName.set(name, `第 ${index + 1} 組`)));
  const rows = [["姓名", "分組", "狀態"]];
  for (const name of state.roster) {
    rows.push([name, groupByName.get(name) ?? "尚未分組", hasConfirmedGroups() ? "已確認" : groups ? "待確認" : "尚未抽籤"]);
  }
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  downloadFile(`holo-draw-groups-${fileStamp()}.csv`, csv, "text/csv;charset=utf-8");
  showToast("CSV 分組表已匯出。", "success");
  setStatus("CSV 分組表已匯出。", "success");
}

function removePerson(index) {
  if (hasConfirmedGroups() || !Number.isInteger(index) || index < 0 || index >= state.roster.length) return;
  const [removed] = state.roster.splice(index, 1);
  invalidateDraft();
  saveState();
  render();
  showToast(`已移除「${removed}」。`, "info");
}

function addManualName() {
  const name = normalizeName(els.manualName.value);
  if (!name) {
    showToast("先輸入要加入的名字。", "error");
    els.manualName.focus();
    return;
  }
  const exists = state.roster.some((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (exists) {
    showToast(`「${name}」已在名單中。`, "info");
    return;
  }
  if (state.roster.length >= MAX_ROSTER) {
    showToast(`名單最多可包含 ${MAX_ROSTER} 位參與者。`, "error");
    return;
  }
  addNames([name], "手動輸入");
  els.manualName.value = "";
}

async function importRosterFile(file) {
  if (!file) return;
  if (file.size > MAX_UPLOAD_BYTES) {
    showToast("檔案太大，請選擇小於 2 MB 的文字、CSV 或 JSON 檔案。", "error");
    return;
  }
  try {
    const text = await file.text();
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension === "json" || file.type === "application/json") {
      importBackupData(JSON.parse(text));
      return;
    }
    const parsed = parseNameText(text);
    if (!parsed.names.length) {
      showToast("檔案中沒有可匯入的名字。", "error");
      return;
    }
    addNames(parsed.names, extension === "csv" ? "CSV 檔案" : "文字檔");
  } catch {
    showToast("檔案格式無法讀取。請確認它是有效的 TXT、CSV 或 HOLO / DRAW JSON 備份。", "error");
    setStatus("檔案讀取失敗，現有資料沒有變更。", "error");
  } finally {
    els.rosterFile.value = "";
    els.backupFile.value = "";
  }
}

function importBackupData(data) {
  if (!data || (data.app !== "holo-draw" && !data.state) || data.schemaVersion > 1) {
    showToast("這不是可辨識的 HOLO / DRAW 備份，現有資料未變更。", "error");
    return;
  }
  const restored = restoreState(data);
  if (!restored) {
    showToast("備份資料格式不完整或內容無效，現有資料未變更。", "error");
    return;
  }
  state = restored;
  saveState();
  render();
  setStatus(`已還原備份：${state.roster.length} 位參與者${hasConfirmedGroups() ? "，分組已確認" : ""}。`, "success");
  showToast(`備份已還原，載入 ${state.roster.length} 位參與者。`);
}

function applyMode(mode) {
  if (hasConfirmedGroups()) return;
  if (state.mode === mode) return;
  state.mode = mode;
  invalidateDraft();
  saveState();
  render();
  setStatus("分組方式已更新，請重新抽籤。", "info");
}

function updateGroupValue(value) {
  if (hasConfirmedGroups()) return;
  const min = state.mode === "count" ? 2 : 1;
  const max = state.mode === "count" ? Math.max(2, Math.min(100, state.roster.length || 100)) : 100;
  const number = clampInteger(value, min, max, min);
  if (state.mode === "count") state.groupCount = number;
  else state.membersPerGroup = number;
  invalidateDraft();
  saveState();
  render();
  setStatus("分組設定已更新，請重新抽籤。", "info");
}

els.importTextButton.addEventListener("click", () => {
  const parsed = parseNameText(els.pasteInput.value);
  if (!parsed.names.length) {
    showToast("先貼上名單；每行輸入一位參與者。", "error");
    els.pasteInput.focus();
    return;
  }
  addNames(parsed.names, "貼上的名單");
  if (parsed.duplicates) showToast(`重複名稱已自動合併（${parsed.duplicates} 筆）。`);
  els.pasteInput.value = "";
});
els.rosterFile.addEventListener("change", (event) => importRosterFile(event.target.files?.[0]));
els.backupFile.addEventListener("change", (event) => importRosterFile(event.target.files?.[0]));
els.addNameButton.addEventListener("click", addManualName);
els.manualName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addManualName();
  }
});
els.searchInput.addEventListener("input", renderRoster);
els.rosterList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (button) removePerson(Number(button.dataset.remove));
});
els.clearRosterButton.addEventListener("click", askToClearRoster);
els.modeCount.addEventListener("click", () => applyMode("count"));
els.modeSize.addEventListener("click", () => applyMode("size"));
els.groupValue.addEventListener("change", () => updateGroupValue(els.groupValue.value));
els.groupValue.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    updateGroupValue(els.groupValue.value);
    els.groupValue.blur();
  }
});
els.decrementValue.addEventListener("click", () => updateGroupValue(Number(els.groupValue.value) - 1));
els.incrementValue.addEventListener("click", () => updateGroupValue(Number(els.groupValue.value) + 1));
els.drawButton.addEventListener("click", runDraw);
els.rerollButton.addEventListener("click", runDraw);
els.confirmGroupsButton.addEventListener("click", askToConfirmGroups);
els.restartButton.addEventListener("click", askToRestart);
els.dialogConfirmButton.addEventListener("click", closeDialogAndRunAction);
els.dialogCancelButton.addEventListener("click", closeDialog);
els.dialogCloseButton.addEventListener("click", closeDialog);
els.confirmDialog.addEventListener("click", (event) => {
  if (event.target === els.confirmDialog) closeDialog();
});
els.exportJsonButton.addEventListener("click", exportBackup);
els.exportCsvButton.addEventListener("click", exportCSV);
els.copyResultsButton.addEventListener("click", () => copyText(resultsText(), "名單／分組結果已複製到剪貼簿。"));

render();
if (state.roster.length) {
  setStatus(`已從本機恢復 ${state.roster.length} 位參與者${hasConfirmedGroups() ? "與已確認分組" : ""}。`, "success");
}
