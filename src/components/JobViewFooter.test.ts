import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { JobViewFooter } from "./JobViewFooter";

describe("JobViewFooter", () => {
  it("renders read-only job notice and back to main thread button", () => {
    const onBack = vi.fn();
    const markup = renderToStaticMarkup(createElement(JobViewFooter, { onBackToMain: onBack }));
    expect(markup).toContain("data-testid=\"job-view-footer\"");
    expect(markup).toContain("Work view, read-only. Reply in your chat.");
    expect(markup).toContain("Back to your chat");

    const element = JobViewFooter({ onBackToMain: onBack }) as {
      props: { children: Array<{ type: string; props: { onClick?: () => void } }> };
    };
    element.props.children.find((child) => child.type === "button")!.props.onClick!();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
