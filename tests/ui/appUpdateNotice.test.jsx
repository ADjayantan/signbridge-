import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AppUpdateNotice from "../../src/components/AppUpdateNotice.jsx";

const mock = vi.hoisted(() => ({
  waiting: false,
  offlineReady: false,
  options: null,
  update: vi.fn(),
  setWaiting: vi.fn(),
  setOfflineReady: vi.fn(),
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: (options) => {
    mock.options = options;
    return {
      needRefresh: [mock.waiting, mock.setWaiting],
      offlineReady: [mock.offlineReady, mock.setOfflineReady],
      updateServiceWorker: mock.update,
    };
  },
}));

const warning = "Finish your current turn and copy unsent text before updating";
const updateButton = () => screen.getByRole("button", { name: "Update and reload", exact: true });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};

function DraftBesideUpdate({ reloadPage }) {
  const [draft, setDraft] = useState("WATER PLEASE");
  return <>
    <label htmlFor="live-draft">Unsent message</label>
    <textarea id="live-draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    <AppUpdateNotice reloadPage={reloadPage} />
  </>;
}

beforeEach(() => {
  mock.waiting = false;
  mock.offlineReady = false;
  mock.options = null;
  mock.update.mockReset().mockResolvedValue(undefined);
  mock.setWaiting.mockReset().mockImplementation((waiting) => { mock.waiting = waiting; });
  mock.setOfflineReady.mockReset();
});
afterEach(cleanup);

test.each([false, true])("no waiting update means no notice or activation, including offlineReady=%s", (offlineReady) => {
  mock.offlineReady = offlineReady;
  const reloadPage = vi.fn();
  const { container, rerender } = render(<AppUpdateNotice reloadPage={reloadPage} />);
  expect(container.textContent).toBe("");
  expect(mock.options.immediate).toBe(true);
  expect(mock.options.onNeedReload).toEqual(expect.any(Function));
  expect(mock.options.onRegisterError).toEqual(expect.any(Function));
  rerender(<AppUpdateNotice reloadPage={reloadPage} />);
  act(() => mock.options.onNeedReload());
  expect(mock.update).not.toHaveBeenCalled();
  expect(reloadPage).not.toHaveBeenCalled();
});

test("a waiting update shows its warning but render and rerender never authorize activation", () => {
  mock.waiting = true;
  const reloadPage = vi.fn();
  const { rerender } = render(<AppUpdateNotice reloadPage={reloadPage} />);
  expect(screen.getByText(warning, { exact: false })).toBeTruthy();
  expect(updateButton().disabled).toBe(false);
  rerender(<AppUpdateNotice reloadPage={reloadPage} />);
  expect(mock.update).not.toHaveBeenCalled();
  expect(reloadPage).not.toHaveBeenCalled();
});

test("external activation clears the waiting notice without reloading or changing an editable draft", () => {
  mock.waiting = true;
  const reloadPage = vi.fn();
  const { rerender } = render(<DraftBesideUpdate reloadPage={reloadPage} />);
  const draft = screen.getByLabelText("Unsent message");
  fireEvent.change(draft, { target: { value: "Keep this reviewed sign message" } });
  act(() => mock.options.onNeedReload());
  expect(mock.setWaiting).toHaveBeenCalledWith(false);
  rerender(<DraftBesideUpdate reloadPage={reloadPage} />);
  expect(screen.queryByRole("button", { name: "Update and reload", exact: true })).toBeNull();
  expect(mock.update).not.toHaveBeenCalled();
  expect(reloadPage).not.toHaveBeenCalled();
  expect(draft.value).toBe("Keep this reviewed sign message");
  expect(draft.disabled).toBe(false);
  expect(draft.readOnly).toBe(false);
  fireEvent.change(draft, { target: { value: "Keep this reviewed sign message, please" } });
  expect(draft.value).toBe("Keep this reviewed sign message, please");
});

test("one explicit click activates the update, blocks duplicate clicks and authorizes the reload callback", async () => {
  mock.waiting = true;
  const pending = deferred(), reloadPage = vi.fn();
  mock.update.mockReturnValueOnce(pending.promise);
  render(<AppUpdateNotice reloadPage={reloadPage} />);
  const button = updateButton();
  fireEvent.click(button);
  expect(mock.update).toHaveBeenCalledExactlyOnceWith(true);
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(mock.update).toHaveBeenCalledOnce();
  expect(reloadPage).not.toHaveBeenCalled();
  act(() => mock.options.onNeedReload());
  expect(reloadPage).toHaveBeenCalledOnce();
  await act(async () => pending.resolve());
});

test("waiting and a failed update preserve an editable draft and permit retry", async () => {
  const pending = deferred(), reloadPage = vi.fn();
  mock.update.mockReturnValueOnce(pending.promise);
  const { rerender } = render(<DraftBesideUpdate reloadPage={reloadPage} />);
  const draft = screen.getByLabelText("Unsent message");
  fireEvent.change(draft, { target: { value: "WATER PLEASE, THEN HELP" } });
  mock.waiting = true;
  rerender(<DraftBesideUpdate reloadPage={reloadPage} />);
  expect(draft.value).toBe("WATER PLEASE, THEN HELP");
  expect(draft.disabled).toBe(false);
  expect(draft.readOnly).toBe(false);
  expect(mock.update).not.toHaveBeenCalled();
  fireEvent.change(draft, { target: { value: "WATER PLEASE, THEN HELP ME" } });
  fireEvent.click(updateButton());
  await act(async () => pending.reject(new Error("Update download unavailable")));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/try again|retry/i));
  expect(updateButton().disabled).toBe(false);
  expect(draft.value).toBe("WATER PLEASE, THEN HELP ME");
  expect(draft.disabled).toBe(false);
  expect(draft.readOnly).toBe(false);
  expect(reloadPage).not.toHaveBeenCalled();
  fireEvent.change(draft, { target: { value: "WATER PLEASE, THEN HELP ME NOW" } });
  expect(draft.value).toBe("WATER PLEASE, THEN HELP ME NOW");
  fireEvent.click(updateButton());
  expect(mock.update).toHaveBeenCalledTimes(2);
  expect(mock.update).toHaveBeenLastCalledWith(true);
  act(() => mock.options.onNeedReload());
  expect(reloadPage).toHaveBeenCalledOnce();
  await act(async () => {});
});

test("a late activation signal after update failure cannot use the failed action to reload", async () => {
  mock.waiting = true;
  const pending = deferred(), reloadPage = vi.fn();
  mock.update.mockReturnValueOnce(pending.promise);
  const { rerender } = render(<DraftBesideUpdate reloadPage={reloadPage} />);
  const draft = screen.getByLabelText("Unsent message");
  fireEvent.change(draft, { target: { value: "This unsent draft must survive" } });
  fireEvent.click(updateButton());
  await act(async () => pending.reject(new Error("Update download unavailable")));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  act(() => mock.options.onNeedReload());
  expect(reloadPage).not.toHaveBeenCalled();
  expect(mock.setWaiting).toHaveBeenCalledWith(false);
  rerender(<DraftBesideUpdate reloadPage={reloadPage} />);
  expect(screen.queryByRole("button", { name: "Update and reload", exact: true })).toBeNull();
  expect(draft.value).toBe("This unsent draft must survive");
  fireEvent.change(draft, { target: { value: "This unsent draft survived" } });
  expect(draft.value).toBe("This unsent draft survived");
});
