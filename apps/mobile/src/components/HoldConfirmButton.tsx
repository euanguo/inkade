import { useInkadeTranslation } from "@inkade/i18n";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { triggerImpactHaptic, triggerOutcomeHaptic, triggerSelectionHaptic } from "../lib/haptics.ts";
import {
  ALMOST_READY_THRESHOLD,
  DEFAULT_HOLD_DURATION_MS,
  advanceMobileHoldProgress,
} from "../lib/v35-primitives.ts";
import { useAppStore } from "../store/app-store.ts";
import { useMobileTheme } from "../theme/ThemeProvider.tsx";

export interface HoldConfirmButtonProps {
  readonly label: string;
  readonly holdingLabel?: string | undefined;
  readonly icon?: React.ReactNode;
  readonly holdDurationMs?: number | undefined;
  readonly disabled?: boolean | undefined;
  readonly onConfirm: () => void;
  readonly onCancel?: (() => void) | undefined;
  readonly accessibilityLabel?: string | undefined;
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * Neutral-resting destructive hold button with a 2px bottom fill rail, >=85% micro-shake,
 * and smooth 2.6x early-release drain aligned with V3.5 visual restraint.
 */
export function HoldConfirmButton({
  label,
  holdingLabel,
  icon,
  holdDurationMs = DEFAULT_HOLD_DURATION_MS,
  disabled = false,
  onConfirm,
  onCancel,
  accessibilityLabel,
  style,
}: HoldConfirmButtonProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { theme } = useMobileTheme();
  const hapticsEnabled = useAppStore((s) => s.hapticsEnabled);

  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);

  const progressRef = useRef(0);
  const modeRef = useRef<"idle" | "fill" | "drain">("idle");
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const confirmedRef = useRef(false);
  const almostHapticFiredRef = useRef(false);
  const shakeX = useRef(new Animated.Value(0)).current;

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = null;
    lastFrameRef.current = null;
  }, []);

  const updateProgress = useCallback((next: number) => {
    progressRef.current = next;
    setProgress(next);
  }, []);

  const stepFrame = useCallback(
    (now: number) => {
      const prevTime = lastFrameRef.current ?? now;
      lastFrameRef.current = now;
      const deltaMs = now - prevTime;
      const mode = modeRef.current;

      if (mode === "fill") {
        const next = advanceMobileHoldProgress(progressRef.current, deltaMs, holdDurationMs, "fill");
        updateProgress(next);

        if (next >= ALMOST_READY_THRESHOLD && !almostHapticFiredRef.current) {
          almostHapticFiredRef.current = true;
          void triggerImpactHaptic(hapticsEnabled, "medium");
        }

        if (next >= 1) {
          stopRaf();
          modeRef.current = "idle";
          setHolding(false);
          if (!confirmedRef.current) {
            confirmedRef.current = true;
            void triggerOutcomeHaptic(hapticsEnabled, "warning");
            onConfirm();
          }
          updateProgress(0);
          return;
        }
        rafRef.current = requestAnimationFrame(stepFrame);
        return;
      }

      if (mode === "drain") {
        const next = advanceMobileHoldProgress(progressRef.current, deltaMs, holdDurationMs, "drain");
        updateProgress(next);
        if (next <= 0) {
          stopRaf();
          modeRef.current = "idle";
          return;
        }
        rafRef.current = requestAnimationFrame(stepFrame);
      }
    },
    [hapticsEnabled, holdDurationMs, onConfirm, stopRaf, updateProgress],
  );

  const startHold = useCallback(() => {
    if (disabled || modeRef.current === "fill") return;
    confirmedRef.current = false;
    almostHapticFiredRef.current = false;
    modeRef.current = "fill";
    setHolding(true);
    void triggerSelectionHaptic(hapticsEnabled);
    stopRaf();
    if (typeof requestAnimationFrame === "function") {
      rafRef.current = requestAnimationFrame(stepFrame);
    }
  }, [disabled, hapticsEnabled, stepFrame, stopRaf]);

  const releaseHold = useCallback(() => {
    if (modeRef.current !== "fill") return;
    setHolding(false);
    const partial = progressRef.current > 0 && !confirmedRef.current;
    if (partial) {
      onCancel?.();
    }
    if (progressRef.current <= 0) {
      stopRaf();
      modeRef.current = "idle";
      return;
    }
    modeRef.current = "drain";
    stopRaf();
    if (typeof requestAnimationFrame === "function") {
      rafRef.current = requestAnimationFrame(stepFrame);
    } else {
      modeRef.current = "idle";
      updateProgress(0);
    }
  }, [onCancel, stepFrame, stopRaf, updateProgress]);

  useEffect(() => {
    return () => {
      stopRaf();
    };
  }, [stopRaf]);

  useEffect(() => {
    if (disabled && modeRef.current === "fill") {
      releaseHold();
    }
  }, [disabled, releaseHold]);

  const almostReady = holding && progress >= ALMOST_READY_THRESHOLD;

  useEffect(() => {
    if (!almostReady || theme.effectiveReducedMotion) {
      shakeX.stopAnimation();
      shakeX.setValue(0);
      return;
    }
    const linearEasing = (t: number): number => Easing.linear(t);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shakeX, {
          toValue: -1.5,
          duration: 30,
          easing: linearEasing,
          useNativeDriver: true,
        }),
        Animated.timing(shakeX, {
          toValue: 1.5,
          duration: 60,
          easing: linearEasing,
          useNativeDriver: true,
        }),
        Animated.timing(shakeX, {
          toValue: 0,
          duration: 30,
          easing: linearEasing,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      shakeX.setValue(0);
    };
  }, [almostReady, shakeX, theme.effectiveReducedMotion]);

  const visibleLabel = holding ? (holdingLabel ?? t("mobile.common.keepHolding")) : label;
  const fillWidth = `${Math.round(progress * 100)}%`;
  const resolvedAriaLabel = accessibilityLabel ?? label;

  return (
    <Animated.View style={{ transform: [{ translateX: shakeX }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={resolvedAriaLabel}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPressIn={startHold}
        onPressOut={releaseHold}
        style={[
          styles.button,
          {
            backgroundColor: theme.colors.card,
            borderColor: holding ? theme.colors.destructive : theme.colors.border,
            opacity: disabled ? 0.55 : 1,
          },
          style,
        ]}
      >
        <View
          pointerEvents="none"
          style={[
            styles.tintOverlay,
            {
              backgroundColor: theme.colors.destructive,
              opacity: progress > 0 ? Math.min(0.14, progress * 0.14) : 0,
            },
          ]}
        />
        <View style={styles.content}>
          {icon}
          <Text numberOfLines={1} style={[styles.label, { color: theme.colors.destructive }]}>
            {visibleLabel}
          </Text>
        </View>
        <View pointerEvents="none" style={[styles.railTrack, { backgroundColor: theme.colors.border }]}>
          <View
            style={[
              styles.railFill,
              {
                backgroundColor: theme.colors.destructive,
                width: fillWidth,
              },
            ]}
          />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "relative",
    overflow: "hidden",
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tintOverlay: {
    ...StyleSheet.absoluteFill,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  label: {
    fontSize: 13.5,
    fontWeight: "600",
    flexShrink: 1,
  },
  railTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
  },
  railFill: {
    height: "100%",
  },
});
