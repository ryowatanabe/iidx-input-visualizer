"use strict";

// Add future controller models here. Gamepad button and axis indexes are zero-based.
const PROFILES = {
  konami_iidx: {
    label: "KONAMI beatmania IIDX 専用コントローラ",
    buttons: [0, 1, 2, 3, 4, 5, 6],
    scratchAxis: 0,
    axisMin: -1,
    axisMax: 1,
    noise: 0.004,
    startDistance: 0.0075,
    reverseDistance: 0.0075,
    stopMs: 150
  }
};
const STORAGE_KEY = "iidx-input-visualizer:v1";
const sides = ["1p", "2p"];
const $ = (id) => document.getElementById(id);
const emptyCounts = () => ({ keys: Array(7).fill(0), scratch: 0 });
const state = {
  mode: "1p", profile: "konami_iidx", counts: { "1p": emptyCounts(), "2p": emptyCounts() },
  assigned: { "1p": null, "2p": null }, runtime: { "1p": null, "2p": null },
  devices: [], saveTimer: null, lastDeviceSignature: "", lastDiagnosticAt: 0
};

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return;
    if (["1p", "2p", "dp"].includes(saved.mode)) state.mode = saved.mode;
    if (PROFILES[saved.profile]) state.profile = saved.profile;
    for (const side of sides) {
      const item = saved.counts?.[side];
      if (!item) continue;
      if (Array.isArray(item.keys) && item.keys.length === 7) {
        state.counts[side].keys = item.keys.map((n) => Number.isSafeInteger(n) && n >= 0 ? n : 0);
      }
      if (Number.isSafeInteger(item.scratch) && item.scratch >= 0) state.counts[side].scratch = item.scratch;
    }
  } catch { /* Corrupt or unavailable storage starts a fresh session. */ }
}
function save() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: state.mode, profile: state.profile, counts: state.counts })); }
  catch { $("notice").textContent = "ブラウザの保存領域を利用できないため、再読み込み後にカウントを復元できません。"; }
}
function scheduleSave() {
  if (state.saveTimer === null) state.saveTimer = setTimeout(save, 200);
}
function freshRuntime(pad) {
  return {
    index: pad.index, id: pad.id,
    buttons: PROFILES[state.profile].buttons.map((i) => Boolean(pad.buttons[i]?.pressed)),
    axis: Number.isFinite(pad.axes[PROFILES[state.profile].scratchAxis]) ? pad.axes[PROFILES[state.profile].scratchAxis] : null,
    lastSample: performance.now(), motionAt: 0, direction: 0,
    pendingDirection: 0, pendingDistance: 0, active: false
  };
}
function deviceLabel(pad) { return `#${pad.index} ${pad.id || "名称不明"}`; }
function currentPads() {
  if (typeof navigator.getGamepads !== "function") return [];
  try { return Array.from(navigator.getGamepads()).filter((pad) => pad?.connected); }
  catch { return []; }
}
function reconcileDevices(pads) {
  const signature = pads.map((pad) => `${pad.index}:${pad.id}`).join("|");
  if (signature === state.lastDeviceSignature) return;
  state.lastDeviceSignature = signature;
  state.devices = pads;
  for (const side of sides) {
    if (!pads.some((pad) => pad.index === state.assigned[side])) {
      state.assigned[side] = null;
      state.runtime[side] = null;
    }
  }
  if (state.assigned["1p"] === null && pads[0]) state.assigned["1p"] = pads[0].index;
  if (state.assigned["2p"] === null) {
    const other = pads.find((pad) => pad.index !== state.assigned["1p"]);
    if (other) state.assigned["2p"] = other.index;
    else if (pads[0] && state.mode !== "dp") state.assigned["2p"] = pads[0].index;
  }
  if (state.mode === "dp" && state.assigned["1p"] === state.assigned["2p"]) {
    state.assigned["2p"] = pads.find((pad) => pad.index !== state.assigned["1p"])?.index ?? null;
    state.runtime["2p"] = null;
  }
  updateDeviceOptions();
  renderDecks();
}
function updateDeviceOptions() {
  for (const side of sides) {
    const select = $(side === "1p" ? "device-1p" : "device-2p");
    select.replaceChildren();
    select.add(new Option("未選択", ""));
    for (const pad of state.devices) select.add(new Option(deviceLabel(pad), String(pad.index)));
    select.value = state.assigned[side] === null ? "" : String(state.assigned[side]);
  }
}
function setAssignment(side, value) {
  const next = value === "" ? null : Number(value);
  if (next !== null && !state.devices.some((pad) => pad.index === next)) return;
  state.assigned[side] = next;
  state.runtime[side] = null;
  if (state.mode === "dp" && next !== null) {
    const other = side === "1p" ? "2p" : "1p";
    if (state.assigned[other] === next) {
      state.assigned[other] = state.devices.find((pad) => pad.index !== next)?.index ?? null;
      state.runtime[other] = null;
    }
  }
  updateDeviceOptions();
  renderDecks();
}
function activeSides() { return state.mode === "dp" ? sides : [state.mode]; }
function deckMarkup(side) {
  const sideName = side.toUpperCase();
  const pad = state.devices.find((item) => item.index === state.assigned[side]);
  const keys = Array.from({ length: 7 }, (_, i) => `<div class="key ${[1, 3, 5].includes(i) ? "black" : ""}" data-key="${i + 1}" aria-label="${i + 1}鍵盤">${i + 1}</div>`).join("");
  return `<article class="deck panel" data-side="${side}"><div class="deck-head"><h2>${sideName}</h2><span>${pad ? escapeHtml(deviceLabel(pad)) : "コントローラー未選択"}</span></div><div class="controller side-${side}"><div class="turntable" aria-label="ターンテーブル"><span>SCR</span></div><div class="keys" aria-label="鍵盤">${keys}</div></div></article>`;
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function renderDecks() {
  $("decks").classList.toggle("dp", state.mode === "dp");
  $("decks").innerHTML = activeSides().map(deckMarkup).join("");
  $("device-1p").parentElement.hidden = state.mode === "2p";
  $("device-2p-wrap").hidden = state.mode === "1p";
  updateHighlights();
}
function updateTotals() {
  $("key-total").textContent = sides.reduce((sum, side) => sum + state.counts[side].keys.reduce((a, b) => a + b, 0), 0).toLocaleString();
  $("scratch-total").textContent = sides.reduce((sum, side) => sum + state.counts[side].scratch, 0).toLocaleString();
}
function updateHighlights() {
  for (const side of activeSides()) {
    const deck = document.querySelector(`[data-side="${side}"]`);
    if (!deck) continue;
    const runtime = state.runtime[side];
    deck.querySelectorAll(".key").forEach((key, i) => key.classList.toggle("active", Boolean(runtime?.buttons[i])));
    deck.querySelector(".turntable").classList.toggle("active", Boolean(runtime?.active));
  }
}
function axisDelta(previous, current, profile) {
  const span = profile.axisMax - profile.axisMin;
  let delta = current - previous;
  if (delta > span / 2) delta -= span;
  if (delta < -span / 2) delta += span;
  return delta;
}
function processScratch(side, runtime, pad, now, profile) {
  const current = pad.axes[profile.scratchAxis];
  if (!Number.isFinite(current) || runtime.axis === null) {
    runtime.axis = Number.isFinite(current) ? current : null;
    runtime.lastSample = now;
    return;
  }
  // A long polling gap makes both the direction and wrap count unknowable.
  if (now - runtime.lastSample > 250) {
    runtime.axis = current;
    runtime.lastSample = now;
    runtime.active = false;
    runtime.direction = 0;
    runtime.pendingDirection = 0;
    runtime.pendingDistance = 0;
    return;
  }
  const delta = axisDelta(runtime.axis, current, profile);
  runtime.axis = current;
  runtime.lastSample = now;
  if (Math.abs(delta) > profile.noise) {
    const direction = Math.sign(delta);
    runtime.motionAt = now;
    if (!runtime.active) {
      if (runtime.pendingDirection !== direction) { runtime.pendingDirection = direction; runtime.pendingDistance = 0; }
      runtime.pendingDistance += Math.abs(delta);
      if (runtime.pendingDistance >= profile.startDistance) {
        runtime.active = true;
        runtime.direction = direction;
        runtime.pendingDistance = 0;
        state.counts[side].scratch++;
        updateTotals(); scheduleSave();
      }
    } else if (direction === runtime.direction) {
      runtime.pendingDirection = 0;
      runtime.pendingDistance = 0;
    } else {
      if (runtime.pendingDirection !== direction) { runtime.pendingDirection = direction; runtime.pendingDistance = 0; }
      runtime.pendingDistance += Math.abs(delta);
      if (runtime.pendingDistance >= profile.reverseDistance) {
        runtime.direction = direction;
        runtime.pendingDistance = 0;
        state.counts[side].scratch++;
        updateTotals(); scheduleSave();
      }
    }
  }
  if (runtime.active && now - runtime.motionAt >= profile.stopMs) {
    runtime.active = false;
    runtime.direction = 0;
    runtime.pendingDirection = 0;
    runtime.pendingDistance = 0;
  }
}
function processPad(side, pad, now) {
  const profile = PROFILES[state.profile];
  let runtime = state.runtime[side];
  if (!runtime || runtime.index !== pad.index || runtime.id !== pad.id) runtime = state.runtime[side] = freshRuntime(pad);
  profile.buttons.forEach((buttonIndex, i) => {
    const pressed = Boolean(pad.buttons[buttonIndex]?.pressed);
    if (pressed && !runtime.buttons[i]) {
      state.counts[side].keys[i]++;
      updateTotals(); scheduleSave();
    }
    runtime.buttons[i] = pressed;
  });
  processScratch(side, runtime, pad, now, profile);
}
function updateNotice(pads) {
  const needed = state.mode === "dp" ? 2 : 1;
  const assigned = activeSides().map((side) => state.assigned[side]);
  const ready = assigned.every((index) => index !== null && pads.some((pad) => pad.index === index)) && new Set(assigned).size === needed;
  $("connection-status").textContent = ready ? "入力を監視中" : "接続待ち";
  $("connection-status").classList.toggle("live", ready);
  if (!navigator.getGamepads) $("notice").textContent = "このブラウザではGamepad APIを利用できません。";
  else if (document.hidden) $("notice").textContent = "タブが非表示のため計測を一時停止しています。";
  else if (pads.length === 0) $("notice").textContent = "コントローラーのボタンを押すかターンテーブルを回して、ブラウザに認識させてください。";
  else if (!ready) $("notice").textContent = state.mode === "dp" ? "DPには異なるコントローラーが2台必要です。1P側と2P側を選択してください。" : "使用するコントローラーを選択してください。";
  else $("notice").textContent = "入力を監視しています。ターンテーブルの回し始めと方向転換を数えます。";
}
function updateDiagnostics(pads) {
  if (!pads.length) { $("diagnostic-content").textContent = "接続されたコントローラーはありません。"; return; }
  $("diagnostic-content").innerHTML = `<div class="diagnostic-grid">${pads.map((pad) => `<div class="diagnostic-device"><strong>${escapeHtml(deviceLabel(pad))}</strong><div>ボタン: ${pad.buttons.map((button, i) => button.pressed ? i : null).filter((i) => i !== null).join(", ") || "なし"}</div><div>軸: ${pad.axes.map((axis, i) => `${i}: ${axis.toFixed(3)}`).join(" / ") || "なし"}</div></div>`).join("")}</div>`;
}
function frame(now) {
  const pads = currentPads();
  reconcileDevices(pads);
  if (!document.hidden) {
    for (const side of activeSides()) {
      const index = state.assigned[side];
      const pad = pads.find((item) => item.index === index);
      if (pad && (state.mode !== "dp" || state.assigned["1p"] !== state.assigned["2p"])) processPad(side, pad, now);
      else state.runtime[side] = null;
    }
  }
  updateHighlights();
  updateNotice(pads);
  if (now - state.lastDiagnosticAt >= 100 || !pads.length) { updateDiagnostics(pads); state.lastDiagnosticAt = now; }
  requestAnimationFrame(frame);
}

restore();
for (const [id, profile] of Object.entries(PROFILES)) $("profile").add(new Option(profile.label, id));
$("profile").value = state.profile;
$("mode").value = state.mode;
$("mode").addEventListener("change", (event) => {
  state.mode = event.target.value;
  state.runtime = { "1p": null, "2p": null };
  if (state.mode === "dp" && state.assigned["1p"] === state.assigned["2p"]) {
    state.assigned["2p"] = state.devices.find((pad) => pad.index !== state.assigned["1p"])?.index ?? null;
  } else if (state.mode === "2p" && state.assigned["2p"] === null && state.devices[0]) {
    state.assigned["2p"] = state.devices[0].index;
  }
  updateDeviceOptions();
  renderDecks(); scheduleSave();
});
$("profile").addEventListener("change", (event) => {
  state.profile = event.target.value;
  state.runtime = { "1p": null, "2p": null };
  scheduleSave();
});
$("device-1p").addEventListener("change", (event) => setAssignment("1p", event.target.value));
$("device-2p").addEventListener("change", (event) => setAssignment("2p", event.target.value));
$("reset").addEventListener("click", () => {
  state.counts = { "1p": emptyCounts(), "2p": emptyCounts() };
  updateTotals(); save();
});
document.addEventListener("visibilitychange", () => {
  state.runtime = { "1p": null, "2p": null };
  updateHighlights();
  if (document.hidden) save();
});
window.addEventListener("pagehide", save);
updateDeviceOptions(); renderDecks(); updateTotals(); requestAnimationFrame(frame);
