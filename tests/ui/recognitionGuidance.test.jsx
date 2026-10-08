import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import WordVocabularyHelp from "../../src/components/WordVocabularyHelp.jsx";
import SignRecognitionDetails from "../../src/components/SignRecognitionDetails.jsx";

afterEach(cleanup);
const isl = { signLanguage: "isl", labels: ["HELLO", "THANK YOU", "HOUSE"] };
const asl = { signLanguage: "asl", labels: ["DRINK", "HELP", "MOTHER"] };
const lookup = (word) => fireEvent.change(screen.getByLabelText("Find a word in this model"), { target: { value: word } });
const status = () => screen.getByLabelText("Word vocabulary check").textContent;

test("vocabulary checks distinguish DRINK support between the actual ISL and ASL artifacts", () => {
  const app = render(<WordVocabularyHelp model={isl} signLanguage="isl" />);
  lookup("DRINK"); expect(status()).toMatch(/not in this ISL model.*cannot return/);
  expect(screen.getByText("Loaded ISL word model")).toBeTruthy();
  app.rerender(<WordVocabularyHelp key="asl" model={asl} signLanguage="asl" />);
  expect(screen.getByLabelText("Find a word in this model").value).toBe("");
  lookup(" drink "); expect(status()).toMatch(/^DRINK is in this ASL/);
  expect(status()).toMatch(/may reject or misread/);
  lookup("HELLO"); expect(status()).toMatch(/not in this ASL/);
  expect(isl.labels).toEqual(["HELLO", "THANK YOU", "HOUSE"]); expect(asl.labels).toEqual(["DRINK", "HELP", "MOTHER"]);
});

test("lookup normalizes whitespace and case without converting an unsupported word to a label", () => {
  render(<WordVocabularyHelp model={isl} signLanguage="isl" />);
  lookup("thank   you"); expect(status()).toMatch(/^THANK YOU is in this ISL/);
  lookup("STOP"); expect(status()).toMatch(/STOP is not in this ISL/);
  expect(screen.getByText(/search checks vocabulary only/)).toBeTruthy();
});

test("a missing or foreign-language artifact cannot claim loaded vocabulary", () => {
  const app = render(<WordVocabularyHelp model={null} signLanguage="asl" />);
  expect(screen.queryByLabelText("Loaded word vocabulary")).toBeNull();
  app.rerender(<WordVocabularyHelp model={isl} signLanguage="asl" />);
  expect(screen.queryByLabelText("Loaded word vocabulary")).toBeNull();
});

test("early quality rejection never presents the compatibility score0 as measured confidence", () => {
  render(<SignRecognitionDetails result={{ score: 0, status: "no_sign", diagnostics: { inferenceRan: false,
    reasonCodes: ["no-hands"], model: { signLanguage: "asl", threshold: .98, requiredMargin: .3 },
    capture: { inputFrames: 8, handFrames: 0, shoulderFrames: 8 }, posterior: null } }} />);
  expect(screen.getByText(/No model confidence was measured/)).toBeTruthy();
  expect(screen.getByText(/No visible hand measurements/)).toBeTruthy();
  expect(screen.queryByText("Top model score")).toBeNull(); expect(screen.queryByText("0.000%")).toBeNull();
});

test("posterior rejections explain score and separation failures without calling them accuracy", () => {
  render(<SignRecognitionDetails result={{ status: "unclear", diagnostics: { inferenceRan: true,
    reasonCodes: ["low-score", "small-margin"], model: { signLanguage: "asl", threshold: .98, requiredMargin: .3 },
    capture: { inputFrames: 12, handFrames: 10, shoulderFrames: 12 },
    posterior: { topLabel: "MOTHER", topScore: .42, runnerUpLabel: "DRINK", runnerUpScore: .35, margin: .07 } } }} />);
  expect(screen.getByText(/below its required score/)).toBeTruthy(); expect(screen.getByText(/too close/)).toBeTruthy();
  expect(screen.getByText("42.000%")).toBeTruthy(); expect(screen.getByText("98.000%")).toBeTruthy();
  expect(screen.getByText("7.000%")).toBeTruthy(); expect(screen.getByText("30.000%")).toBeTruthy();
  expect(screen.getByText(/not accuracy percentages/)).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Download recognition report" })).toBeTruthy();
});

test("unknown diagnostics remain unavailable instead of fabricated numeric measurements", () => {
  render(<SignRecognitionDetails result={{ diagnostics: { inferenceRan: true, reasonCodes: [], model: {},
    capture: { inputFrames: NaN, handFrames: -1, shoulderFrames: undefined },
    posterior: { topLabel: "DRINK", runnerUpLabel: "HELP", topScore: NaN, margin: -1 } } }} />);
  expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(3);
  expect(screen.queryByText(/NaN%/)).toBeNull();
});
