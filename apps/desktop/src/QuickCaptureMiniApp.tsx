import { asSpaceId, todayLocalDateString, type Space, type SpaceId } from "@inkade/core";
import {
  InkadeI18nProvider,
  setInkadeLocale,
  useInkadeLocale,
  useInkadeTranslation,
} from "@inkade/i18n";
import { createInkadeClient } from "@inkade/sdk";
import {
  CalendarPlus,
  Globe,
  Languages,
  Send,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_QUICK_CAPTURE_SHORTCUT,
  toggleQuickCaptureWindow,
} from "./bridge.ts";

export type QuickCaptureMode = "note" | "clip-url" | "daily";

const STORAGE_KEYS = {
  serverUrl: "inkade:desktop:serverUrl",
  token: "inkade:desktop:token",
  spaceId: "inkade:desktop:spaceId",
} as const;

function readStorage(key: string, fallback = ""): string {
  if (typeof globalThis.localStorage === "undefined") return fallback;
  try {
    return globalThis.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,，]/)) {
    const cleaned = part.trim().replace(/^#+/, "");
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  return out;
}

function isHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  return /^https?:\/\/\S+$/i.test(trimmed);
}

export function QuickCaptureMiniView() {
  const { t } = useInkadeTranslation();
  const { locale, setLocale } = useInkadeLocale();

  const [serverUrl, setServerUrl] = useState(() =>
    readStorage(STORAGE_KEYS.serverUrl, "http://127.0.0.1:4100"),
  );
  const [token, setToken] = useState(() => readStorage(STORAGE_KEYS.token, ""));
  const [spaceId, setSpaceId] = useState<SpaceId | "">(() => {
    const raw = readStorage(STORAGE_KEYS.spaceId, "").trim();
    return raw ? asSpaceId(raw) : "";
  });
  const [spaces, setSpaces] = useState<readonly Space[]>([]);
  const [showSettings, setShowSettings] = useState(() => !readStorage(STORAGE_KEYS.token, ""));

  const [mode, setMode] = useState<QuickCaptureMode>("note");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagsCsv, setTagsCsv] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{
    readonly kind: "success" | "error";
    readonly text: string;
  } | null>(null);

  const client = useMemo(
    () =>
      createInkadeClient({
        baseUrl: serverUrl.trim().replace(/\/+$/, "") || "http://127.0.0.1:4100",
        token: token.trim(),
      }),
    [serverUrl, token],
  );

  useEffect(() => {
    if (!serverUrl.trim() || !token.trim()) return;
    void (async () => {
      try {
        const whoami = await client.auth.whoami();
        const visible = whoami.visibleSpaces.filter((s) => s.archivedAt === null);
        setSpaces(visible);
        if (!spaceId && visible[0]) {
          const inbox = visible.find((s) => s.slug === "inbox") ?? visible[0];
          setSpaceId(inbox.id);
          writeStorage(STORAGE_KEYS.spaceId, inbox.id);
        }
      } catch {
        // leave offline/unconfigured state cleanly
      }
    })();
  }, [client, serverUrl, token, spaceId]);

  useEffect(() => {
    if (isHttpUrl(content) && mode === "note") {
      setMode("clip-url");
    }
  }, [content, mode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void toggleQuickCaptureWindow(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSaveConnection = () => {
    const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
    const cleanToken = token.trim();
    writeStorage(STORAGE_KEYS.serverUrl, cleanUrl);
    writeStorage(STORAGE_KEYS.token, cleanToken);
    writeStorage(STORAGE_KEYS.spaceId, spaceId);
    setShowSettings(false);
    setStatus({ kind: "success", text: t("desktop.connectionSaved") });
  };

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const rawContent = content.trim();
    if (!rawContent || submitting) return;

    if (!serverUrl.trim() || !token.trim()) {
      setShowSettings(true);
      setStatus({ kind: "error", text: t("desktop.connectionNotSet") });
      return;
    }

    setSubmitting(true);
    setStatus(null);
    const tags = parseTags(tagsCsv);

    try {
      if (mode === "clip-url") {
        const resolvedSpaceId = spaceId || undefined;
        const res = await client.clips.ingestUrl({
          url: rawContent,
          ...(resolvedSpaceId ? { spaceId: resolvedSpaceId } : {}),
          ...(title.trim() ? { title: title.trim() } : {}),
          tags,
        });
        setStatus({
          kind: "success",
          text: t("desktop.captureSuccessDoc", { title: res.document.title }),
        });
      } else if (mode === "daily") {
        const daily = await client.documents.getDaily(todayLocalDateString());
        await client.outlineNodes.create({
          documentId: daily.document.id,
          contentMarkdown: rawContent,
        });
        setStatus({
          kind: "success",
          text: t("desktop.captureSuccessDaily"),
        });
      } else {
        const targetSpaceId = spaceId || spaces[0]?.id;
        if (!targetSpaceId) {
          throw new Error(t("desktop.connectionNotSet"));
        }
        const inferredTitle =
          title.trim() ||
          rawContent.split(/\r?\n/)[0]?.replace(/^#+\s*/, "").slice(0, 80) ||
          t("common.untitled");
        const doc = await client.documents.create({
          spaceId: targetSpaceId,
          kind: "clip",
          title: inferredTitle,
          contentMarkdown: rawContent,
          tags,
        });
        setStatus({
          kind: "success",
          text: t("desktop.captureSuccessDoc", { title: doc.title }),
        });
      }

      setTitle("");
      setContent("");
      setTagsCsv("");
    } catch (error) {
      setStatus({
        kind: "error",
        text: t("desktop.captureFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleLocale = () => {
    const next = locale === "zh-CN" ? "en-US" : "zh-CN";
    setInkadeLocale(next);
    setLocale(next);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0e1015",
        color: "#eef0f6",
        fontFamily: '"Inter", "PingFang SC", "Noto Sans SC", system-ui, sans-serif',
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxSizing: "border-box",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 7,
              background: "#4f46e5",
              color: "#ffffff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Sparkles size={13} />
          </span>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("desktop.quickCaptureTitle")}</div>
            <div style={{ fontSize: 11, color: "#9499ab" }}>
              {t("desktop.shortcutHint", { shortcut: DEFAULT_QUICK_CAPTURE_SHORTCUT })}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={handleToggleLocale}
            style={iconButtonStyle}
            title={t("desktop.languageToggle")}
            type="button"
          >
            <Languages size={14} />
          </button>
          <button
            onClick={() => setShowSettings((prev) => !prev)}
            style={iconButtonStyle}
            title={t("desktop.configureConnection")}
            type="button"
          >
            <Settings2 size={14} />
          </button>
          <button
            onClick={() => void toggleQuickCaptureWindow(false)}
            style={iconButtonStyle}
            title={t("desktop.closeWindow")}
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {showSettings ? (
        <section
          style={{
            background: "#171b24",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 8,
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <label style={labelStyle}>
            <span>{t("desktop.serverUrlLabel")}</span>
            <input
              onChange={(e) => setServerUrl(e.target.value)}
              style={inputStyle}
              type="url"
              value={serverUrl}
            />
          </label>
          <label style={labelStyle}>
            <span>{t("desktop.tokenLabel")}</span>
            <input
              onChange={(e) => setToken(e.target.value)}
              style={inputStyle}
              type="password"
              value={token}
            />
          </label>
          <button onClick={handleSaveConnection} style={primaryButtonStyle} type="button">
            {t("desktop.saveConnection")}
          </button>
        </section>
      ) : null}

      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => setMode("note")}
          style={modePillStyle(mode === "note")}
          type="button"
        >
          <Sparkles size={12} />
          <span>{t("desktop.modeNote")}</span>
        </button>
        <button
          onClick={() => setMode("clip-url")}
          style={modePillStyle(mode === "clip-url")}
          type="button"
        >
          <Globe size={12} />
          <span>{t("desktop.modeClipUrl")}</span>
        </button>
        <button
          onClick={() => setMode("daily")}
          style={modePillStyle(mode === "daily")}
          type="button"
        >
          <CalendarPlus size={12} />
          <span>{t("desktop.modeDaily")}</span>
        </button>
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}
      >
        {mode !== "daily" ? (
          <input
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("desktop.titlePlaceholder")}
            style={inputStyle}
            type="text"
            value={title}
          />
        ) : null}

        <textarea
          aria-label={t("desktop.contentLabel")}
          autoFocus
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder={t("desktop.contentPlaceholder")}
          rows={4}
          style={{
            ...inputStyle,
            resize: "none",
            minHeight: 88,
            flex: 1,
          }}
          value={content}
        />

        {mode !== "daily" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <select
              aria-label={t("desktop.spaceLabel")}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const next: SpaceId | "" = raw ? asSpaceId(raw) : "";
                setSpaceId(next);
                writeStorage(STORAGE_KEYS.spaceId, next);
              }}
              style={{ ...inputStyle, flex: 1 }}
              value={spaceId}
            >
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
            <input
              onChange={(e) => setTagsCsv(e.target.value)}
              placeholder={t("desktop.tagsPlaceholder")}
              style={{ ...inputStyle, flex: 1 }}
              type="text"
              value={tagsCsv}
            />
          </div>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#9499ab" }}>
            {t("desktop.quickCaptureSubtitle")}
          </span>
          <button
            disabled={submitting || !content.trim()}
            style={primaryButtonStyle}
            type="submit"
          >
            <Send size={13} />
            <span>
              {submitting ? t("desktop.submittingCapture") : t("desktop.submitCapture")}
            </span>
          </button>
        </div>
      </form>

      {status ? (
        <div
          style={{
            borderRadius: 7,
            padding: "7px 10px",
            fontSize: 12,
            background:
              status.kind === "success"
                ? "rgba(74, 222, 128, 0.14)"
                : "rgba(248, 113, 113, 0.14)",
            color: status.kind === "success" ? "#4ade80" : "#f87171",
          }}
        >
          {status.text}
        </div>
      ) : null}
    </div>
  );
}

export function QuickCaptureMiniApp() {
  return (
    <InkadeI18nProvider>
      <QuickCaptureMiniView />
    </InkadeI18nProvider>
  );
}

const iconButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 6,
  borderRadius: 7,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "#171b24",
  color: "#eef0f6",
  cursor: "pointer",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11.5,
  color: "#9499ab",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: 7,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "#171b24",
  color: "#eef0f6",
  padding: "7px 9px",
  fontSize: 12.5,
  fontFamily: "inherit",
  outline: "none",
};

const primaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  borderRadius: 7,
  border: "none",
  background: "#4f46e5",
  color: "#ffffff",
  padding: "7px 12px",
  fontSize: 12.5,
  fontWeight: 500,
  cursor: "pointer",
};

function modePillStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 7,
    border: active ? "1px solid #818cf8" : "1px solid rgba(255,255,255,0.09)",
    background: active ? "rgba(129, 140, 248, 0.16)" : "#171b24",
    color: active ? "#c7d2fe" : "#9499ab",
    padding: "5px 8px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  };
}
