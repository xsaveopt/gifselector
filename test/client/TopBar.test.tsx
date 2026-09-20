import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TopBar from "../../src/client/components/TopBar";

function renderBar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  return render(
    <TopBar
      session={{ authenticated: true, username: "admin" }}
      readOnly={false}
      search=""
      onSearch={vi.fn()}
      onUpload={vi.fn()}
      onImport={vi.fn()}
      onManageCategories={vi.fn()}
      onLogout={vi.fn()}
      {...overrides}
    />,
  );
}

describe("TopBar", () => {
  it("shows the brand and the admin actions", () => {
    renderBar();
    expect(screen.getByText("gifselector")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Categories/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upload/ })).toBeInTheDocument();
    expect(screen.queryByText("public")).toBeNull();
  });

  it("types into the search box", async () => {
    const onSearch = vi.fn();
    renderBar({ onSearch });
    await userEvent.type(screen.getByLabelText("Search gifs"), "ca");
    expect(onSearch).toHaveBeenCalledTimes(2);
    expect(onSearch).toHaveBeenLastCalledWith("a");
  });

  it("shows the current search value", () => {
    renderBar({ search: "cat" });
    expect(screen.getByLabelText("Search gifs")).toHaveValue("cat");
  });

  it("fires each action", async () => {
    const onUpload = vi.fn();
    const onImport = vi.fn();
    const onManageCategories = vi.fn();
    const onLogout = vi.fn();
    renderBar({ onUpload, onImport, onManageCategories, onLogout });

    await userEvent.click(screen.getByRole("button", { name: /Categories/ }));
    await userEvent.click(screen.getByRole("button", { name: /Import/ }));
    await userEvent.click(screen.getByRole("button", { name: /Upload/ }));
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(onManageCategories).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("names the signed in user on the logout button", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "Log out" })).toHaveAttribute(
      "title",
      "Log out admin",
    );
  });

  it("falls back to a plain logout title without a username", () => {
    renderBar({ session: { authenticated: true } });
    expect(screen.getByRole("button", { name: "Log out" })).toHaveAttribute("title", "Log out");
  });

  it("hides the search box and every action in read-only mode", () => {
    renderBar({ readOnly: true });
    expect(screen.getByText("public")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search gifs")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
