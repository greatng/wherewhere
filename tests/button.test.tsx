import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../src/shared/ui/Button";

describe("Button", () => {
  it("submits its form by default and keeps explicit button type", () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    const onClick = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <Button onClick={onClick}>Save</Button>
        <Button type="button">Cancel</Button>
      </form>,
    );

    const save = screen.getByRole("button", { name: "Save" });
    expect(save.getAttribute("type")).toBe("submit");
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("type")).toBe("button");
  });

  it("disables while loading and does not invoke the click handler", () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Working</Button>);
    const button = screen.getByRole("button", { name: "Working" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
