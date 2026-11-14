import assert from "node:assert/strict";
import test from "node:test";
import { CONVERSATION_SERVER_URL, wakeConversationServer } from "../src/lib/conversationServer.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("same-origin hosting never knocks", () => {
  let calls = 0;
  assert.equal(CONVERSATION_SERVER_URL, "", "without VITE_ROOM_SERVER_URL the server is the page's own origin");
  assert.equal(wakeConversationServer("", () => { calls += 1; }), false);
  assert.equal(wakeConversationServer(undefined, () => { calls += 1; }), false);
  assert.equal(calls, 0);
});

test("a server hosted elsewhere gets one quiet knock on its health endpoint", async () => {
  const calls = [];
  assert.equal(wakeConversationServer("https://rooms.example/", (url, options) => { calls.push([url, options]); return Promise.resolve(); }), true);
  await settle();
  assert.deepEqual(calls, [["https://rooms.example/api/health", { mode: "no-cors", cache: "no-store" }]]);
});

test("a failed knock never reaches the page", async () => {
  assert.equal(wakeConversationServer("https://rooms.example", () => { throw new Error("offline"); }), true);
  assert.equal(wakeConversationServer("https://rooms.example", () => Promise.reject(new Error("asleep"))), true);
  assert.equal(wakeConversationServer("https://rooms.example", null), false);
  await settle();
});
