"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createHarness() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: "" });
    return elements.get(id);
  };
  const source = fs.readFileSync("app.js", "utf8").split("\nrestore();")[0];
  const context = {
    document: { getElementById: element },
    localStorage: { setItem() {} },
    setTimeout: () => 1,
    clearTimeout() {},
    performance: { now: () => 0 }
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.harness = { state, profile: PROFILES.konami_iidx, axisDelta, processScratch, processPad };`, context);
  return context.harness;
}

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
