import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import LoginForm from "../src/components/LoginForm";

describe("LoginForm", () => {
  it("submits the entered credentials", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<LoginForm onSubmit={onSubmit} isSubmitting={false} errorMessage={null} />);

    await userEvent.type(screen.getByLabelText("Username"), "admin");
    await userEvent.type(screen.getByLabelText("Password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onSubmit).toHaveBeenCalledWith("admin", "secret");
  });

  it("renders a server error message", () => {
    render(<LoginForm onSubmit={vi.fn()} isSubmitting={false} errorMessage="Bad login" />);
    expect(screen.getByText("Bad login")).toBeInTheDocument();
  });

  it("disables the button while submitting", () => {
    render(<LoginForm onSubmit={vi.fn()} isSubmitting errorMessage={null} />);
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
  });
});
