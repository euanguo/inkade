import { useNavigate } from "@tanstack/react-router";
import type React from "react";
import { AccountSettings } from "./settings/AccountSettings.tsx";
import { AppearanceSettings } from "./settings/AppearanceSettings.tsx";
import { AuditLogsSettings } from "./settings/AuditLogsSettings.tsx";
import { BackupSettings } from "./settings/BackupSettings.tsx";
import { IntelligenceSettings } from "./settings/IntelligenceSettings.tsx";
import { OfflineSyncSettings } from "./settings/OfflineSyncSettings.tsx";
import { ScopeRulesSettings } from "./settings/ScopeRulesSettings.tsx";
import { SecuritySettings } from "./settings/SecuritySettings.tsx";
import { SettingsLayout } from "./settings/SettingsLayout.tsx";
import { ShareLinksSettings } from "./settings/ShareLinksSettings.tsx";
import { ShortcutsSettings } from "./settings/ShortcutsSettings.tsx";
import { SpacesSettings } from "./settings/SpacesSettings.tsx";
import { StorageSettings } from "./settings/StorageSettings.tsx";
import { TemplatesSettings } from "./settings/TemplatesSettings.tsx";
import { resolveSettingsSection, type SettingsSectionId } from "./settings/types.ts";
import { TokensSettings } from "./settings/TokensSettings.tsx";

export interface SettingsPageProps {
  readonly section?: string | undefined;
}

export function renderSettingsSection(
  section: SettingsSectionId,
  onNavigateSection?: (nextSection: SettingsSectionId) => void,
): React.ReactElement {
  switch (section) {
    case "appearance":
      return <AppearanceSettings onNavigateSection={onNavigateSection} />;
    case "shortcuts":
      return <ShortcutsSettings />;
    case "account":
      return <AccountSettings />;
    case "spaces":
      return <SpacesSettings />;
    case "templates":
      return <TemplatesSettings />;
    case "storage":
      return <StorageSettings />;
    case "backup":
      return <BackupSettings />;
    case "rag":
      return <IntelligenceSettings />;
    case "sync":
      return <OfflineSyncSettings />;
    case "tokens":
      return <TokensSettings />;
    case "scope-rules":
      return <ScopeRulesSettings />;
    case "audit-logs":
      return <AuditLogsSettings />;
    case "security":
      return <SecuritySettings />;
    case "share-links":
      return <ShareLinksSettings />;
    default: {
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
}

export function SettingsLayoutAdapter({
  activeSection,
  onClose,
  onOpenFullPage,
  onSelectSection,
}: {
  readonly activeSection: SettingsSectionId;
  readonly onClose: () => void;
  readonly onOpenFullPage: () => void;
  readonly onSelectSection: (nextSection: SettingsSectionId) => void;
}): React.ReactElement {
  return (
    <SettingsLayout
      activeSection={activeSection}
      mode="modal"
      onClose={onClose}
      onOpenFullPage={onOpenFullPage}
      onSelectSection={onSelectSection}
    >
      {renderSettingsSection(activeSection, onSelectSection)}
    </SettingsLayout>
  );
}

export function SettingsPage({ section }: SettingsPageProps): React.ReactElement {
  const navigate = useNavigate();
  const activeSection = resolveSettingsSection(section);

  return (
    <SettingsLayout activeSection={activeSection}>
      {renderSettingsSection(activeSection, (next) => {
        void navigate({ to: "/settings/$section", params: { section: next } });
      })}
    </SettingsLayout>
  );
}
