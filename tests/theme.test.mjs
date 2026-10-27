import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../web/theme.js", import.meta.url), "utf8");
function clock(hour) {
  const root = { dataset: {}, style: {} };
  const events = {};
  let currentHour = hour, refresh, changes = 0;
  vm.runInNewContext(source, {
    Date: class { getHours() { return currentHour; } },
    Event: class { constructor(type) { this.type = type; } },
    document: { documentElement: root, addEventListener: (name, fn) => { events[name] = fn; } },
    window: { dispatchEvent: () => { changes++; }, addEventListener: (name, fn) => { events[name] = fn; } },
    setInterval: (fn, delay) => { assert.equal(delay, 60000); refresh = fn; },
  });
  return { root, events, refresh: () => refresh(), setHour: hour => { currentHour = hour; }, changes: () => changes };
}

test("local time selects night from 19:00 until 07:00", () => {
  for (const [hour, theme] of [[0,"dark"],[6,"dark"],[7,"light"],[12,"light"],[18,"light"],[19,"dark"],[23,"dark"]]) {
    const state = clock(hour);
    assert.equal(state.root.dataset.theme, theme);
    assert.equal(state.root.style.colorScheme, theme);
  }
});

test("open pages update on the clock boundary, focus and tab visibility", () => {
  const state = clock(18);
  state.setHour(19); state.refresh();
  assert.equal(state.root.dataset.theme, "dark");
  state.refresh();
  assert.equal(state.changes(), 2);
  state.setHour(7); state.events.focus();
  assert.equal(state.root.dataset.theme, "light");
  state.setHour(23); state.events.visibilitychange();
  assert.equal(state.root.dataset.theme, "dark");
});
