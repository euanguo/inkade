import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export async function triggerSelectionHaptic(enabled: boolean): Promise<void> {
  if (!enabled) return;
  try {
    if (Platform.OS === "android") {
      await Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click);
      return;
    }
    await Haptics.selectionAsync();
  } catch {
    // Ignore unsupported hardware/simulator haptics errors
  }
}

export async function triggerImpactHaptic(
  enabled: boolean,
  style: "light" | "medium" = "light",
): Promise<void> {
  if (!enabled) return;
  try {
    if (Platform.OS === "android") {
      await Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick);
      return;
    }
    await Haptics.impactAsync(
      style === "medium"
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light,
    );
  } catch {
    // Ignore
  }
}

export async function triggerOutcomeHaptic(
  enabled: boolean,
  outcome: "success" | "warning" | "error",
): Promise<void> {
  if (!enabled) return;
  try {
    if (Platform.OS === "android") {
      await Haptics.performAndroidHapticsAsync(
        outcome === "error" ? Haptics.AndroidHaptics.Reject : Haptics.AndroidHaptics.Confirm,
      );
      return;
    }
    const type =
      outcome === "success"
        ? Haptics.NotificationFeedbackType.Success
        : outcome === "warning"
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Error;
    await Haptics.notificationAsync(type);
  } catch {
    // Ignore
  }
}
