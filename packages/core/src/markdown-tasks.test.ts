import { describe, expect, test } from "bun:test";
import {
  appendMarkdownTaskLine,
  extractMarkdownTasks,
  updateMarkdownTaskLine,
} from "./markdown-tasks.ts";

describe("markdown GFM task AST extractor and surgical updater", () => {
  test("ignores fenced code blocks, indented code blocks, and inline code metadata", () => {
    const markdown = [
      "# Project Notes",
      "",
      "```markdown",
      "- [ ] Fake task inside fenced block 📅2026-12-01 !p1",
      "```",
      "",
      "    - [ ] Indented code sample",
      "",
      "- [ ] Inspect `!p1 📅2026-12-01` token parsing 📅2026-11-26 ⏰14:00-15:30 ⏳2026-11-28 !p2",
      "- [x] Buy milk",
    ].join("\n");

    const tasks = extractMarkdownTasks(markdown);
    expect(tasks).toHaveLength(2);

    expect(tasks[0]).toMatchObject({
      lineIndex: 8,
      completed: false,
      title: "Inspect !p1 📅2026-12-01 token parsing",
      priority: "p2",
      scheduledDate: "2026-11-26",
      scheduledStartMin: 14 * 60,
      durationMin: 90,
      dueDate: "2026-11-28",
    });

    expect(tasks[1]).toMatchObject({
      lineIndex: 9,
      completed: true,
      title: "Buy milk",
      priority: null,
      scheduledDate: null,
      scheduledStartMin: null,
      durationMin: null,
      dueDate: null,
    });
  });

  test("preserves clean Markdown without redundant metadata and keeps non-task lines byte-identical", () => {
    const markdown = [
      "# Reading Log",
      "",
      "Paragraph with   exact spacing.",
      "- [ ] Clean plain task",
      "- [ ] Nested child check",
      "  - [ ] Sub-item [link](https://example.com) 📅2026-11-27",
      "",
      "Footer note.",
    ].join("\n");

    const firstPass = updateMarkdownTaskLine(markdown, { lineIndex: 3 }, { completed: true });
    expect(firstPass).not.toBeNull();
    expect(firstPass!.markdown.split("\n")[3]).toBe("- [x] Clean plain task");
    expect(firstPass!.markdown.split("\n")[2]).toBe("Paragraph with   exact spacing.");
    expect(firstPass!.markdown.split("\n")[7]).toBe("Footer note.");

    const secondPass = updateMarkdownTaskLine(
      firstPass!.markdown,
      { lineIndex: 5 },
      { scheduledStartMin: 9 * 60, durationMin: 45, dueDate: "2026-11-30" },
    );
    expect(secondPass).not.toBeNull();
    expect(secondPass!.markdown.split("\n")[5]).toBe(
      "  - [ ] Sub-item [link](https://example.com) 📅2026-11-27 ⏰09:00-09:45 ⏳2026-11-30",
    );
  });

  test("appends clean GFM tasks and preserves CRLF line endings", () => {
    const crlf = "# Spec\r\n\r\n- [ ] Existing\r\n";
    const appended = appendMarkdownTaskLine(crlf, {
      title: "Ship Phase 41",
      scheduledDate: "2026-11-26",
      scheduledStartMin: 600,
      durationMin: 60,
      priority: "p1",
    });
    expect(appended.markdown).toBe(
      "# Spec\r\n\r\n- [ ] Existing\r\n- [ ] Ship Phase 41 📅2026-11-26 ⏰10:00-11:00 !p1\r\n",
    );
    expect(appended.createdTask.title).toBe("Ship Phase 41");
  });
});
