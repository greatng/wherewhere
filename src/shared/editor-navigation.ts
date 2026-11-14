/** Focus and bring a newly revealed editor into view without focusing an input. */
export function revealEditor(element: HTMLElement | null) {
  if (!element) return;
  if (!element.hasAttribute("tabindex")) element.tabIndex = -1;
  element.focus({ preventScroll: true });
  element.scrollIntoView?.({
    block: "start",
    // Immediate navigation avoids competing scroll animations when switching views.
    behavior: "instant",
  });
}
