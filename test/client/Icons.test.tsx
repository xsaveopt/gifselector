import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as Icons from "../../src/client/components/Icons";

const entries = Object.entries(Icons);

describe("Icons", () => {
  it.each(entries)("%s renders a stroked 24px-viewbox svg sized 20 by default", (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveAttribute("height", "20");
    expect(svg).toHaveAttribute("fill", "none");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg?.children.length).toBeGreaterThan(0);
  });

  it.each(entries)("%s lets the caller override size and add attributes", (_name, Icon) => {
    const { container } = render(<Icon width={14} height={16} aria-label="icon" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "14");
    expect(svg).toHaveAttribute("height", "16");
    expect(svg).toHaveAttribute("aria-label", "icon");
  });

  it("draws the logo with a lighter stroke than the other icons", () => {
    const logo = render(<Icons.LogoIcon />).container.querySelector("svg");
    const upload = render(<Icons.UploadIcon />).container.querySelector("svg");
    expect(logo).toHaveAttribute("stroke-width", "1.6");
    expect(upload).toHaveAttribute("stroke-width", "1.8");
  });
});
