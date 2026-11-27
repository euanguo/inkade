import {
  type ApiTokenId,
  asProjectRuleId,
  asSpaceId,
  autonomyLevelToScopePatch,
  deriveAutonomyPolicy,
  PROJECT_SCOPE_RULE_MATCH_TYPES,
  type AutonomyLevel,
  type ProjectRuleId,
  type ProjectScopeRule,
  type ProjectScopeRuleMatchType,
  type TokenScope,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  inkadeQueries,
  useInkadeClient,
  useInkadeScopeRules,
  useInkadeSpaces,
} from "@inkade/sdk/react";
import {
  AutonomyDial,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  HoldConfirmButton,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  SpaceIcon,
  Textarea,
} from "@inkade/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { SettingsGroupSkeleton } from "./SettingsSkeletons.tsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon, SparklesIcon } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { getInkadeClient } from "../../lib/api.ts";
import { showErrorToast, showSuccessToast } from "../../lib/undo.ts";
import {
  DangerZone,
  SettingRow,
  SettingsGroup,
  SettingsSectionHeader,
} from "./SettingRow.tsx";
import { matchScopeRules } from "./types.ts";

export function ScopeRulesSettings(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const queryClient = useQueryClient();

  const spacesQuery = useInkadeSpaces({ includeArchived: true });

  const rulesQuery = useInkadeScopeRules();

  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const activeSpaces = useMemo(
    () => spaces.filter((s) => s.archivedAt === null),
    [spaces],
  );
  const spaceById = useMemo(
    () => new Map(spaces.map((s) => [s.id, s])),
    [spaces],
  );

  const matchTypeLabels: Readonly<Record<ProjectScopeRuleMatchType, string>> = {
    repo_name: t("settings.matchTypeRepoName"),
    git_remote: t("settings.matchTypeGitRemote"),
    path_glob: t("settings.matchTypePathGlob"),
  };

  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ProjectScopeRule | null>(null);
  const ruleSchema = useMemo(
    () =>
      z.object({
        matchType: z.enum(PROJECT_SCOPE_RULE_MATCH_TYPES),
        pattern: z.string().trim().min(1, t("validation.required")),
        writableIds: z.array(z.string()),
        readonlyIds: z.array(z.string()),
        defaultInboxId: z.string(),
        defaultResearchId: z.string(),
        priority: z.string(),
        instructions: z.string(),
      }),
    [t],
  );
  type RuleFormValues = z.infer<typeof ruleSchema>;

  const ruleForm = useForm<RuleFormValues>({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      matchType: "repo_name",
      pattern: "",
      writableIds: [],
      readonlyIds: [],
      defaultInboxId: "__none__",
      defaultResearchId: "__none__",
      priority: "10",
      instructions: "",
    },
  });
  const watchedMatchType = useWatch({ control: ruleForm.control, name: "matchType" });
  const [testInput, setTestInput] = useState("");

  const [selectedDeleteRuleId, setSelectedDeleteRuleId] = useState<ProjectRuleId | "__none__">("__none__");

  const whoamiQuery = useQuery({
    ...inkadeQueries.whoami(client),
    retry: false,
  });

  const tokensQuery = useQuery({
    ...inkadeQueries.tokens(client),
    retry: false,
  });

  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data]);
  const activeTokens = useMemo(
    () => (tokensQuery.data ?? []).filter((tok) => tok.revokedAt === null),
    [tokensQuery.data],
  );
  const primaryActiveToken = activeTokens[0] ?? null;

  const effectiveScope: TokenScope = useMemo(
    () =>
      primaryActiveToken?.scope ??
      whoamiQuery.data?.scope ?? {
        permission: "append",
        spaceIds: "*",
        includeDescendants: true,
        denyHardDelete: true,
      },
    [primaryActiveToken?.scope, whoamiQuery.data?.scope],
  );
  const effectivePolicy = useMemo(() => deriveAutonomyPolicy(effectiveScope), [effectiveScope]);

  const updateTokenAutonomyMutation = useMutation({
    mutationFn: (vars: { readonly id: ApiTokenId; readonly scope: TokenScope }) =>
      getInkadeClient().tokens.update(vars.id, {
        scope: {
          permission: vars.scope.permission,
          spaceIds: vars.scope.spaceIds === "*" ? "*" : [...vars.scope.spaceIds],
          includeDescendants: vars.scope.includeDescendants,
          denyHardDelete: true,
          ...(vars.scope.tagAllowlist ? { tagAllowlist: [...vars.scope.tagAllowlist] } : {}),
          ...(vars.scope.allowedKinds ? { allowedKinds: [...vars.scope.allowedKinds] } : {}),
        },
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.tokens() });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.whoami() });
      showSuccessToast(t("settings.tokenUpdated"), updated.name);
    },
    onError: (err) => showErrorToast(t("settings.tokenUpdateFailed"), err),
  });

  const matchedRules = useMemo(
    () => matchScopeRules(rules, testInput),
    [rules, testInput],
  );
  const topMatch = matchedRules[0] ?? null;

  const saveRuleMutation = useMutation({
    mutationFn: async (values: RuleFormValues) => {
      const payload = {
        matchType: values.matchType,
        pattern: values.pattern.trim(),
        writableSpaceIds: values.writableIds.map(asSpaceId),
        readonlySpaceIds: values.readonlyIds.map(asSpaceId),
        defaultInboxSpaceId:
          values.defaultInboxId !== "__none__" ? asSpaceId(values.defaultInboxId) : undefined,
        defaultResearchSpaceId:
          values.defaultResearchId !== "__none__" ? asSpaceId(values.defaultResearchId) : undefined,
        extraInstructions: values.instructions.trim() || undefined,
        priority: Number.parseInt(values.priority, 10) || 0,
      };
      if (editingRule) {
        return getInkadeClient().scopeRules.update(editingRule.id, payload);
      }
      return getInkadeClient().scopeRules.create(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.scopeRules() });
      setRuleDialogOpen(false);
      showSuccessToast(editingRule ? t("settings.ruleUpdated") : t("settings.ruleCreated"));
    },
    onError: (err) => showErrorToast(t("settings.ruleSaveFailed"), err),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id: ProjectRuleId) => getInkadeClient().scopeRules.delete(id),
    onSuccess: () => {
      setSelectedDeleteRuleId("__none__");
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.scopeRules() });
      showSuccessToast(t("settings.ruleDeleted"));
    },
    onError: (err) => showErrorToast(t("settings.ruleDeleteFailed"), err),
  });

  const openNewRuleDialog = (): void => {
    setEditingRule(null);
    ruleForm.reset({
      matchType: "repo_name",
      pattern: "",
      writableIds: [],
      readonlyIds: [],
      defaultInboxId: "__none__",
      defaultResearchId: "__none__",
      priority: "10",
      instructions: "",
    });
    setRuleDialogOpen(true);
  };

  const openEditRuleDialog = (rule: ProjectScopeRule): void => {
    setEditingRule(rule);
    ruleForm.reset({
      matchType: rule.matchType,
      pattern: rule.pattern,
      writableIds: [...rule.writableSpaceIds],
      readonlyIds: [...rule.readonlySpaceIds],
      defaultInboxId: rule.defaultInboxSpaceId ?? "__none__",
      defaultResearchId: rule.defaultResearchSpaceId ?? "__none__",
      priority: String(rule.priority),
      instructions: rule.extraInstructions ?? "",
    });
    setRuleDialogOpen(true);
  };

  const handleRuleSubmit = ruleForm.handleSubmit((values) => {
    saveRuleMutation.mutate(values);
  });

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        actions={
          <Button onClick={openNewRuleDialog} size="sm">
            <PlusIcon />
            {t("settings.createRule")}
          </Button>
        }
        description={t("settings.rulesDesc")}
        title={t("settings.rulesTitle")}
      />

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold text-foreground">
            {t("settings.scopePolicyPreviewTitle")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("settings.scopePolicyPreviewDesc")}
          </p>
        </div>
        <AutonomyDial
          disabled={updateTokenAutonomyMutation.isPending}
          onChange={
            primaryActiveToken
              ? (level: AutonomyLevel) =>
                  updateTokenAutonomyMutation.mutate({
                    id: primaryActiveToken.id,
                    scope: {
                      ...primaryActiveToken.scope,
                      ...autonomyLevelToScopePatch(level),
                    },
                  })
              : undefined
          }
          policy={effectivePolicy}
          readOnly={!primaryActiveToken}
          value={effectivePolicy.level}
          variant="embedded"
        />
      </div>

      {/* Diagnostic Live Match Tester Card */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <SparklesIcon className="size-4 text-primary" />
              <span>{t("settings.liveMatcherTitle")}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.liveMatcherDesc")}</p>
          </div>
          {testInput.trim() ? (
            <Badge size="sm" variant={matchedRules.length > 0 ? "success" : "secondary"}>
              {t("settings.matchedRulesCount", { count: matchedRules.length })}
            </Badge>
          ) : null}
        </div>

        <Input
          aria-label={t("settings.liveMatcherTitle")}
          onChange={(e) => setTestInput(e.target.value)}
          placeholder={t("settings.liveMatcherPlaceholder")}
          size="sm"
          value={testInput}
        />

        {!testInput.trim() ? (
          <p className="text-xs text-muted-foreground">{t("settings.liveMatcherIdleHint")}</p>
        ) : !topMatch ? (
          <div className="rounded-md bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
            {t("settings.liveMatcherNoMatch")}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 rounded-md bg-success/[0.07] p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{t("settings.topMatchLabel")}</span>
              <Badge size="sm" variant="default">
                {topMatch.matchType}
              </Badge>
              <code className="font-mono font-semibold text-foreground">{topMatch.pattern}</code>
              <Badge size="sm" variant="secondary">
                {t("settings.priorityBadge", { priority: topMatch.priority })}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">{t("settings.writableLabel")}</span>
              {topMatch.writableSpaceIds.length === 0 ? (
                <span>—</span>
              ) : (
                topMatch.writableSpaceIds.map((id) => {
                  const sp = spaceById.get(id);
                  return (
                    <Badge key={id} size="sm" variant="info">
                      <SpaceIcon color={sp?.color} icon={sp?.icon} size="xs" />
                      <span>{sp?.name ?? id}</span>
                    </Badge>
                  );
                })
              )}

              <span className="ms-2 text-muted-foreground">{t("settings.readonlyLabel")}</span>
              {topMatch.readonlySpaceIds.length === 0 ? (
                <span>—</span>
              ) : (
                topMatch.readonlySpaceIds.map((id) => {
                  const sp = spaceById.get(id);
                  return (
                    <Badge key={id} size="sm" variant="outline">
                      <SpaceIcon color={sp?.color} icon={sp?.icon} size="xs" />
                      <span>{sp?.name ?? id}</span>
                    </Badge>
                  );
                })
              )}
            </div>

            {topMatch.extraInstructions ? (
              <div className="border-t border-success/15 pt-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t("settings.extraInstructionsPreview")}
                </span>{" "}
                {topMatch.extraInstructions}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Rules List */}
      {rulesQuery.isPending ? (
        <SettingsGroupSkeleton rows={3} variant="rule" />
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-dashed py-10 text-center text-xs text-muted-foreground">
          {t("settings.noRules")}
        </div>
      ) : (
        <SettingsGroup>
          {rules.map((rule) => {
            const isMatched = matchedRules.some((m) => m.id === rule.id);
            return (
              <div
                className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5 ${
                  isMatched ? "bg-success/[0.06]" : ""
                }`}
                key={rule.id}
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge size="sm" variant="outline">
                      {rule.matchType}
                    </Badge>
                    <code className="font-mono text-xs font-semibold text-foreground">
                      {rule.pattern}
                    </code>
                    <Badge size="sm" variant="secondary">
                      {t("settings.priorityBadge", { priority: rule.priority })}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{t("settings.writableLabel")}</span>
                    {rule.writableSpaceIds.length === 0 ? (
                      <span>—</span>
                    ) : (
                      rule.writableSpaceIds.map((id) => {
                        const sp = spaceById.get(id);
                        return (
                          <Badge key={id} size="sm" variant="info">
                            {sp?.name ?? id}
                          </Badge>
                        );
                      })
                    )}
                    <span className="ms-2">{t("settings.readonlyLabel")}</span>
                    {rule.readonlySpaceIds.length === 0 ? (
                      <span>—</span>
                    ) : (
                      rule.readonlySpaceIds.map((id) => {
                        const sp = spaceById.get(id);
                        return (
                          <Badge key={id} size="sm" variant="outline">
                            {sp?.name ?? id}
                          </Badge>
                        );
                      })
                    )}
                  </div>
                </div>

                <Button
                  onClick={() => openEditRuleDialog(rule)}
                  size="xs"
                  variant="outline"
                >
                  <PencilIcon />
                  {t("common.edit")}
                </Button>
              </div>
            );
          })}
        </SettingsGroup>
      )}

      {rules.length > 0 ? (
        <DangerZone>
          <SettingRow
            description={t("settings.deleteRuleZoneDesc")}
            title={t("settings.deleteRuleZoneTitle")}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Select<ProjectRuleId | "__none__">
                onValueChange={(val) =>
                  setSelectedDeleteRuleId(!val || val === "__none__" ? "__none__" : asProjectRuleId(val))
                }
                value={selectedDeleteRuleId}
              >
                <SelectTrigger className="w-52" size="sm">
                  <SelectValue>
                    {selectedDeleteRuleId === "__none__"
                      ? t("settings.selectRuleToDelete")
                      : (rules.find((r) => r.id === selectedDeleteRuleId)?.pattern ??
                        t("settings.selectRuleToDelete"))}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="__none__">{t("settings.selectRuleToDelete")}</SelectItem>
                  {rules.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.matchType}: {r.pattern}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <HoldConfirmButton
                disabled={selectedDeleteRuleId === "__none__" || deleteRuleMutation.isPending}
                holdingLabel={t("settings.holdingToDeleteRule")}
                onConfirm={() => {
                  const target = rules.find((r) => r.id === selectedDeleteRuleId) ?? null;
                  if (target) deleteRuleMutation.mutate(target.id);
                }}
                size="sm"
              >
                {t("settings.holdToDeleteRule")}
              </HoldConfirmButton>
            </div>
          </SettingRow>
        </DangerZone>
      ) : null}

      {/* Project Scope Rule CRUD Dialog */}
      <Dialog onOpenChange={setRuleDialogOpen} open={ruleDialogOpen}>
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingRule ? t("settings.editRuleTitle") : t("settings.createRuleTitle")}
            </DialogTitle>
          </DialogHeader>
          <form noValidate onSubmit={(e) => void handleRuleSubmit(e)}>
            <Form {...ruleForm}>
              <DialogPanel className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <FormField
                    control={ruleForm.control}
                    name="matchType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("settings.matchTypeLabel")}</FormLabel>
                        <Select
                          onValueChange={(val) =>
                            field.onChange((val as ProjectScopeRuleMatchType) ?? "repo_name")
                          }
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue>{matchTypeLabels[watchedMatchType]}</SelectValue>
                            </SelectTrigger>
                          </FormControl>
                          <SelectPopup>
                            {PROJECT_SCOPE_RULE_MATCH_TYPES.map((mt) => (
                              <SelectItem key={mt} value={mt}>
                                {matchTypeLabels[mt]}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={ruleForm.control}
                    name="pattern"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>{t("settings.patternLabel")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("settings.patternPlaceholder")} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    control={ruleForm.control}
                    name="writableIds"
                    render={({ field }) => (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium">{t("settings.writableSpaces")}</span>
                        <div className="flex max-h-36 flex-col gap-1.5 overflow-y-auto rounded-lg border p-2 [scrollbar-gutter:stable]">
                          {activeSpaces.map((s) => (
                            <label className="flex cursor-pointer items-center gap-2 text-xs" key={s.id}>
                              <Checkbox
                                checked={field.value.includes(s.id)}
                                onCheckedChange={(checked) =>
                                  field.onChange(
                                    checked
                                      ? [...field.value, s.id]
                                      : field.value.filter((id) => id !== s.id),
                                  )
                                }
                              />
                              <SpaceIcon color={s.color} icon={s.icon} size="xs" />
                              <span>{s.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  />

                  <FormField
                    control={ruleForm.control}
                    name="readonlyIds"
                    render={({ field }) => (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium">{t("settings.readonlySpaces")}</span>
                        <div className="flex max-h-36 flex-col gap-1.5 overflow-y-auto rounded-lg border p-2 [scrollbar-gutter:stable]">
                          {activeSpaces.map((s) => (
                            <label className="flex cursor-pointer items-center gap-2 text-xs" key={s.id}>
                              <Checkbox
                                checked={field.value.includes(s.id)}
                                onCheckedChange={(checked) =>
                                  field.onChange(
                                    checked
                                      ? [...field.value, s.id]
                                      : field.value.filter((id) => id !== s.id),
                                  )
                                }
                              />
                              <SpaceIcon color={s.color} icon={s.icon} size="xs" />
                              <span>{s.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <FormField
                    control={ruleForm.control}
                    name="defaultInboxId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("settings.defaultInboxSpace")}</FormLabel>
                        <Select<string>
                          onValueChange={(val) =>
                            field.onChange(!val || val === "__none__" ? "__none__" : asSpaceId(val))
                          }
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue>
                                {field.value === "__none__"
                                  ? t("common.unspecified")
                                  : (activeSpaces.find((s) => s.id === field.value)?.name ??
                                    t("common.unspecified"))}
                              </SelectValue>
                            </SelectTrigger>
                          </FormControl>
                          <SelectPopup>
                            <SelectItem value="__none__">{t("common.unspecified")}</SelectItem>
                            {activeSpaces.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={ruleForm.control}
                    name="defaultResearchId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("settings.defaultResearchSpace")}</FormLabel>
                        <Select<string>
                          onValueChange={(val) =>
                            field.onChange(!val || val === "__none__" ? "__none__" : asSpaceId(val))
                          }
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue>
                                {field.value === "__none__"
                                  ? t("common.unspecified")
                                  : (activeSpaces.find((s) => s.id === field.value)?.name ??
                                    t("common.unspecified"))}
                              </SelectValue>
                            </SelectTrigger>
                          </FormControl>
                          <SelectPopup>
                            <SelectItem value="__none__">{t("common.unspecified")}</SelectItem>
                            {activeSpaces.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={ruleForm.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("settings.priorityLabel")}</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={ruleForm.control}
                  name="instructions"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.extraInstructionsLabel")}</FormLabel>
                      <FormControl>
                        <Textarea
                          className="min-h-20"
                          placeholder={t("settings.extraInstructionsPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </DialogPanel>
              <DialogFooter>
                <Button onClick={() => setRuleDialogOpen(false)} type="button" variant="outline">
                  {t("common.cancel")}
                </Button>
                <Button loading={saveRuleMutation.isPending} type="submit">
                  {t("settings.saveRule")}
                </Button>
              </DialogFooter>
            </Form>
          </form>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
