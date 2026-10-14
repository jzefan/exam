import { expect, it, vi } from "vitest";

import { registerServiceWorker } from "./sw-update";

it("waits until the teacher leaves grading before applying a deployed update", async () => {
  const previousServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
  const previousPath = `${window.location.pathname}${window.location.search}`;
  const worker = {
    state: "installed",
    addEventListener: vi.fn(),
    postMessage: vi.fn(),
  } as unknown as ServiceWorker;
  const registration = {
    waiting: worker,
    installing: null,
    addEventListener: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  } as unknown as ServiceWorkerRegistration;
  const serviceWorker = {
    controller: worker,
    register: vi.fn().mockResolvedValue(registration),
  } as unknown as ServiceWorkerContainer;

  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
  const intervalSpy = vi.spyOn(window, "setInterval").mockReturnValue({} as ReturnType<typeof setInterval>);
  try {
    window.history.replaceState({}, "", "/grading?taskId=answer-1");
    registerServiceWorker();
    window.dispatchEvent(new Event("load"));
    await vi.waitFor(() => expect(registration.addEventListener).toHaveBeenCalledWith("updatefound", expect.any(Function)));
    expect(worker.postMessage).not.toHaveBeenCalled();

    window.history.replaceState({}, "", "/dashboard");
    window.dispatchEvent(new Event("focus"));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  } finally {
    intervalSpy.mockRestore();
    window.history.replaceState({}, "", previousPath);
    if (previousServiceWorker) Object.defineProperty(navigator, "serviceWorker", previousServiceWorker);
    else Reflect.deleteProperty(navigator, "serviceWorker");
  }
});
