import { options, render } from "preact";
import { expect, it } from "vitest";
import { OverflowMenu } from "../src/shared/ui/OverflowMenu";

it("restores trigger focus when Escape arrives before passive opening effects", async () => {
  const previousScheduler = options.requestAnimationFrame;
  // Hold passive effects until the next render, matching a fast Escape before paint.
  options.requestAnimationFrame = () => {};
  const host = document.createElement("div");
  document.body.append(host);
  try {
    render(
      <OverflowMenu
        name="Activity"
        items={[{ label: "Edit", onSelect() {} }]}
      />,
      host,
    );
    const trigger = host.querySelector<HTMLButtonElement>(".overflow-trigger")!;
    trigger.focus();
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  } finally {
    render(null, host);
    host.remove();
    options.requestAnimationFrame = previousScheduler;
  }
});
