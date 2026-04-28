import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import JsonPreview from "../JsonPreview";

describe("JsonPreview", () => {
  it("renders structured_data as formatted JSON", () => {
    render(<JsonPreview structuredData={{ a: 1, b: "x" }} version={2} />);
    const pre = screen.getByText(/"a": 1/);
    expect(pre).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
  });

  it("shows placeholder when data is null", () => {
    render(<JsonPreview structuredData={null} version={null} />);
    expect(screen.getByText(/尚无 predict 结果/)).toBeInTheDocument();
  });
});
