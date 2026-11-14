import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "./ui/Button";

type Props = { thai: boolean };

export function PwaUpdate({ thai }: Props) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const requestUpdate = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
      return;

    let active = true;
    let registration: ServiceWorkerRegistration | undefined;
    let requested = false;
    const tracked = new Map<ServiceWorker, () => void>();
    const cleanup: Array<() => void> = [];

    const observe = (worker: ServiceWorker | null) => {
      if (!worker || tracked.has(worker)) return;
      const check = () => {
        if (!active) return;
        if (worker.state === "installed" && registration?.active) {
          setWaiting(worker);
          setUpdating(false);
        } else if (worker.state === "activated") {
          setWaiting(null);
        }
      };
      worker.addEventListener("statechange", check);
      tracked.set(worker, () =>
        worker.removeEventListener("statechange", check),
      );
      check();
    };

    const attach = (reg: ServiceWorkerRegistration) => {
      if (!active) return;
      if (registration === reg) return;
      registration = reg;
      observe(reg.waiting);
      observe(reg.installing);
      const updateFound = () => observe(reg.installing);
      reg.addEventListener("updatefound", updateFound);
      cleanup.push(() => reg.removeEventListener("updatefound", updateFound));
    };

    const controllerChanged = () => {
      if (requested) window.location.reload();
    };
    const checkForUpdate = () => {
      if (registration) void registration.update().catch(() => {});
    };
    requestUpdate.current = () => {
      requested = true;
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      controllerChanged,
    );
    window.addEventListener("focus", checkForUpdate);
    window.addEventListener("online", checkForUpdate);

    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (reg) attach(reg);
        return navigator.serviceWorker.ready;
      })
      .then(attach)
      .catch(() => {});

    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        controllerChanged,
      );
      window.removeEventListener("focus", checkForUpdate);
      window.removeEventListener("online", checkForUpdate);
      tracked.forEach((cleanup) => cleanup());
      cleanup.forEach((remove) => remove());
      requestUpdate.current = null;
    };
  }, []);

  if (!waiting) return null;

  return (
    <aside class="notice pwa-update-notice" role="status" aria-live="polite">
      <span>
        {thai
          ? "บันทึกการเปลี่ยนแปลงก่อนอัปเดต"
          : "Save changes before updating"}
      </span>
      <Button
        type="button"
        size="small"
        loading={updating}
        onClick={() => {
          setUpdating(true);
          requestUpdate.current?.();
          waiting.postMessage({ type: "SKIP_WAITING" });
        }}
      >
        {thai ? "อัปเดตแอป" : "Update app"}
      </Button>
    </aside>
  );
}
