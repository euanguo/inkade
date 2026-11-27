import { useInkadeTranslation } from "@inkade/i18n";
import {
  Badge,
  Button,
  Card,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@inkade/ui/primitives";
import { Eye, EyeOff, PlugZap, Save, Wifi } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import type { ClipperConnectionInfo } from "../../core/sync.ts";
import { launchClipperPairingFlow } from "../shared/clipper-ui-helpers.ts";
import type { ConnectionFormValues } from "./useOptionsController.ts";

export interface OptionsConnectionSectionProps {
  readonly form: UseFormReturn<ConnectionFormValues>;
  readonly connInfo: ClipperConnectionInfo | null;
  readonly testing: boolean;
  readonly probing: boolean;
  readonly onTestConnection: () => void;
  readonly onProbeLocalServer: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function OptionsConnectionSection({
  form,
  connInfo,
  testing,
  probing,
  onTestConnection,
  onProbeLocalServer,
  onSubmit,
}: OptionsConnectionSectionProps) {
  const { t } = useInkadeTranslation();
  const [showToken, setShowToken] = useState(false);
  const watchedServerUrl = useWatch({ control: form.control, name: "serverUrl" });
  const watchedWebAppUrl = useWatch({ control: form.control, name: "webAppUrl" });
  const watchedToken = useWatch({ control: form.control, name: "token" });

  return (
    <Card className="gap-4 rounded-lg px-4 py-4">
      <form className="flex flex-col gap-3.5" noValidate onSubmit={onSubmit}>
        <Form {...form}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 text-[13px] font-semibold text-foreground">
              {t("clipper.optionsSectionConnection")}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                disabled={probing}
                onClick={onProbeLocalServer}
                size="xs"
                type="button"
                variant="outline"
              >
                <Wifi className="size-3" />
                <span>{probing ? t("clipper.probingLocal") : t("clipper.probeLocalBtn")}</span>
              </Button>
              <Button
                onClick={() =>
                  void launchClipperPairingFlow({
                    serverUrl: watchedServerUrl,
                    webAppUrl: watchedWebAppUrl,
                  })
                }
                size="xs"
                type="button"
                variant="outline"
              >
                <PlugZap className="size-3" />
                <span>{t("clipper.oneClickPairBtn")}</span>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="serverUrl"
              render={({ field }) => (
                <FormItem className="w-full min-w-0">
                  <FormLabel className="text-xs text-muted-foreground" htmlFor="opt-server">
                    {t("clipper.serverUrlLabel")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className="w-full"
                      id="opt-server"
                      placeholder={t("clipper.serverUrlPlaceholder")}
                      size="sm"
                      type="url"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="webAppUrl"
              render={({ field }) => (
                <FormItem className="w-full min-w-0">
                  <FormLabel className="text-xs text-muted-foreground" htmlFor="opt-webapp">
                    {t("clipper.webAppUrlLabel")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className="w-full"
                      id="opt-webapp"
                      placeholder={t("clipper.webAppUrlPlaceholder")}
                      size="sm"
                      type="url"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="token"
            render={({ field }) => (
              <FormItem className="w-full min-w-0">
                <FormLabel className="text-xs text-muted-foreground" htmlFor="opt-token">
                  {t("clipper.tokenLabel")}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="w-full"
                    endAddon={
                      <Button
                        aria-label={t("clipper.toggleSecretVisibility")}
                        onClick={() => setShowToken((v) => !v)}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        {showToken ? (
                          <EyeOff className="size-3.5" />
                        ) : (
                          <Eye className="size-3.5" />
                        )}
                      </Button>
                    }
                    id="opt-token"
                    placeholder={t("clipper.tokenPlaceholder")}
                    size="sm"
                    type={showToken ? "text" : "password"}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {connInfo ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/45 px-3 py-2 text-xs text-muted-foreground tabular-nums">
              <strong className="text-foreground">
                {t("clipper.scopePermissionsHeading")}:
              </strong>
              <Badge size="sm" variant="secondary">
                {connInfo.scopeSummary.permission}
              </Badge>
              <span>
                {t("clipper.optionsConnectedSpacesCount", {
                  count: connInfo.visibleSpaces.length,
                })}
              </span>
              {connInfo.scopeSummary.denyHardDelete ? (
                <Badge size="sm" variant="outline">
                  {t("scope.noHardDeleteBadge")}
                </Badge>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              disabled={testing || !watchedServerUrl.trim() || !watchedToken.trim()}
              onClick={onTestConnection}
              size="sm"
              type="button"
              variant="outline"
            >
              <PlugZap className="size-3.5" />
              <span>
                {testing ? t("clipper.testingConnection") : t("clipper.testConnectionBtn")}
              </span>
            </Button>
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
