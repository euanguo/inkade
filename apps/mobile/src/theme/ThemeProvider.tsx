import type {
  MobileAccentPreset,
  MobileMotionProfile,
  MobilePaperMode,
  MobileReaderFont,
  MobileReaderFontSize,
  MobileTypesetPreset,
} from "@inkade/core";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";
import { readKvString, writeKvString } from "../storage/kv.ts";
import { buildMobileTheme, type MobileTheme, type SurfacePreference } from "./tokens.ts";

const KV_SURFACE = "inkade:mobile:surface";
const KV_ACCENT = "inkade:mobile:accent";
const KV_PAPER = "inkade:mobile:paper";
const KV_FONT = "inkade:mobile:reader-font";
const KV_FONT_SIZE = "inkade:mobile:reader-font-size";
const KV_TYPESET = "inkade:mobile:typeset";
const KV_MOTION_PROFILE = "inkade:mobile:motion-profile";

function readSurfacePref(): SurfacePreference {
  const raw = readKvString(KV_SURFACE);
  if (
    raw === "system" ||
    raw === "light" ||
    raw === "light-dimmed" ||
    raw === "dark" ||
    raw === "dark-dimmed"
  ) {
    return raw;
  }
  return "system";
}

function readAccentPref(): MobileAccentPreset {
  const raw = readKvString(KV_ACCENT);
  if (raw === "indigo" || raw === "sage" || raw === "terracotta" || raw === "mono") {
    return raw;
  }
  return "mono";
}

function readPaperPref(): MobilePaperMode {
  return readKvString(KV_PAPER) === "sepia" ? "sepia" : "default";
}

function readFontPref(): MobileReaderFont {
  return readKvString(KV_FONT) === "serif" ? "serif" : "sans";
}

function readFontSizePref(): MobileReaderFontSize {
  const raw = readKvString(KV_FONT_SIZE);
  if (raw === "sm" || raw === "base" || raw === "lg") return raw;
  return "base";
}

function readTypesetPref(): MobileTypesetPreset {
  const raw = readKvString(KV_TYPESET);
  if (raw === "compact" || raw === "standard" || raw === "relaxed") return raw;
  return "standard";
}

function readMotionProfilePref(): MobileMotionProfile {
  return readKvString(KV_MOTION_PROFILE) === "reduced-pulse" ? "reduced-pulse" : "comfort";
}

export interface MobileThemeContextValue {
  readonly theme: MobileTheme;
  readonly systemReduceMotion: boolean;
  setSurfacePreference: (next: SurfacePreference) => void;
  setAccentPreset: (next: MobileAccentPreset) => void;
  setPaperMode: (next: MobilePaperMode) => void;
  setReaderFont: (next: MobileReaderFont) => void;
  setFontSize: (next: MobileReaderFontSize) => void;
  setTypesetPreset: (next: MobileTypesetPreset) => void;
  setMotionProfile: (next: MobileMotionProfile) => void;
}

const MobileThemeContext = createContext<MobileThemeContextValue | null>(null);

export function InkadeMobileThemeProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<SurfacePreference>(readSurfacePref);
  const [accentPreset, setAccentState] = useState<MobileAccentPreset>(readAccentPref);
  const [paperMode, setPaperState] = useState<MobilePaperMode>(readPaperPref);
  const [readerFont, setFontState] = useState<MobileReaderFont>(readFontPref);
  const [fontSize, setFontSizeState] = useState<MobileReaderFontSize>(readFontSizePref);
  const [typesetPreset, setTypesetState] = useState<MobileTypesetPreset>(readTypesetPref);
  const [motionProfile, setMotionProfileState] =
    useState<MobileMotionProfile>(readMotionProfilePref);
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setSystemReduceMotion(enabled);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      setSystemReduceMotion(enabled);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  const theme = useMemo(
    () =>
      buildMobileTheme({
        preference,
        systemScheme,
        accentPreset,
        paperMode,
        readerFont,
        fontSize,
        typesetPreset,
        motionProfile,
        systemReduceMotion,
      }),
    [
      preference,
      systemScheme,
      accentPreset,
      paperMode,
      readerFont,
      fontSize,
      typesetPreset,
      motionProfile,
      systemReduceMotion,
    ],
  );

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.colors.ground).catch(() => {});
  }, [theme.colors.ground]);

  const setSurfacePreference = useCallback((next: SurfacePreference) => {
    writeKvString(KV_SURFACE, next);
    setPreferenceState(next);
  }, []);

  const setAccentPreset = useCallback((next: MobileAccentPreset) => {
    writeKvString(KV_ACCENT, next);
    setAccentState(next);
  }, []);

  const setPaperMode = useCallback((next: MobilePaperMode) => {
    writeKvString(KV_PAPER, next);
    setPaperState(next);
  }, []);

  const setReaderFont = useCallback((next: MobileReaderFont) => {
    writeKvString(KV_FONT, next);
    setFontState(next);
  }, []);

  const setFontSize = useCallback((next: MobileReaderFontSize) => {
    writeKvString(KV_FONT_SIZE, next);
    setFontSizeState(next);
  }, []);

  const setTypesetPreset = useCallback((next: MobileTypesetPreset) => {
    writeKvString(KV_TYPESET, next);
    setTypesetState(next);
  }, []);

  const setMotionProfile = useCallback((next: MobileMotionProfile) => {
    writeKvString(KV_MOTION_PROFILE, next);
    setMotionProfileState(next);
  }, []);

  const value = useMemo<MobileThemeContextValue>(
    () => ({
      theme,
      systemReduceMotion,
      setSurfacePreference,
      setAccentPreset,
      setPaperMode,
      setReaderFont,
      setFontSize,
      setTypesetPreset,
      setMotionProfile,
    }),
    [
      theme,
      systemReduceMotion,
      setSurfacePreference,
      setAccentPreset,
      setPaperMode,
      setReaderFont,
      setFontSize,
      setTypesetPreset,
      setMotionProfile,
    ],
  );

  return React.createElement(
    MobileThemeContext.Provider,
    { value },
    React.createElement(StatusBar, { style: theme.isDark ? "light" : "dark" }),
    children,
  );
}

export function useMobileTheme(): MobileThemeContextValue {
  const ctx = useContext(MobileThemeContext);
  if (!ctx) {
    throw new Error("useMobileTheme must be used inside InkadeMobileThemeProvider");
  }
  return ctx;
}
