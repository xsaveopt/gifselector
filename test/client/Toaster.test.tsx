import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Toaster from "../../src/client/components/Toaster";
import type { Toast } from "../../src/client/types";

const toasts: Toast[] = [
  { id: 1, kind: "success", message: "Uploaded" },
  { id: 2, kind: "error", message: "Import failed" },
];

describe("Toaster", () => {
  it("renders nothing when there are no toasts", () => {
    const { container } = render(<Toaster toasts={[]} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces each toast politely", () => {
    render(<Toaster toasts={toasts} onDismiss={vi.fn()} />);
    expect(screen.getByText("Uploaded").closest(".toaster")).toHaveAttribute("aria-live", "polite");
    expect(screen.getAllByRole("status")).toHaveLength(2);
  });

  it("carries the kind into the toast class", () => {
    render(<Toaster toasts={toasts} onDismiss={vi.fn()} />);
    expect(screen.getByText("Uploaded").closest(".toast")).toHaveClass("toast--success");
    expect(screen.getByText("Import failed").closest(".toast")).toHaveClass("toast--error");
  });

  it("dismisses the toast that was clicked", async () => {
    const onDismiss = vi.fn();
    render(<Toaster toasts={toasts} onDismiss={onDismiss} />);
    const buttons = screen.getAllByRole("button", { name: "Dismiss" });
    await userEvent.click(buttons[1]);
    expect(onDismiss).toHaveBeenCalledWith(2);
  });
});
