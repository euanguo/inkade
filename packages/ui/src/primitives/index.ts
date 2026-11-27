// Lightweight @inkade/ui primitives entry point for browser extensions and thin hosts.
// Keeps TipTap, Mermaid, Shiki, Yjs, and d3-force out of the extension bundle graph.

export {
  INKADE_BREAKPOINTS,
  INKADE_MEDIA_QUERIES,
} from "../lib/breakpoints.ts";
export { cn } from "../lib/utils.ts";
export {
  Badge,
  type BadgeProps,
  badgeVariants,
} from "./badge.tsx";
export {
  BucketMeter,
  type BucketMeterComputedSegment,
  type BucketMeterLayout,
  type BucketMeterProps,
  type BucketMeterSegment,
  type BucketMeterTone,
  type BucketMeterWarningLevel,
  computeBucketMeterLayout,
} from "./bucket-meter.tsx";
export {
  Button,
  type ButtonProps,
  buttonVariants,
} from "./button.tsx";
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardFrame,
  CardFrameAction,
  CardFrameDescription,
  CardFrameFooter,
  CardFrameHeader,
  CardFrameTitle,
  CardHeader,
  CardPanel,
  CardTitle,
} from "./card.tsx";
export { Checkbox, CheckboxPrimitive } from "./checkbox.tsx";
export {
  ClipCoverThumbnail,
  type ClipCoverThumbnailProps,
  ClipFavicon,
  type ClipFaviconProps,
} from "./clip-media.tsx";
export { CopyButton, type CopyButtonProps } from "./copy-button.tsx";
export {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldItem,
  FieldLabel,
  FieldPrimitive,
  FieldValidity,
} from "./field.tsx";
export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from "./form.tsx";
export {
  computeGlideRect,
  GlideHighlight,
  type GlideHighlightProps,
  type GlideRect,
} from "./glide-highlight.tsx";
export {
  GridDisclosure,
  type GridDisclosureProps,
} from "./grid-disclosure.tsx";
export {
  ALMOST_READY_THRESHOLD,
  advanceHoldProgress,
  DEFAULT_HOLD_DURATION_MS,
  HoldConfirmButton,
  type HoldConfirmButtonProps,
  type HoldConfirmSize,
} from "./hold-confirm-button.tsx";
export { Input, InputPrimitive, type InputProps } from "./input.tsx";
export { Kbd, KbdGroup } from "./kbd.tsx";
export {
  formatTickerValue,
  interpolateTickerValue,
  NumberTicker,
  type NumberTickerProps,
  RollingDigits,
  type RollingDigitsProps,
} from "./number-ticker.tsx";
export {
  clampScrubValue,
  ScrubInput,
  type ScrubInputProps,
} from "./scrub-input.tsx";
export {
  computeOpticalFadeOpacities,
  type OpticalFadeTone,
  ScrollArea,
  ScrollAreaPrimitive,
  ScrollBar,
} from "./scroll-area.tsx";
export {
  SegmentedControl,
  SegmentedControlItem,
  type SegmentedControlSize,
  segmentedControlIndicatorSurfaceClassName,
  segmentedControlItemLayoutClassName,
  segmentedControlItemSizeClassNames,
} from "./segmented-control.tsx";
export {
  Select,
  SelectButton,
  type SelectButtonProps,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectLabel,
  SelectPopup,
  SelectPrimitive,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  selectTriggerIconClassName,
  selectTriggerVariants,
} from "./select.tsx";
export { Separator, SeparatorPrimitive } from "./separator.tsx";
export { Skeleton } from "./skeleton.tsx";
export {
  getSpaceColorToken,
  isEmojiIcon,
  resolveSpaceIconComponent,
  SPACE_COLOR_NAMES,
  SPACE_COLOR_PALETTE,
  SPACE_ICON_NAMES,
  SPACE_ICON_REGISTRY,
  SpaceColorBadge,
  type SpaceColorBadgeProps,
  type SpaceColorName,
  type SpaceColorToken,
  SpaceIcon,
  type SpaceIconName,
  SpaceIconPicker,
  type SpaceIconPickerProps,
  type SpaceIconProps,
  type SpaceIconSize,
  type SpaceIconTone,
} from "./space-icon.tsx";
export { Spinner } from "./spinner.tsx";
export {
  splitStreamTail,
  StreamText,
  type StreamTextProps,
} from "./stream-text.tsx";
export { Switch, SwitchPrimitive } from "./switch.tsx";
export {
  Tabs,
  TabsContent,
  TabsList,
  TabsPanel,
  TabsPrimitive,
  TabsTab,
  TabsTrigger,
  type TabsSize,
  type TabsVariant,
} from "./tabs.tsx";
export {
  computeVisibleTagCount,
  TagList,
  type TagListProps,
} from "./tag-list.tsx";
export {
  AdePlatformBadge,
  type AdePlatformBadgeProps,
  DocumentKindIcon,
  type DocumentKindIconProps,
  getTagColor,
  getTagIconName,
  normalizeTagName,
  type TagConName,
  TagPill,
  type TagPillProps,
} from "./tag-pill.tsx";
export { Textarea, type TextareaProps } from "./textarea.tsx";
export {
  computeElapsedSecondsFromIso,
  formatElapsedTimer,
  getThinkingDotDelayStep,
  ThinkingIndicator,
  type ThinkingIndicatorProps,
  type ThinkingIndicatorSize,
} from "./thinking-indicator.tsx";
