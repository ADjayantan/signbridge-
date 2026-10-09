import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import TeachSigns from "../../src/modes/TeachSigns.jsx";
import { SignClassifier } from "../../src/lib/knn.js";
import { FEATURE_SIZE } from "../../src/lib/features.js";
import { gestureMap } from "../../src/lib/gestures.js";
afterEach(cleanup);
const setup = (signLanguage = "isl") => {
  const onReplace = vi.fn();
  render(<TeachSigns classifier={new SignClassifier()} version={0} onChange={() => {}} onReplace={onReplace} gestures={gestureMap()} onGestures={() => {}} recorderRef={{ current: null }} ready={false} handsVisible={0} signLanguage={signLanguage} />);
  return onReplace;
};
const importData = async (data) => {
  const file = { name: "signs.json", size: 100, text: async () => JSON.stringify(data) };
  await act(async () => fireEvent.change(screen.getByLabelText("Import taught signs"), { target: { files: [file] } }));
};

test("legacy ISL exports import valid training data into the current classifier", async () => {
  const onReplace = setup(); const incoming = new SignClassifier();
  const features = new Array(FEATURE_SIZE).fill(0); features[0] = 1;
  incoming.addSamples("water", [features]);
  await importData(incoming.toJSON());
  expect(onReplace).toHaveBeenCalledOnce(); expect(onReplace.mock.calls[0][0].labels()[0].label).toBe("WATER");
});

test("ASL training data cannot be accidentally imported into ISL", async () => {
  const onReplace = setup(); await importData({ ...new SignClassifier().toJSON(), signLanguage: "asl" });
  expect(onReplace).not.toHaveBeenCalled(); expect(screen.getByText(/These recordings belong to ASL/)).toBeTruthy();
});

test("malformed sign-language metadata reports a usable import error", async () => {
  const onReplace = setup(); await importData({ signLanguage: { code: "asl" } });
  expect(onReplace).not.toHaveBeenCalled(); expect(screen.getByText(/unsupported sign language/)).toBeTruthy();
});
