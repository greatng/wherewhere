import type { JSX } from "preact";

export function ActionIcon({
  kind,
  class: className,
}: {
  kind: "add" | "edit" | "remove" | "save" | "cancel" | "ellipsis";
  class?: string;
}) {
  const common: JSX.SVGAttributes<SVGSVGElement> = {
    "aria-hidden": true,
    focusable: "false",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    class: className ?? "action-icon",
  };

  if (kind === "add") {
    return (
      <svg {...common}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }

  if (kind === "edit") {
    return (
      <svg {...common}>
        <path d="m15 5 4 4M4 20l4.2-.8L19 8.4 15.6 5 4.8 15.8 4 20Z" />
      </svg>
    );
  }

  if (kind === "save") {
    return (
      <svg {...common}>
        <path d="m5 12 4 4L19 6" />
      </svg>
    );
  }

  if (kind === "cancel") {
    return (
      <svg {...common}>
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    );
  }

  if (kind === "ellipsis") {
    return (
      <svg {...common}>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" />
    </svg>
  );
}
