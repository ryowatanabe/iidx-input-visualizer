"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createHarness() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", parentElement: {}, classList: { toggle() {} },
      replaceChildren() { this.options = []; },
      add(option) { this.options.push(option); }
    });
    return elements.get(id);
  };
  const source = fs.readFileSync("app.js", "utf8").split("\nrestore();")[0];
  const context = {
    document: { getElementById: element, querySelector: () => null },
    Option: function (text, value) { this.text = text; this.value = value; },
    localStorage: { setItem() {} },
    setTimeout: () => 1,
    clearTimeout() {},
    performance: { now: () => 0 }
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.harness = { state, profile: PROFILES.konami_iidx, axisDelta, processScratch, processPad, updateTotals, openPopup, swapAssignments };`, context);
  return { ...context.harness, element };
}

test("鍵盤とターンテーブルの内訳に加えて総合計を表示する", () => {
  const h = createHarness();
  h.state.counts["1p"].keys = [1000, 200, 30, 4, 0, 0, 0];
  h.state.counts["1p"].scratch = 50;
  h.state.counts["2p"].scratch = 16;
  h.updateTotals();
  assert.equal(h.element("key-total").textContent, "1,234");
  assert.equal(h.element("scratch-total").textContent, "66");
  assert.equal(h.element("grand-total").textContent, "1,300");
});

test("別窓は固定名を再利用せず800x500で開く", () => {
  const h = createHarness();
  let received;
  h.openPopup((...args) => { received = args; });
  assert.equal(received[0], "https://ryowatanabe.github.io/iidx-input-visualizer/");
  assert.equal(received[1], "_blank");
  assert.match(received[2], /(?:^|,)width=800(?:,|$)/);
  assert.match(received[2], /(?:^|,)height=500(?:,|$)/);
});

test("各表示モードで1P/2Pの割り当てと表示を交換し、カウントを保持する", () => {
  for (const mode of ["1p", "2p", "dp"]) {
    const h = createHarness();
    h.state.mode = mode;
    h.state.devices = [{ index: 2, id: "left" }, { index: 5, id: "right" }];
    h.state.assigned = { "1p": 2, "2p": 5 };
    h.state.runtime = { "1p": { active: true }, "2p": { active: true } };
    h.state.counts["1p"].keys[0] = 12;
    h.state.counts["2p"].scratch = 34;
    h.swapAssignments();
    assert.equal(h.state.assigned["1p"], 5);
    assert.equal(h.state.assigned["2p"], 2);
    assert.equal(h.element("device-1p").value, "5");
    assert.equal(h.element("device-2p").value, "2");
    assert.match(h.element("decks").innerHTML, mode === "2p" ? /#2 left/ : /#5 right/);
    assert.equal(h.state.runtime["1p"], null);
    assert.equal(h.state.runtime["2p"], null);
    assert.equal(h.state.counts["1p"].keys[0], 12);
    assert.equal(h.state.counts["2p"].scratch, 34);
    h.swapAssignments();
    assert.equal(h.state.assigned["1p"], 2);
    assert.equal(h.state.assigned["2p"], 5);
  }
});

test("未選択や同じコントローラーの割り当ても安全に交換する", () => {
  for (const [first, second] of [[null, null], [2, null], [null, 2], [2, 2]]) {
    const h = createHarness();
    h.state.devices = [{ index: 2, id: "test" }];
    h.state.assigned = { "1p": first, "2p": second };
    h.swapAssignments();
    assert.equal(h.state.assigned["1p"], second);
    assert.equal(h.state.assigned["2p"], first);
  }
});

test("鍵盤は押下開始だけ数え、長押しと初回の押下状態は数えない", () => {
  const h = createHarness();
  const pad = { index: 0, id: "test", buttons: Array.from({ length: 7 }, () => ({ pressed: false })), axes: [0] };
  pad.buttons[0].pressed = true;
  h.processPad("1p", pad, 0);
  assert.equal(h.state.counts["1p"].keys[0], 0);
  h.processPad("1p", pad, 16);
  assert.equal(h.state.counts["1p"].keys[0], 0);
  pad.buttons[0].pressed = false;
  h.processPad("1p", pad, 32);
  pad.buttons[0].pressed = true;
  h.processPad("1p", pad, 48);
  assert.equal(h.state.counts["1p"].keys[0], 1);
});

test("X軸の折り返しは同じ方向の小さな移動として扱う", () => {
  const h = createHarness();
  assert.ok(Math.abs(h.axisDelta(0.98, -0.98, h.profile) - 0.04) < 1e-9);
  assert.ok(Math.abs(h.axisDelta(-0.98, 0.98, h.profile) + 0.04) < 1e-9);
});

test("回転開始と方向転換を数え、停止後の再開も数える", () => {
  const h = createHarness();
  const pad = { axes: [0] };
  const runtime = { axis: 0, lastSample: 0, motionAt: 0, direction: 0, pendingDirection: 0, pendingDistance: 0, active: false };
  pad.axes[0] = 0.04;
  h.processScratch("1p", runtime, pad, 16, h.profile);
  assert.equal(h.state.counts["1p"].scratch, 1);
  pad.axes[0] = -0.02;
  h.processScratch("1p", runtime, pad, 32, h.profile);
  assert.equal(h.state.counts["1p"].scratch, 2);
  h.processScratch("1p", runtime, pad, 200, h.profile);
  assert.equal(runtime.active, false);
  pad.axes[0] = -0.07;
  h.processScratch("1p", runtime, pad, 216, h.profile);
  assert.equal(h.state.counts["1p"].scratch, 3);
});

test("X軸の最小刻み0.008で回転開始と方向転換をそれぞれ数える", () => {
  const h = createHarness();
  const pad = { axes: [0] };
  const runtime = { axis: 0, lastSample: 0, motionAt: 0, direction: 0, pendingDirection: 0, pendingDistance: 0, active: false };
  pad.axes[0] = 0.008;
  h.processScratch("1p", runtime, pad, 16, h.profile);
  assert.equal(h.state.counts["1p"].scratch, 1);
  pad.axes[0] = 0;
  h.processScratch("1p", runtime, pad, 32, h.profile);
  assert.equal(h.state.counts["1p"].scratch, 2);
});
