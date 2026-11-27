import { useInkadeTranslation } from "@inkade/i18n";
import {
  Button,
  Card,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  GridDisclosure,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@inkade/ui/primitives";
import { Eye, EyeOff, PlugZap, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import type { ClipperAiProviderKind } from "../../shared/storage.ts";
import type { AiFormValues } from "./useOptionsController.ts";

export interface OptionsAiSectionProps {
  readonly form: UseFormReturn<AiFormValues>;
  readonly testingAi: boolean;
  readonly onProviderChange: (kind: ClipperAiProviderKind) => void;
  readonly onTestAi: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function OptionsAiSection({
  form,
  testingAi,
  onProviderChange,
  onTestAi,
  onSubmit,
}: OptionsAiSectionProps) {
  const { t } = useInkadeTranslation();
  const [showAiKey, setShowAiKey] = useState(false);

  const watchedAiEnabled = useWatch({ control: form.control, name: "aiEnabled" });
  const watchedAiKind = useWatch({ control: form.control, name: "aiKind" });
  const watchedAiModel = useWatch({ control: form.control, name: "aiModel" });
  const watchedAiApiKey = useWatch({ control: form.control, name: "aiApiKey" });

  const aiKindLabel =
    watchedAiKind === "anthropic"
      ? t("clipper.aiProviderAnthropic")
      : watchedAiKind === "gemini"
        ? t("clipper.aiProviderGemini")
        : t("clipper.aiProviderOpenAi");

  return (
    <Card className="gap-4 rounded-lg px-4 py-4">
      <form className="flex flex-col gap-3.5" noValidate onSubmit={onSubmit}>
        <Form {...form}>
          <h2 className="m-0 text-[13px] font-semibold text-foreground">
            {t("clipper.optionsSectionAi")}
          </h2>

          <FormField
            control={form.control}
            name="aiEnabled"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-3 rounded-md bg-muted/45 px-3 py-2">
                  <FormLabel
                    className="flex-1 cursor-pointer text-xs font-medium text-foreground"
                    htmlFor="opt-ai-enabled"
                  >
                    {t("clipper.aiEnabledToggle")}
                  </FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      id="opt-ai-enabled"
                      onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                    />
                  </FormControl>
                </div>
              </FormItem>
            )}
          />

          <GridDisclosure open={watchedAiEnabled}>
            <div className="flex flex-col gap-3.5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <FormField
                  control={form.control}
                  name="aiKind"
                  render={({ field }) => (
                    <FormItem className="w-full min-w-0">
                      <FormLabel className="text-xs text-muted-foreground" htmlFor="opt-ai-kind">
                        {t("clipper.aiProviderLabel")}
                      </FormLabel>
                      <FormControl>
                        <Select
                          onValueChange={(value) => {
                            if (
                              value === "openai-compatible" ||
                              value === "anthropic" ||
                              value === "gemini"
                            ) {
                              onProviderChange(value);
                            }
                          }}
                          value={field.value}
                        >
                          <SelectTrigger className="w-full min-w-0" id="opt-ai-kind" size="sm">
                            <SelectValue className="min-w-0 truncate">{aiKindLabel}</SelectValue>
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="openai-compatible">
                              {t("clipper.aiProviderOpenAi")}
                            </SelectItem>
                            <SelectItem value="anthropic">
                              {t("clipper.aiProviderAnthropic")}
                            </SelectItem>
                            <SelectItem value="gemini">
                              {t("clipper.aiProviderGemini")}
                            </SelectItem>
                          </SelectPopup>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="aiBaseUrl"
                  render={({ field }) => (
                    <FormItem className="w-full min-w-0 sm:col-span-2">
                      <FormLabel className="text-xs text-muted-foreground" htmlFor="opt-ai-base">
                        {t("clipper.aiBaseUrlLabel")}
                      </FormLabel>
                      <FormControl>
                        <Input {...field} className="w-full" id="opt-ai-base" size="sm" type="url" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="aiModel"
                  render={({ field }) => (
                    <FormItem className="w-full min-w-0">
                      <FormLabel className="text-xs text-muted-foreground" htmlFor="opt-ai-model">
                        {t("clipper.aiModelLabel")}
                      </FormLabel>
                      <FormControl>
                        <Input {...field} className="w-full" id="opt-ai-model" size="sm" type="text" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="aiApiKey"
                render={({ field }) => (
                  <FormItem className="w-full min-w-0">
                    <FormLabel className="text-xs text-muted-foreground" htmlFor="opt-ai-key">
                      {t("clipper.aiApiKeyLabel")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        className="w-full"
                        endAddon={
                          <Button
                            aria-label={t("clipper.toggleSecretVisibility")}
                            onClick={() => setShowAiKey((v) => !v)}
                            size="icon-xs"
                            type="button"
                            variant="ghost"
                          >
                            {showAiKey ? (
                              <EyeOff className="size-3.5" />
                            ) : (
                              <Eye className="size-3.5" />
                            )}
                          </Button>
                        }
                        id="opt-ai-key"
                        placeholder={t("clipper.aiApiKeyPlaceholder")}
                        size="sm"
                        type={showAiKey ? "text" : "password"}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </GridDisclosure>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {watchedAiEnabled ? (
              <Button
                disabled={testingAi || !watchedAiApiKey.trim() || !watchedAiModel.trim()}
                onClick={onTestAi}
                size="sm"
                type="button"
                variant="outline"
              >
                <PlugZap className="size-3.5" />
                <span>
                  {testingAi ? t("clipper.testingConnection") : t("clipper.aiTestBtn")}
                </span>
              </Button>
            ) : null}
            <Button className="flex-1" size="sm" type="submit">
              <Save className="size-3.5" />
              <span>{t("clipper.saveSettingsBtn")}</span>
            </Button>
          </div>
        </Form>
      </form>
    </Card>
  );
}
