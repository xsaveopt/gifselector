import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import UploadDropzone from "../src/components/UploadDropzone";

describe("UploadDropzone", () => {
  it("uploads a chosen file through the hidden input", async () => {
    const onUpload = vi.fn(async (_file: File) => {});
    const { container } = render(
      <UploadDropzone onUpload={onUpload} isUploading={false} errorMessage={null} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["gif"], "cat.gif", { type: "image/gif" });

    await userEvent.upload(input, file);

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0]).toBeInstanceOf(File);
  });

  it("shows the uploading state", () => {
    render(<UploadDropzone onUpload={vi.fn()} isUploading errorMessage={null} />);
    expect(screen.getByText("Uploading…")).toBeInTheDocument();
  });

  it("shows an error message", () => {
    render(<UploadDropzone onUpload={vi.fn()} isUploading={false} errorMessage="Too big" />);
    expect(screen.getByText("Too big")).toBeInTheDocument();
  });
});
