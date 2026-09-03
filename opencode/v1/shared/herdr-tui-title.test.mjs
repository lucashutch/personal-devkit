import assert from "node:assert/strict";
import test from "node:test";

import { createTitleSync, selectedRootSession } from "./herdr-tui-title.js";

function harness() {
  const renamed = [];
  return { renamed, syncTitle: createTitleSync(async (title) => renamed.push(title)) };
}

function api(route, sessions = {}) {
  return { route: { current: route }, state: { session: { get: (id) => sessions[id] } } };
}

test("only a root session route owns the tab", () => {
  const sessions = {
    root: { id: "root", title: "Root" },
    child: { id: "child", parentID: "root", title: "Child" },
  };
  assert.deepEqual(selectedRootSession(api({ name: "session", params: { sessionID: "root" } }, sessions)), {
    sessionID: "root",
    title: "Root",
  });
  assert.equal(selectedRootSession(api({ name: "session", params: { sessionID: "child" } }, sessions)), undefined);
  assert.equal(selectedRootSession(api({ name: "session", params: { sessionID: "gone" } }, sessions)), undefined);
  assert.equal(selectedRootSession(api({ name: "home" }, sessions)), undefined);
});

test("a title is sent once per change", async () => {
  const { renamed, syncTitle } = harness();
  for (let poll = 0; poll < 3; poll += 1) await syncTitle({ sessionID: "root", title: "Root" });
  await syncTitle({ sessionID: "root", title: "Renamed" });
  await syncTitle({ sessionID: "root", title: "Renamed" });
  assert.deepEqual(renamed, ["Root", "Renamed"]);
});

test("switching session picks up the new title, including a repeat of an old one", async () => {
  const { renamed, syncTitle } = harness();
  await syncTitle({ sessionID: "a", title: "First" });
  await syncTitle({ sessionID: "b", title: "Second" });
  await syncTitle({ sessionID: "a", title: "First" });
  assert.deepEqual(renamed, ["First", "Second", "First"]);
});

test("a session with no title yet leaves the label alone until the title lands", async () => {
  const { renamed, syncTitle } = harness();
  await syncTitle({ sessionID: "a", title: "First" });
  await syncTitle({ sessionID: "b" });
  await syncTitle({ sessionID: "b" });
  assert.deepEqual(renamed, ["First"]);
  await syncTitle({ sessionID: "b", title: "Second" });
  assert.deepEqual(renamed, ["First", "Second"]);
});

test("leaving the session route clears the tracked selection", async () => {
  const { renamed, syncTitle } = harness();
  await syncTitle({ sessionID: "a", title: "First" });
  await syncTitle(undefined);
  await syncTitle({ sessionID: "a", title: "First" });
  assert.deepEqual(renamed, ["First", "First"]);
});
