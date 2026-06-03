import type { ThemeMode } from "../../types";
import type { GoogleCalendarListDto, GoogleProxyConfig } from "../../api/googleTasks";
import type { HotkeyConfig } from "../../App";
import { Modal } from "../ui/Modal";
import { AboutSection } from "../settings/AboutSection";
import { AppearanceSection } from "../settings/AppearanceSection";
import { GoogleAccountSection } from "../settings/GoogleAccountSection";
import { GoogleProxySection } from "../settings/GoogleProxySection";
import { HotkeysSection } from "../settings/HotkeysSection";
import { StartupSection } from "../settings/StartupSection";
import { SyncSettingsSection, type AutoSyncMode } from "../settings/SyncSettingsSection";
import { TaskDisplaySection } from "../settings/TaskDisplaySection";

type SettingsModalProps = {
  open: boolean;
  theme: ThemeMode;
  showCompleted: boolean;
  showTaskCount: boolean;
  showCollapsedSidebarBadges: boolean;
  expandSubtasks: boolean;
  googleProxyConfig: GoogleProxyConfig;
  googleProxySaving: boolean;
  googleProxyMessage: string;
  lastGoogleError: string;
  googleSignedIn: boolean;
  googleSyncing: boolean;
  googleUserName: string;
  googleUserEmail: string;
  googleUserPicture: string;
  language: "en" | "zh";
  hotkeys: HotkeyConfig;
  startupEnabled: boolean;
  startupSaving: boolean;
  startupMessage: string;
  minimizeOnLaunch: boolean;
  autoSyncMode: AutoSyncMode;
  calendarLists: GoogleCalendarListDto[];
  selectedCalendarIds: string[] | null;
  loadingCalendarLists: boolean;
  calendarListMessage: string;
  onGoogleLogin: () => void;
  onGoogleSync: () => void;
  onGoogleSignOut: () => void;
  onLanguageChange: (value: "en" | "zh") => void;
  onHotkeyChange: (key: keyof HotkeyConfig, value: string) => void;
  onHotkeysReset: () => void;
  onStartupChange: (value: boolean) => void;
  onMinimizeOnLaunchChange: (value: boolean) => void;
  onAutoSyncModeChange: (value: AutoSyncMode) => void;
  onCalendarSelectionChange: (calendarId: string, selected: boolean) => void;
  onClose: () => void;
  onThemeChange: (value: ThemeMode) => void;
  onGoogleProxyChange: (value: GoogleProxyConfig) => void;
  onGoogleProxySave: () => void;
  onShowCompletedChange: (value: boolean) => void;
  onShowTaskCountChange: (value: boolean) => void;
  onShowCollapsedSidebarBadgesChange: (value: boolean) => void;
  onExpandSubtasksChange: (value: boolean) => void;
};

function t(language: "en" | "zh", en: string, zh: string) {
  return language === "zh" ? zh : en;
}

export function SettingsModal({
  open,
  theme,
  showCompleted,
  showTaskCount,
  showCollapsedSidebarBadges,
  expandSubtasks,
  googleProxyConfig,
  googleProxySaving,
  googleProxyMessage,
  lastGoogleError,
  googleSignedIn,
  googleSyncing,
  googleUserName,
  googleUserEmail,
  googleUserPicture,
  language,
  hotkeys,
  startupEnabled,
  startupSaving,
  startupMessage,
  minimizeOnLaunch,
  autoSyncMode,
  calendarLists,
  selectedCalendarIds,
  loadingCalendarLists,
  calendarListMessage,
  onGoogleLogin,
  onGoogleSync,
  onGoogleSignOut,
  onLanguageChange,
  onHotkeyChange,
  onHotkeysReset,
  onStartupChange,
  onMinimizeOnLaunchChange,
  onAutoSyncModeChange,
  onCalendarSelectionChange,
  onClose,
  onThemeChange,
  onGoogleProxyChange,
  onGoogleProxySave,
  onShowCompletedChange,
  onShowTaskCountChange,
  onShowCollapsedSidebarBadgesChange,
  onExpandSubtasksChange,
}: SettingsModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={t(language, "Settings", "设置")} className="max-w-3xl">
      <div className="app-scrollbar max-h-[76vh] space-y-xxl overflow-y-auto p-xl">
        <GoogleAccountSection
          language={language}
          signedIn={googleSignedIn}
          syncing={googleSyncing}
          userName={googleUserName}
          userEmail={googleUserEmail}
          userPicture={googleUserPicture}
          onLogin={onGoogleLogin}
          onSync={onGoogleSync}
          onSignOut={onGoogleSignOut}
        />
        <section className="space-y-md">
          <h3 className="border-b border-hairline-soft pb-xs text-title-md text-ink dark:border-surface-dark-elevated dark:text-on-dark">
            {t(language, "Language", "语言")}
          </h3>
          <div className="inline-flex rounded-full border border-hairline bg-surface-soft p-xxs dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
            <button
              className={`rounded-full px-lg py-xs text-button transition-colors ${
                language === "en"
                  ? "border border-hairline bg-canvas text-ink shadow-subtle dark:border-surface-tint dark:bg-surface-dark dark:text-on-dark"
                  : "text-muted hover:text-ink dark:text-on-dark-soft dark:hover:text-on-dark"
              }`}
              onClick={() => onLanguageChange("en")}
            >
              English
            </button>
            <button
              className={`rounded-full px-lg py-xs text-button transition-colors ${
                language === "zh"
                  ? "border border-hairline bg-canvas text-ink shadow-subtle dark:border-surface-tint dark:bg-surface-dark dark:text-on-dark"
                  : "text-muted hover:text-ink dark:text-on-dark-soft dark:hover:text-on-dark"
              }`}
              onClick={() => onLanguageChange("zh")}
            >
              中文
            </button>
          </div>
        </section>
        <GoogleProxySection
          language={language}
          value={googleProxyConfig}
          saving={googleProxySaving}
          message={googleProxyMessage}
          lastError={lastGoogleError}
          onChange={onGoogleProxyChange}
          onSave={onGoogleProxySave}
        />
        <HotkeysSection language={language} hotkeys={hotkeys} onChange={onHotkeyChange} onReset={onHotkeysReset} />
        <StartupSection
          language={language}
          enabled={startupEnabled}
          saving={startupSaving}
          message={startupMessage}
          minimizeOnLaunch={minimizeOnLaunch}
          onChange={onStartupChange}
          onMinimizeOnLaunchChange={onMinimizeOnLaunchChange}
        />
        <SyncSettingsSection
          language={language}
          signedIn={googleSignedIn}
          autoSyncMode={autoSyncMode}
          calendarLists={calendarLists}
          selectedCalendarIds={selectedCalendarIds}
          loadingCalendarLists={loadingCalendarLists}
          calendarListMessage={calendarListMessage}
          onAutoSyncModeChange={onAutoSyncModeChange}
          onCalendarSelectionChange={onCalendarSelectionChange}
        />
        <AppearanceSection language={language} value={theme} onChange={onThemeChange} />
        <TaskDisplaySection
          language={language}
          showCompleted={showCompleted}
          showTaskCount={showTaskCount}
          showCollapsedSidebarBadges={showCollapsedSidebarBadges}
          onShowCompletedChange={onShowCompletedChange}
          onShowTaskCountChange={onShowTaskCountChange}
          onShowCollapsedSidebarBadgesChange={onShowCollapsedSidebarBadgesChange}
        />
        <AboutSection language={language} />
      </div>
    </Modal>
  );
}
