import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "./Button";
import { ActionIcon } from "../ActionIcon";

export type OverflowMenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
};

/** Compact, keyboard-operable action menu for a single itinerary record. */
export function OverflowMenu({
  name,
  label,
  items,
}: {
  name: string;
  label?: string;
  items: OverflowMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusIndex = useRef(0);
  const close = (restore = false) => {
    setOpen(false);
    if (restore)
      (
        root.current?.querySelector(
          ".overflow-trigger",
        ) as HTMLButtonElement | null
      )?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    const menuItems = menu.current?.querySelectorAll<HTMLButtonElement>("button");
    menuItems?.[focusIndex.current]?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab") {
      close();
      return;
    }
    const buttons = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      focusIndex.current = event.key === "ArrowUp" ? items.length - 1 : 0;
      setOpen(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      buttons[
        (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) %
          buttons.length
      ]?.focus();
    }
    if (event.key === "Home") {
      event.preventDefault();
      buttons[0]?.focus();
    }
    if (event.key === "End") {
      event.preventDefault();
      buttons.at(-1)?.focus();
    }
  };
  return (
    <div class="overflow-menu" ref={root}>
      <Button
        type="button"
        svgOnly
        appearance="tertiary"
        class="overflow-trigger"
        aria-label={label ?? `Options for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={onKeyDown}
        onClick={() => setOpen(!open)}
      >
        <ActionIcon kind="ellipsis" />
      </Button>
      {open && (
        <div
          class="overflow-panel"
          role="menu"
          tabIndex={-1}
          ref={menu}
          onKeyDown={onKeyDown}
        >
          {items.map((item) => (
            <Button
              type="button"
              appearance="tertiary"
              role="menuitem"
              class={`overflow-menu-item ${item.danger ? "danger" : ""}`}
              key={item.label}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
