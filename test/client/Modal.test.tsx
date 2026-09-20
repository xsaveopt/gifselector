import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Modal from "../../src/client/components/Modal";

describe("Modal", () => {
  it("renders its title and children in a labelled dialog", () => {
    render(
      <Modal title="Import from URLs" onClose={vi.fn()}>
        <p>body text</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Import from URLs");
    expect(screen.getByText("body text")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Import from URLs" })).toBeInTheDocument();
  });

  it("defaults to the small size and honours a large one", () => {
    const { unmount } = render(
      <Modal title="Small" onClose={vi.fn()}>
        <p>a</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveClass("modal--small");
    unmount();

    render(
      <Modal title="Large" onClose={vi.fn()} size="large">
        <p>a</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveClass("modal--large");
  });

  it("closes on the close button", async () => {
    const onClose = vi.fn();
    render(
      <Modal title="Title" onClose={onClose}>
        <p>a</p>
      </Modal>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on escape", async () => {
    const onClose = vi.fn();
    render(
      <Modal title="Title" onClose={onClose}>
        <p>a</p>
      </Modal>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", async () => {
    const onClose = vi.fn();
    render(
      <Modal title="Title" onClose={onClose}>
        <p>a</p>
      </Modal>,
    );
    await userEvent.keyboard("{Enter}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on a backdrop press but not on a press inside the dialog", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal title="Title" onClose={onClose}>
        <p>inside</p>
      </Modal>,
    );

    await userEvent.click(screen.getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(container.querySelector(".modal-backdrop") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks body scrolling while it is open", () => {
    const { unmount } = render(
      <Modal title="Title" onClose={vi.fn()}>
        <p>a</p>
      </Modal>,
    );
    expect(document.body).toHaveClass("modal-open");
    unmount();
    expect(document.body).not.toHaveClass("modal-open");
  });

  it("stops listening for escape once it is gone", async () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Modal title="Title" onClose={onClose}>
        <p>a</p>
      </Modal>,
    );
    unmount();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });
});
