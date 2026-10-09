import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaRoute } from "../src/lib/mediaRoute.js";

function report(local = "host", remote = "srflx", prefix = "") {
  const entries = [
    { id: `${prefix}transport`, type: "transport", dtlsState: "connected", selectedCandidatePairId: `${prefix}pair` },
    { id: `${prefix}pair`, type: "candidate-pair", state: "succeeded", localCandidateId: `${prefix}local`, remoteCandidateId: `${prefix}remote` },
    { id: `${prefix}local`, type: "local-candidate", candidateType: local, address: "203.0.113.1", port: 1234, url: "turn:example.invalid" },
    { id: `${prefix}remote`, type: "remote-candidate", candidateType: remote, address: "198.51.100.1", port: 2345 },
  ];
  return new Map(entries.map((entry) => [entry.id, entry]));
}

test("selected local or remote relay is reported without candidate details", () => {
  assert.equal(mediaRoute(report("relay", "host")), "relay");
  assert.equal(mediaRoute(report("host", "relay")), "relay");
  assert.equal(mediaRoute(report("relay", "relay")), "relay");
});

test("selected host/server-reflexive/peer-reflexive paths are direct", () => {
  for (const local of ["host", "srflx", "prflx"]) {
    for (const remote of ["host", "srflx", "prflx"]) assert.equal(mediaRoute(report(local, remote)), "direct");
  }
});

test("unselected successful or nominated relay pairs do not prove relay use", () => {
  const stats = report();
  for (const [id, entry] of report("relay", "host", "old-")) if (entry.type !== "transport") stats.set(id, { ...entry, nominated: true });
  assert.equal(mediaRoute(stats), "direct");
  stats.get("transport").selectedCandidatePairId = "old-pair";
  assert.equal(mediaRoute(stats), "relay");
});

test("multiple selected transports are conservatively reported as mixed", () => {
  assert.equal(mediaRoute(new Map([...report(), ...report("relay", "host", "video-")])), "mixed");
  assert.equal(mediaRoute(new Map([...report("relay"), ...report("host", "relay", "video-")])), "relay");
});

test("missing selected-pair or candidate references remain unknown", () => {
  for (const id of ["pair", "local", "remote"]) {
    const stats = report(); stats.delete(id); assert.equal(mediaRoute(stats), "unknown");
  }
  const stats = report(); delete stats.get("transport").selectedCandidatePairId;
  stats.get("pair").nominated = true;
  assert.equal(mediaRoute(stats), "unknown");
  assert.equal(mediaRoute(new Map([["pair", { id: "pair", type: "candidate-pair", selected: true, state: "succeeded" }]])), "unknown");
});

test("incomplete, disconnected or failed reports never claim a working route", () => {
  for (const state of ["failed", "disconnected", "connecting"]) {
    const stats = report(); stats.get("transport").dtlsState = state; assert.equal(mediaRoute(stats), "unknown");
  }
  for (const state of ["waiting", "in-progress", "failed", undefined]) {
    const stats = report(); stats.get("pair").state = state; assert.equal(mediaRoute(stats), "unknown");
  }
  const stats = report("relay"); stats.get("remote").candidateType = "other";
  assert.equal(mediaRoute(stats), "unknown");
  const partial = new Map([...report("relay"), ...report("host", "host", "second-")]);
  partial.delete("second-remote"); assert.equal(mediaRoute(partial), "unknown");
});

test("unsupported statistics stay unknown and valid inputs are not modified", () => {
  for (const stats of [null, undefined, {}, new Map()]) assert.equal(mediaRoute(stats), "unknown");
  const stats = report(); const before = structuredClone(stats);
  assert.equal(mediaRoute(stats), "direct"); assert.deepEqual(stats, before);
});
