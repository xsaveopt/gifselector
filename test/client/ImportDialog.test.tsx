import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ImportDialog from "../../src/client/components/ImportDialog";

function renderDialog(overrides: Partial<Parameters<typeof ImportDialog>[0]> = {}) {
  return render(
    <ImportDialog
      onClose={vi.fn()}
      onImport={vi.fn(async () => ({ successes: 1, failures: 0 }))}
      {...overrides}
    />,
  );
}

describe("ImportDialog", () => {
  it("lists the suggested sources", () => {
    renderDialog();
    expect(
      screen.getByText(/tenor\.com, giphy\.com, klipy\.com, imgur\.com, discord\.com/),
    ).toBeInTheDocument();
  });

  it("keeps the import button disabled until a url is typed", async () => {
    renderDialog();
    const button = screen.getByRole("button", { name: "Import" });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Import URLs"), "https://tenor.com/view/a");
    expect(button).toBeEnabled();
  });

  it("splits the textarea into one url per line and drops blanks", async () => {
    const onImport = vi.fn(async () => ({ successes: 2, failures: 0 }));
    renderDialog({ onImport });

    await userEvent.type(
      screen.getByLabelText("Import URLs"),
      "  https://tenor.com/view/a  \n\n https://giphy.com/gifs/b ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(onImport).toHaveBeenCalledWith(["https://tenor.com/view/a", "https://giphy.com/gifs/b"]);
  });

  it("reports a clean run and clears the textarea", async () => {
    renderDialog({ onImport: vi.fn(async () => ({ successes: 2, failures: 0 })) });

    await userEvent.type(screen.getByLabelText("Import URLs"), "https://tenor.com/view/a");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByText("Imported 2 items.")).toBeInTheDocument();
    expect(screen.getByLabelText("Import URLs")).toHaveValue("");
  });

  it("uses the singular for a single import", async () => {
    renderDialog({ onImport: vi.fn(async () => ({ successes: 1, failures: 0 })) });

    await userEvent.type(screen.getByLabelText("Import URLs"), "https://tenor.com/view/a");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByText("Imported 1 item.")).toBeInTheDocument();
  });

  it("reports how many were skipped and keeps the text when nothing succeeded", async () => {
    renderDialog({ onImport: vi.fn(async () => ({ successes: 0, failures: 2 })) });

    await userEvent.type(screen.getByLabelText("Import URLs"), "https://tenor.com/view/a");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByText("Imported 0, skipped 2.")).toBeInTheDocument();
    expect(screen.getByLabelText("Import URLs")).toHaveValue("https://tenor.com/view/a");
  });

  it("reports a rejected import", async () => {
    renderDialog({
      onImport: vi.fn(async () => {
        throw new Error("network down");
      }),
    });

    await userEvent.type(screen.getByLabelText("Import URLs"), "https://tenor.com/view/a");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByText("Import failed.")).toBeInTheDocument();
  });

  it("does nothing when the textarea holds only whitespace", async () => {
    const onImport = vi.fn(async () => ({ successes: 0, failures: 0 }));
    renderDialog({ onImport });

    await userEvent.type(screen.getByLabelText("Import URLs"), "   ");
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("closes from the footer button", async () => {
    const onClose = vi.fn();
    const { container } = renderDialog({ onClose });
    const footer = container.querySelector(".modal-foot") as HTMLElement;
    await userEvent.click(within(footer).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
