/** Focus and bring a newly revealed editor into view without focusing an input. */
export function revealEditor(element: HTMLElement | null) {
  if (!element) return;
  if (!element.hasAttribute("tabindex")) element.tabIndex = -1;
  element.focus({ preventScroll: true });
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView?.({
    block: "start",
    behavior: reduceMotion ? "auto" : "smooth",
  });
}
