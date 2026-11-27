import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { splitStreamTail, StreamText } from "./stream-text.tsx";

describe("stream-text", () => {
  it("splits settled prefix and blur tail safely across edge cases", () => {
    expect(splitStreamTail("", 6)).toEqual({ solid: "", tail: "" });
    expect(splitStreamTail("abcdef", 0)).toEqual({ solid: "abcdef", tail: "" });
    expect(splitStreamTail("hi", 6)).toEqual({ solid: "", tail: "hi" });
    expect(splitStreamTail("hello world", 5)).toEqual({
      solid: "hello ",
      tail: "world",
    });
  });

  it("renders blur tail and blinking caret during active streaming", () => {
    const html = renderToStaticMarkup(
      React.createElement(StreamText, {
        text: "Streaming answer",
        streaming: true,
        blurTail: 6,
      }),
    );

    expect(html).toContain('data-slot="stream-text"');
    expect(html).toContain('data-streaming="true"');
    expect(html).toContain("inkade-stream-tail");
    expect(html).toContain("inkade-caret-blink");
    expect(html).toContain("Streaming ");
    expect(html).toContain("answer");
  });

  it("renders settled plain text without tail or caret once streaming finishes", () => {
    const html = renderToStaticMarkup(
      React.createElement(StreamText, {
        text: "Final settled answer",
        streaming: false,
      }),
    );

    expect(html).toContain('data-streaming="false"');
    expect(html).not.toContain("inkade-stream-tail");
    expect(html).not.toContain("inkade-caret-blink");
    expect(html).toContain("Final settled answer");
  });
});
