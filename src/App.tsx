import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRef } from "react";
import { startTransition } from "react";
import type { CSSProperties } from "react";
import {
  Archive,
  Bell,
  Briefcase,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Cloud,
  CloudOff,
  Folder,
  GripVertical,
  Home,
  Lightbulb,
  ListChecks,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Pin,
  Plus,
  RefreshCw,
  Search,
  StickyNote,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import {
  googleTasksApi,
  type AuthStatus,
  type GoogleCalendarEventDto,
  type GoogleCalendarListDto,
  type GoogleProxyConfig,
  type GoogleTaskDto,
  type GoogleTaskListDto,
} from "./api/googleTasks";
import { syncApi, type CachedSnapshot, type SyncResult } from "./api/sync";
import { SettingsModal } from "./components/modals/SettingsModal";
import type { AutoSyncMode } from "./components/settings/SyncSettingsSection";
import { Button } from "./components/ui/Button";
import { mockLists, mockNotes, mockTasks } from "./data/mockData";
import { cn } from "./lib/classNames";
import type {
  Note,
  NoteColor,
  QuickTaskDraft,
  ResolvedThemeMode,
  SmartView,
  Subtask,
  Task,
  TaskListSummary,
  TaskRecurrenceFrequency,
  ThemeMode,
} from "./types";

type WorkspaceView = "list" | "board" | "notes" | "calendar" | "manage" | "archive" | "trash";
type LanguageMode = "en" | "zh";
type SaveState = "idle" | "saving" | "saved" | "error";
type ListCustomColorMap = Record<string, string>;
type CalendarEvent = GoogleCalendarEventDto;
type TaskPriorityMap = Record<string, Task["priority"]>;
type NoteFilter = "all" | "pinned" | "reminders" | "archive";
type TaskActivityAction = "completed" | "deleted";
type TaskActivityRecord = {
  id: string;
  taskId: string;
  action: TaskActivityAction;
  operatedAt: string;
  taskSnapshot: Task;
};
type NoteActivityAction = "archived" | "deleted";
type NoteActivityRecord = {
  id: string;
  noteId: string;
  action: NoteActivityAction;
  operatedAt: string;
  noteSnapshot: Note;
};
type UtilityActivityItem =
  | { kind: "task"; id: string; action: TaskActivityAction; operatedAt: string; taskSnapshot: Task }
  | { kind: "note"; id: string; action: NoteActivityAction; operatedAt: string; noteSnapshot: Note };
type TaskListItem =
  | { kind: "task"; id: string; task: Task }
  | { kind: "calendar"; id: string; event: CalendarEvent };

export type HotkeyConfig = {
  toggleMainWindow: string;
  quickAdd: string;
  search: string;
  settings: string;
};

export type CloseButtonBehavior = "exit" | "minimizeToTray";

const defaultHotkeys: HotkeyConfig = {
  toggleMainWindow: "Ctrl+Shift+Space",
  quickAdd: "Ctrl+N",
  search: "Ctrl+F",
  settings: "Ctrl+,",
};

const QUICK_ADD_WINDOW_LABEL = "quick-add";
const THEME_STORAGE_KEY = "googleTodoTheme";
const SHOW_COMPLETED_TASKS_STORAGE_KEY = "googleTodoShowCompletedTasks";
const SHOW_TASK_COUNT_STORAGE_KEY = "googleTodoShowTaskCount";
const EXPAND_SUBTASKS_STORAGE_KEY = "googleTodoExpandSubtasks";
const CLOSE_BUTTON_BEHAVIOR_STORAGE_KEY = "googleTodoCloseButtonBehavior";
const NOTES_STORAGE_KEY = "googleTodoNotes";
const NOTE_ACTIVITY_HISTORY_STORAGE_KEY = "googleTodoNoteActivityHistory";
const TRAY_NEW_TASK_EVENT = "google-todo://tray-new-task";
const TRAY_OPEN_HOME_EVENT = "google-todo://tray-open-home";

function loadThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "dark" || saved === "system" ? saved : "light";
}

function loadCloseButtonBehavior(): CloseButtonBehavior {
  if (typeof window === "undefined") {
    return "exit";
  }
  return window.localStorage.getItem(CLOSE_BUTTON_BEHAVIOR_STORAGE_KEY) === "minimizeToTray"
    ? "minimizeToTray"
    : "exit";
}

function loadAutoSyncMode(): AutoSyncMode {
  if (typeof window === "undefined") {
    return "15";
  }
  const saved = window.localStorage.getItem("googleTodoAutoSyncIntervalMinutes");
  if (saved === "off" || saved === "15" || saved === "30" || saved === "60") {
    return saved;
  }
  return "15";
}

function loadSelectedCalendarIds(): string[] | null {
  if (typeof window === "undefined") {
    return null;
  }
  const stored = window.localStorage.getItem("googleTodoSelectedCalendarIds");
  if (stored === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : null;
  } catch {
    return null;
  }
}

function loadBooleanPreference(key: string, fallback = false) {
  if (typeof window === "undefined") {
    return fallback;
  }
  const stored = window.localStorage.getItem(key);
  return stored === null ? fallback : stored === "true";
}

function saveBooleanPreference(key: string, value: boolean) {
  window.localStorage.setItem(key, value ? "true" : "false");
}

function isNoteColor(value: unknown): value is NoteColor {
  return value === "default" || value === "amber" || value === "emerald" || value === "violet" || value === "cyan" || value === "rose";
}

function loadNotes(): Note[] {
  if (typeof window === "undefined") {
    return mockNotes;
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(NOTES_STORAGE_KEY) ?? "null") as unknown;
    if (!Array.isArray(parsed)) {
      return mockNotes;
    }
    const notes = parsed.filter((item): item is Note => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const candidate = item as Partial<Note>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.title === "string" &&
        typeof candidate.body === "string" &&
        Array.isArray(candidate.labels) &&
        candidate.labels.every((label) => typeof label === "string") &&
        isNoteColor(candidate.color) &&
        typeof candidate.pinned === "boolean" &&
        typeof candidate.archived === "boolean" &&
        typeof candidate.createdAt === "string" &&
        typeof candidate.lastEdited === "string"
      );
    });
    return notes.length > 0 ? notes : mockNotes;
  } catch {
    return mockNotes;
  }
}

function loadHotkeys(): HotkeyConfig {
  if (typeof window === "undefined") {
    return defaultHotkeys;
  }

  try {
    const stored = window.localStorage.getItem("googleTodoHotkeys");
    if (!stored) {
      return defaultHotkeys;
    }
    return { ...defaultHotkeys, ...JSON.parse(stored) };
  } catch {
    return defaultHotkeys;
  }
}

function loadListColorMap(fallbackLists: TaskListSummary[]): Record<string, number> {
  const fallback = Object.fromEntries(fallbackLists.map((list, index) => [list.id, index]));
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const stored = window.localStorage.getItem("googleTodoListColors");
    if (!stored) {
      return fallback;
    }
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const storedColors = Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
    );
    return {
      ...fallback,
      ...storedColors,
    };
  } catch {
    return fallback;
  }
}

function loadTaskPriorityMap(): TaskPriorityMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem("googleTodoTaskPriorities") ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, Task["priority"]] =>
          entry[1] === "low" || entry[1] === "medium" || entry[1] === "high",
      ),
    );
  } catch {
    return {};
  }
}

function loadTaskActivityHistory(): TaskActivityRecord[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem("googleTodoTaskActivityHistory") ?? "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((record): record is TaskActivityRecord => {
      if (!record || typeof record !== "object") {
        return false;
      }
      const candidate = record as Partial<TaskActivityRecord>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.taskId === "string" &&
        (candidate.action === "completed" || candidate.action === "deleted") &&
        typeof candidate.operatedAt === "string" &&
        Boolean(candidate.taskSnapshot)
      );
    });
  } catch {
    return [];
  }
}

function loadNoteActivityHistory(): NoteActivityRecord[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(NOTE_ACTIVITY_HISTORY_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((record): record is NoteActivityRecord => {
      if (!record || typeof record !== "object") {
        return false;
      }
      const candidate = record as Partial<NoteActivityRecord>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.noteId === "string" &&
        (candidate.action === "archived" || candidate.action === "deleted") &&
        typeof candidate.operatedAt === "string" &&
        Boolean(candidate.noteSnapshot)
      );
    });
  } catch {
    return [];
  }
}

function taskPriority(task: Task): NonNullable<Task["priority"]> {
  return task.priority ?? "medium";
}

function priorityLabel(priority: NonNullable<Task["priority"]>, language: LanguageMode) {
  const labels = {
    high: uiText(language, "High", "高"),
    medium: uiText(language, "Medium", "中"),
    low: uiText(language, "Low", "低"),
  };
  return labels[priority];
}

function mergeTaskPriority(task: Task, taskPriorityMap: TaskPriorityMap): Task {
  const priority = taskPriorityMap[task.id] ?? task.priority;
  return priority ? { ...task, priority } : task;
}

function matchesHotkey(event: KeyboardEvent, hotkey: string) {
  const parts = hotkey.split("+").map((part) => part.trim()).filter(Boolean);
  const mainKey = parts[parts.length - 1]?.toLowerCase();
  if (!mainKey) {
    return false;
  }

  const wantsCtrl = parts.includes("Ctrl");
  const wantsAlt = parts.includes("Alt");
  const wantsShift = parts.includes("Shift");
  const eventKey = event.key === " " ? "space" : event.key.toLowerCase();

  return (
    (event.ctrlKey || event.metaKey) === wantsCtrl &&
    event.altKey === wantsAlt &&
    event.shiftKey === wantsShift &&
    eventKey === mainKey
  );
}

function toGlobalShortcut(hotkey: string) {
  return hotkey.replace(/^Ctrl(?=\+|$)/, "CommandOrControl");
}

function smartViewTitle(view: SmartView, language: LanguageMode) {
  const titles: Record<SmartView, [string, string]> = {
    today: ["Today", "今天"],
    tomorrow: ["Tomorrow", "明天"],
    past: ["Past", "过期"],
    all: ["All", "全部"],
  };
  return uiText(language, titles[view][0], titles[view][1]);
}

function smartViewSubtitle(view: SmartView, language: LanguageMode) {
  const subtitles: Record<SmartView, [string, string]> = {
    today: ["Tasks due today", "今天到期的任务"],
    tomorrow: ["Upcoming tasks for tomorrow", "明天的待办任务"],
    past: ["Overdue tasks", "已过期的任务"],
    all: ["All synced and local tasks", "所有已同步和本地任务"],
  };
  return uiText(language, subtitles[view][0], subtitles[view][1]);
}

const dueTextByView: Record<SmartView, string | undefined> = {
  today: "Today",
  tomorrow: "Tomorrow",
  past: "Past",
  all: undefined,
};

function uiText(language: LanguageMode, english: string, chinese: string) {
  return language === "zh" ? chinese : english;
}

const uiDictionary: Record<string, string> = {
  "Today": "今天",
  "Tomorrow": "明天",
  "Past": "过期",
  "All": "全部",
  "Lists": "清单",
  "New List": "新建清单",
  "Search tasks...": "搜索任务...",
  "Archive / Trash": "归档 / 删除",
  "More": "更多",
  "List": "列表",
  "Board": "看板",
  "Calendar": "日历",
  "Completed shown": "显示已完成",
  "Completed hidden": "隐藏已完成",
  "New task": "新任务",
  "Add": "添加",
  "No tasks here": "这里没有任务",
  "Create a task or switch to another list.": "创建任务或切换到其他清单。",
  "No task selected": "未选择任务",
  "Pick a task from the list to edit details.": "从列表中选择一个任务以编辑详情。",
  "Notes": "笔记",
  "All Notes": "全部笔记",
  "Pinned": "已置顶",
  "Reminders": "提醒",
  "Labels": "标签",
  "Note": "笔记",
  "Task": "任务",
  "New note": "新笔记",
  "Take a note...": "写一条笔记...",
  "No notes here": "这里没有笔记",
  "Create a note or switch to another filter.": "创建笔记或切换到其他筛选。",
  "Delete note": "删除笔记",
  "Archive note": "归档笔记",
  "Restore note": "恢复笔记",
  "Archived": "已归档",
  "Open task": "打开任务",
  "Pin note": "置顶笔记",
  "Add label": "添加标签",
  "Existing labels": "已有标签",
  "Create task from note": "从笔记创建任务",
  "Saved locally": "已保存到本地",
  "Google Keep sync is not connected yet.": "Google Keep 同步尚未连接。",
  "Does not repeat": "不重复",
  "Daily": "每天",
  "Weekly": "每周",
  "Monthly": "每月",
  "Yearly": "每年",
  "Subtasks": "子任务",
  "No subtasks yet.": "暂无子任务。",
  "Add subtask": "添加子任务",
  "Save": "保存",
  "High Priority": "高优先级",
  "Medium Priority": "中优先级",
  "Low Priority": "低优先级",
  "Unscheduled": "未安排",
  "All open tasks have dates.": "所有未完成任务都已有日期。",
  "Manage Lists": "管理清单",
  "Create lists and tune their colors.": "创建清单并调整颜色。",
  "List name": "清单名称",
  "Tasks": "任务",
  "Background color": "背景颜色",
  "Actions": "操作",
  "Rename": "重命名",
  "Create New List": "创建新清单",
  "Create List": "创建清单",
  "Settings": "设置",
  "Google Account": "Google 账户",
  "Language / 语言": "语言 / Language",
  "Appearance": "外观",
  "Task Display": "任务显示",
  "Show completed tasks": "显示已完成任务",
  "Show task count": "显示任务数量",
  "Show count badges when sidebar is collapsed": "侧边栏收起时显示数量角标",
  "Expand subtasks": "展开子任务",
  "Hotkeys": "快捷键",
  "Startup": "启动",
  "Launch at startup": "开机自启动",
  "Start Google Todo automatically when Windows signs in.": "Windows 登录后自动启动 Google Todo。",
  "Start minimized after launch": "启动后自动最小化",
  "Hide the main window to the system tray after the app starts.": "应用启动后自动隐藏主窗口到系统托盘。",
  "Saving startup setting...": "正在保存开机自启动设置...",
  "Startup setting is off": "未开启开机自启动",
  "Reset Defaults": "恢复默认",
  "Sign in": "登录",
  "Sign out": "退出登录",
  "Sync Now": "立即同步",
  "Syncing": "同步中",
  "Opening": "打开中",
  "Search": "搜索",
  "Light": "浅色",
  "Dark": "深色",
  "System": "跟随系统",
  "About": "关于",
  "Close": "关闭",
  "Close details": "关闭详情",
  "Delete task": "删除任务",
  "Task title": "任务标题",
  "Add date": "添加日期",
  "Save Changes": "保存修改",
  "Delete List": "删除清单",
  "Cancel": "取消",
  "Sync once in the main window first.": "请先在主窗口同步一次。",
  "Last edited": "上次编辑",
  "Waiting for first sync": "等待首次同步",
  "Offline cache": "离线缓存",
  "Synced with Google Tasks": "已与 Google Tasks 同步",
  "Local prototype data. Google Tasks is optional for this screen.": "当前显示本地原型数据，此页面可选接入 Google Tasks。",
  "No archived or deleted tasks yet.": "暂时没有归档或已删除任务。",
  "Completed and deleted tasks are ordered by the latest action.": "已完成和已删除任务会按最近操作时间排序。",
  "Trash is empty.": "回收站为空。",
  "Trash": "回收站",
  "Created": "已创建",
  "Saving...": "保存中...",
  "Synced": "已同步",
  "Retry Save": "重试保存",
  "Save to Google": "保存到 Google",
  "No tasks": "暂无任务",
  "Your Lists": "你的清单",
  "List Color": "清单颜色",
  "Custom Picker": "自定义颜色",
  "Apply": "应用",
  "Danger Zone": "危险操作",
  "Expand sidebar": "展开侧边栏",
  "Collapse sidebar": "收起侧边栏",
  "New list name": "新清单名称",
  "Completed tasks are shown here. Deleted tasks are removed from Google Tasks immediately in this phase.": "这里展示已完成任务。当前阶段删除任务会立即从 Google Tasks 中移除。",
  "Deleted Google Tasks are removed immediately. Local trash is reserved for a later recycle-bin workflow.": "删除的 Google Tasks 任务会立即移除。本地回收站功能会在后续阶段补齐。",
  "Completed, archived, and deleted items are ordered by the latest action.": "已完成、已归档和已删除项目会按最近操作时间排序。",
  "Deleted tasks and notes are shown here with their source type.": "已删除的任务和笔记会带来源类型显示在这里。",
  "Prioritize current open tasks by dragging them between columns.": "拖动当前未完成任务，在看板中调整优先级。",
  "A calm monthly view for dates. Google Tasks due dates are date-only.": "按月查看任务日期。Google Tasks 的到期日仅支持日期，不支持具体时间。",
  "Google Calendar schedules also appear here.": "这里也会显示 Google Calendar 日程。",
  "All day": "全天",
  "Schedules this month": "本月日程",
  "No Google Calendar schedules in this month.": "这个月没有 Google Calendar 日程。",
  "Google Calendar sync needs additional permission. Please sign out and sign in again.": "Google Calendar 同步需要额外授权，请先退出登录再重新登录。",
  "Google Proxy": "Google 代理",
  "Use system proxy": "使用系统代理",
  "Follow the system proxy from Windows or your VPN": "跟随 Windows 或 VPN 的系统代理设置",
  "Custom HTTP proxy": "自定义 HTTP 代理",
  "Enter a proxy address manually, for example http://127.0.0.1:7890": "手动填写代理地址，例如 http://127.0.0.1:7890",
  "No proxy": "不使用代理",
  "Connect to Google services directly": "直接连接 Google 服务",
  "HTTP proxy URL": "HTTP 代理地址",
  "Latest Google error details": "最近一次 Google 错误详情",
  "Please enter a 6-digit HEX color, for example 3B82F6.": "请输入 6 位 HEX 色值，例如 3B82F6。",
  "Tasks sync automatically after sign-in. You can also sync manually.": "登录后会自动同步任务；也可以手动同步。",
  "Click Sign in to open the system browser for authorization.": "点击登录会打开系统浏览器完成授权。",
  "Click an input, then press a new key combination to replace it.": "点击输入框后，直接按下新的组合键即可替换。",
  ". A Google Tasks desktop client prototype built with Tauri, React, TypeScript, and Tailwind CSS.": "。一个使用 Tauri、React、TypeScript 和 Tailwind CSS 构建的 Google Tasks 桌面客户端原型。",
};

const reverseUiDictionary = Object.fromEntries(
  Object.entries(uiDictionary).map(([english, chinese]) => [chinese, english]),
);

const listToneClasses = [
  "bg-blue-50 text-blue-950 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-100",
  "bg-pink-50 text-pink-950 hover:bg-pink-100 dark:bg-pink-950/30 dark:text-pink-100",
  "bg-emerald-50 text-emerald-950 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-100",
  "bg-amber-50 text-amber-950 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-100",
  "bg-violet-50 text-violet-950 hover:bg-violet-100 dark:bg-violet-950/30 dark:text-violet-100",
  "bg-orange-50 text-orange-950 hover:bg-orange-100 dark:bg-orange-950/30 dark:text-orange-100",
  "bg-cyan-50 text-cyan-950 hover:bg-cyan-100 dark:bg-cyan-950/30 dark:text-cyan-100",
  "bg-rose-50 text-rose-950 hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-100",
];

const listPillToneClasses = [
  "bg-blue-100 text-blue-950 dark:bg-blue-900/60 dark:text-blue-100",
  "bg-pink-100 text-pink-950 dark:bg-pink-900/60 dark:text-pink-100",
  "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-100",
  "bg-amber-100 text-amber-950 dark:bg-amber-900/60 dark:text-amber-100",
  "bg-violet-100 text-violet-950 dark:bg-violet-900/60 dark:text-violet-100",
  "bg-orange-100 text-orange-950 dark:bg-orange-900/60 dark:text-orange-100",
  "bg-cyan-100 text-cyan-950 dark:bg-cyan-900/60 dark:text-cyan-100",
  "bg-rose-100 text-rose-950 dark:bg-rose-900/60 dark:text-rose-100",
];

const listLabelToneClasses = [
  "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-200",
  "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-400/30 dark:bg-pink-400/10 dark:text-pink-200",
  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
  "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-200",
  "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-200",
  "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-200",
  "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200",
];

const listColorSwatches = [
  { name: "Blue", hex: "#3B82F6", className: "bg-blue-500" },
  { name: "Pink", hex: "#EC4899", className: "bg-badge-pink" },
  { name: "Emerald", hex: "#34D399", className: "bg-badge-emerald" },
  { name: "Amber", hex: "#F59E0B", className: "bg-warning" },
  { name: "Violet", hex: "#8B5CF6", className: "bg-badge-violet" },
  { name: "Orange", hex: "#FB923C", className: "bg-badge-orange" },
  { name: "Cyan", hex: "#06B6D4", className: "bg-cyan-500" },
  { name: "Rose", hex: "#F43F5E", className: "bg-rose-500" },
];

const noteColorOptions: Array<{ id: NoteColor; label: string; dotClassName: string }> = [
  { id: "default", label: "Default", dotClassName: "bg-white" },
  { id: "amber", label: "Amber", dotClassName: "bg-amber-300" },
  { id: "emerald", label: "Emerald", dotClassName: "bg-emerald-300" },
  { id: "violet", label: "Violet", dotClassName: "bg-violet-300" },
  { id: "cyan", label: "Cyan", dotClassName: "bg-cyan-300" },
  { id: "rose", label: "Rose", dotClassName: "bg-rose-300" },
];

function noteColorClass(color: NoteColor) {
  const classes: Record<NoteColor, string> = {
    default: "bg-surface-card dark:bg-surface-dark-elevated",
    amber: "bg-amber-50 dark:bg-amber-400/10",
    emerald: "bg-emerald-50 dark:bg-emerald-400/10",
    violet: "bg-violet-50 dark:bg-violet-400/10",
    cyan: "bg-cyan-50 dark:bg-cyan-400/10",
    rose: "bg-rose-50 dark:bg-rose-400/10",
  };
  return classes[color];
}

function normalizeHexColor(value: string) {
  const normalized = value.trim().replace("#", "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? `#${normalized}` : null;
}

function hexToRgb(hex: string) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) {
    return null;
  }
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function customColorStyle(hex?: string, variant: "card" | "pill" | "label" | "dot" = "card"): CSSProperties | undefined {
  const rgb = hexToRgb(hex ?? "");
  if (!rgb) {
    return undefined;
  }
  if (variant === "dot") {
    return { backgroundColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` };
  }
  if (variant === "label") {
    return {
      backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14)`,
      borderColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.42)`,
      color: `rgb(${Math.max(0, rgb.r - 80)}, ${Math.max(0, rgb.g - 80)}, ${Math.max(0, rgb.b - 80)})`,
    };
  }
  if (variant === "pill") {
    return {
      backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.24)`,
      color: "#111827",
    };
  }
  return {
    backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`,
    color: "#111827",
  };
}

function listToneClass(
  listId: string,
  lists: TaskListSummary[],
  listColorMap: Record<string, number>,
  listCustomColorMap: ListCustomColorMap = {},
  pill = false,
) {
  if (listCustomColorMap[listId]) {
    return "border-hairline bg-canvas text-ink dark:border-surface-dark-elevated dark:bg-surface-dark dark:text-on-dark";
  }
  const index = listColorMap[listId] ?? Math.max(0, lists.findIndex((list) => list.id === listId));
  const tones = pill ? listPillToneClasses : listToneClasses;
  return tones[index % tones.length];
}

function listLabelToneClass(
  listId: string,
  lists: TaskListSummary[],
  listColorMap: Record<string, number>,
  listCustomColorMap: ListCustomColorMap = {},
) {
  if (listCustomColorMap[listId]) {
    return "";
  }
  const index = listColorMap[listId] ?? Math.max(0, lists.findIndex((list) => list.id === listId));
  return listLabelToneClasses[index % listLabelToneClasses.length];
}

function dueLabelToneClass(task: Task) {
  if (task.dueLabel === "past") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200";
  }
  if (task.dueLabel === "today") {
    return "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-200";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200";
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

function resolveTheme(theme: ThemeMode): ResolvedThemeMode {
  if (theme !== "system") {
    return theme;
  }
  if (typeof window === "undefined") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function createDefaultQuickDraft(listId: string): QuickTaskDraft {
  return {
    title: "",
    listId,
    dueLabel: "today",
    estimate: "30m",
    notes: "",
  };
}

function localDate(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function nextMondayDate() {
  const date = new Date();
  const day = date.getDay();
  const offset = day === 1 ? 7 : (8 - day) % 7 || 7;
  date.setDate(date.getDate() + offset);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dueDateFromGoogle(due?: string | null) {
  return due ? due.slice(0, 10) : undefined;
}

function dueLabelFromDate(date?: string): SmartView | undefined {
  if (!date) {
    return undefined;
  }
  if (date === localDate(0)) {
    return "today";
  }
  if (date === localDate(1)) {
    return "tomorrow";
  }
  if (date < localDate(0)) {
    return "past";
  }
  return "all";
}

function dueTextFromDate(date?: string) {
  if (!date) {
    return undefined;
  }
  if (date === localDate(0)) {
    return "Today";
  }
  if (date === localDate(1)) {
    return "Tomorrow";
  }
  return date;
}

function displayDueText(dueText: string, language: LanguageMode) {
  if (dueText === "Today") {
    return uiText(language, "Today", "今天");
  }
  if (dueText === "Tomorrow") {
    return uiText(language, "Tomorrow", "明天");
  }
  if (dueText === "Past") {
    return uiText(language, "Past", "过期");
  }
  return dueText;
}

function dueForGoogle(task: Partial<Task>, patch: Partial<Task>) {
  const dueText = Object.prototype.hasOwnProperty.call(patch, "dueText") ? patch.dueText : task.dueText;
  const dueLabel = Object.prototype.hasOwnProperty.call(patch, "dueLabel") ? patch.dueLabel : task.dueLabel;

  if (!dueText) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueText)) {
    return dueText;
  }
  if (dueLabel === "all") {
    return "";
  }
  if (dueText === "Today" || dueLabel === "today") {
    return localDate(0);
  }
  if (dueText === "Tomorrow" || dueLabel === "tomorrow") {
    return localDate(1);
  }
  if (dueText === "Past" || dueLabel === "past") {
    return localDate(-1);
  }
  return "";
}

function patchValue<T, K extends keyof T>(source: Partial<T>, fallback: T, key: K): T[K] {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] as T[K] : fallback[key];
}

function mergeTaskPatch(task: Task, patch: Partial<Task>) {
  const next = { ...task };
  (Object.keys(patch) as Array<keyof Task>).forEach((key) => {
    next[key] = patch[key] as never;
  });
  return next;
}

function splitTaskNotes(notes?: string | null) {
  const value = notes ?? "";
  const patterns = [
    /^Reminder time:\s*([0-2]\d:[0-5]\d)\s*(?:\n\n?([\s\S]*))?$/i,
    /^提醒时间[:：]\s*([0-2]\d:[0-5]\d)\s*(?:\n\n?([\s\S]*))?$/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      return {
        reminderTime: match[1],
        notes: match[2]?.trim() ?? "",
      };
    }
  }

  return {
    reminderTime: undefined,
    notes: value,
  };
}

function composeTaskNotes(notes: string, reminderTime?: string | null, language: LanguageMode = "en") {
  const trimmedNotes = notes.trim();
  if (!reminderTime) {
    return trimmedNotes || undefined;
  }
  const reminderLine = language === "zh" ? `提醒时间：${reminderTime}` : `Reminder time: ${reminderTime}`;
  return trimmedNotes ? `${reminderLine}\n\n${trimmedNotes}` : reminderLine;
}

function inputDateValue(task: Task) {
  if (!task.dueText) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(task.dueText)) {
    return task.dueText;
  }
  if (task.dueText === "Today" || task.dueLabel === "today") {
    return localDate(0);
  }
  if (task.dueText === "Tomorrow" || task.dueLabel === "tomorrow") {
    return localDate(1);
  }
  if (task.dueText === "Past" || task.dueLabel === "past") {
    return localDate(-1);
  }
  return "";
}

function mapGoogleLists(remoteLists: GoogleTaskListDto[]): TaskListSummary[] {
  return remoteLists.map((list, index) => {
    const preset = mockLists[index % mockLists.length];
    return {
      id: list.id,
      name: list.title,
      icon: preset.icon,
      iconClassName: preset.iconClassName,
    };
  });
}

function mapGoogleTasks(remoteTasks: GoogleTaskDto[], taskPriorityMap: TaskPriorityMap = {}) {
  const sorted = [...remoteTasks].sort((first, second) =>
    (first.position ?? "").localeCompare(second.position ?? ""),
  );
  const ids = new Set(sorted.map((task) => task.id));
  const subtasksByParent = new Map<string, Subtask[]>();

  sorted.forEach((task) => {
    if (!task.parent) {
      return;
    }
    const subtasks = subtasksByParent.get(task.parent) ?? [];
    subtasks.push({
      id: task.id,
      title: task.title || "Untitled task",
      completed: task.completed,
    });
    subtasksByParent.set(task.parent, subtasks);
  });

  return sorted
    .filter((task) => !task.parent || !ids.has(task.parent))
    .map<Task>((task) => {
      const dueDate = dueDateFromGoogle(task.due);
      const parsedNotes = splitTaskNotes(task.notes);
      return mergeTaskPriority({
        id: task.id,
        listId: task.task_list_id,
        title: task.title || "Untitled task",
        notes: parsedNotes.notes,
        reminderTime: parsedNotes.reminderTime,
        dueLabel: dueLabelFromDate(dueDate),
        dueText: dueTextFromDate(dueDate),
        completed: task.completed,
        completedAt: task.completed_at ?? undefined,
        createdAt: task.id.startsWith("local-") ? "Offline" : "Google Tasks",
        lastEdited: task.id.startsWith("local-") ? "pending sync" : "synced",
        subtasks: subtasksByParent.get(task.id) ?? [],
      }, taskPriorityMap);
    });
}

function secondsToDisplay(value?: string | null) {
  if (!value) {
    return undefined;
  }
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatMonthTitle(monthValue: string | undefined, language: LanguageMode) {
  const date = monthValue ? new Date(`${monthValue}-01T00:00:00`) : new Date();
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function calendarDateForEvent(event: CalendarEvent) {
  return event.start.slice(0, 10);
}

function calendarEventKey(event: CalendarEvent) {
  return `${event.calendar_id}::${event.id}`;
}

function calendarEventTimeValue(event: CalendarEvent) {
  if (event.all_day || !event.start.includes("T")) {
    return "";
  }
  const parsed = new Date(event.start);
  if (Number.isNaN(parsed.getTime())) {
    const match = event.start.match(/T(\d{2}:\d{2})/);
    return match?.[1] ?? "";
  }
  return [
    String(parsed.getHours()).padStart(2, "0"),
    String(parsed.getMinutes()).padStart(2, "0"),
  ].join(":");
}

function calendarEventDueLabel(event: CalendarEvent): SmartView {
  return dueLabelFromDate(calendarDateForEvent(event)) ?? "all";
}

function calendarEventOccursOnDate(event: CalendarEvent, date: string) {
  const startDate = event.start.slice(0, 10);
  const endDate = event.end?.slice(0, 10);

  if (event.all_day) {
    if (!endDate) {
      return startDate === date;
    }
    return date >= startDate && date < endDate;
  }

  if (!endDate) {
    return startDate === date;
  }

  return date >= startDate && date <= endDate;
}

function formatCalendarEventTime(event: CalendarEvent, language: LanguageMode) {
  if (event.all_day) {
    return uiText(language, "All day", "全天");
  }

  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) {
    return "";
  }

  const formatter = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return formatter.format(start);
}

function dayNumberForTask(task: Task) {
  if (!task.dueText) {
    return null;
  }
  if (task.dueText === "Today") {
    return new Date().getDate();
  }
  if (task.dueText === "Tomorrow") {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.getDate();
  }
  const parsed = new Date(task.dueText);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getDate();
}

function calendarDateForTask(task: Task) {
  if (!task.dueText) {
    return "";
  }
  if (task.dueText === "Today") {
    return localDate(0);
  }
  if (task.dueText === "Tomorrow") {
    return localDate(1);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(task.dueText)) {
    return task.dueText;
  }
  return "";
}

function taskSortTime(task: Task) {
  if (!task.dueText) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (task.dueText === "Past") {
    return new Date(localDate(-1)).getTime();
  }
  if (task.dueText === "Today") {
    return new Date(localDate(0)).getTime();
  }
  if (task.dueText === "Tomorrow") {
    return new Date(localDate(1)).getTime();
  }
  const parsed = new Date(task.dueText);
  return Number.isNaN(parsed.getTime()) ? Number.MAX_SAFE_INTEGER : parsed.getTime();
}

function sortTasksByTime(tasks: Task[]) {
  return [...tasks].sort((first, second) => {
    const byDue = taskSortTime(first) - taskSortTime(second);
    if (byDue !== 0) {
      return byDue;
    }
    return first.title.localeCompare(second.title);
  });
}

function recurrenceText(task: Task) {
  const recurrence = task.recurrence;
  if (!recurrence || recurrence.frequency === "none") {
    return "Does not repeat";
  }
  const interval = Math.max(1, recurrence.interval || 1);
  const unitMap: Record<TaskRecurrenceFrequency, string> = {
    none: "",
    daily: "day",
    weekly: "week",
    monthly: "month",
    yearly: "year",
  };
  const unit = unitMap[recurrence.frequency];
  const everyText = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
  return recurrence.endDate ? `${everyText} until ${recurrence.endDate}` : everyText;
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => loadThemeMode());
  const [language, setLanguage] = useState<LanguageMode>(() => {
    const saved = typeof window === "undefined" ? null : window.localStorage.getItem("googleTodoLanguage");
    return saved === "zh" ? "zh" : "en";
  });
  const resolvedTheme = resolveTheme(theme);
  const [lists, setLists] = useState<TaskListSummary[]>(mockLists);
  const [tasks, setTasks] = useState<Task[]>(mockTasks);
  const [notes, setNotes] = useState<Note[]>(() => loadNotes());
  const [activeView, setActiveView] = useState<WorkspaceView>("list");
  const [activeListId, setActiveListId] = useState("my-tasks");
  const [activeSmartView, setActiveSmartView] = useState<SmartView | null>("today");
  const [activeNoteFilter, setActiveNoteFilter] = useState<NoteFilter>("all");
  const [activeNoteLabel, setActiveNoteLabel] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState("");
  const [showCompleted, setShowCompleted] = useState(() =>
    loadBooleanPreference(SHOW_COMPLETED_TASKS_STORAGE_KEY, true),
  );
  const [showTaskCount, setShowTaskCount] = useState(() =>
    loadBooleanPreference(SHOW_TASK_COUNT_STORAGE_KEY, true),
  );
  const [showCollapsedSidebarBadges, setShowCollapsedSidebarBadges] = useState(() =>
    loadBooleanPreference("googleTodoShowCollapsedSidebarBadges", true),
  );
  const [expandSubtasks, setExpandSubtasks] = useState(() =>
    loadBooleanPreference(EXPAND_SUBTASKS_STORAGE_KEY, true),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(localDate(0).slice(0, 7));
  const [searchValue, setSearchValue] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [draftSubtaskTitle, setDraftSubtaskTitle] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manageListsOpen, setManageListsOpen] = useState(false);
  const [hotkeys, setHotkeys] = useState<HotkeyConfig>(() => loadHotkeys());
  const [listColorMap, setListColorMap] = useState<Record<string, number>>(() => loadListColorMap(mockLists));
  const [listCustomColorMap, setListCustomColorMap] = useState<ListCustomColorMap>(() => {
    if (typeof window === "undefined") {
      return {};
    }
    try {
      return JSON.parse(window.localStorage.getItem("googleTodoListCustomColors") ?? "{}");
    } catch {
      return {};
    }
  });
  const [taskPriorityMap, setTaskPriorityMap] = useState<TaskPriorityMap>(() => loadTaskPriorityMap());
  const [taskActivityHistory, setTaskActivityHistory] = useState<TaskActivityRecord[]>(() => loadTaskActivityHistory());
  const [noteActivityHistory, setNoteActivityHistory] = useState<NoteActivityRecord[]>(() => loadNoteActivityHistory());
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [googleProxySaving, setGoogleProxySaving] = useState(false);
  const [googleProxyMessage, setGoogleProxyMessage] = useState("Using system proxy");
  const [lastGoogleError, setLastGoogleError] = useState("");
  const [googleProxyConfig, setGoogleProxyConfig] = useState<GoogleProxyConfig>({
    mode: "system",
    url: "",
  });
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [startupSaving, setStartupSaving] = useState(false);
  const [startupMessage, setStartupMessage] = useState("Startup setting is off");
  const [launchMinimizedOnStart, setLaunchMinimizedOnStart] = useState(() =>
    loadBooleanPreference("googleTodoLaunchMinimizedOnStart"),
  );
  const [closeButtonBehavior, setCloseButtonBehavior] = useState<CloseButtonBehavior>(() =>
    loadCloseButtonBehavior(),
  );
  const [autoSyncMode, setAutoSyncMode] = useState<AutoSyncMode>(() => loadAutoSyncMode());
  const [calendarLists, setCalendarLists] = useState<GoogleCalendarListDto[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[] | null>(() =>
    loadSelectedCalendarIds(),
  );
  const [loadingCalendarLists, setLoadingCalendarLists] = useState(false);
  const [calendarListMessage, setCalendarListMessage] = useState("");
  const [usingGoogleData, setUsingGoogleData] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [offlineMode, setOfflineMode] = useState(false);
  const [syncMessage, setSyncMessage] = useState("Local mode");
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("Auto-sync enabled");
  const [quickDraft, setQuickDraft] = useState<QuickTaskDraft>(() =>
    createDefaultQuickDraft(activeListId),
  );
  const activeListIdRef = useRef(activeListId);
  const calendarMonthRef = useRef(calendarMonth);
  const languageRef = useRef(language);
  const resolvedThemeRef = useRef(resolvedTheme);
  const selectedCalendarIdsRef = useRef<string[] | null>(selectedCalendarIds);
  const taskPriorityMapRef = useRef(taskPriorityMap);
  const lastSyncedAtRef = useRef<string | null>(lastSyncedAt);
  const launchMinimizeAppliedRef = useRef(false);
  const syncLoopBusyRef = useRef(false);
  const syncLoopQueuedRef = useRef(false);
  const syncLoopQueuedListIdRef = useRef<string | undefined>(undefined);
  const localTaskOverridesRef = useRef<Map<string, Partial<Task>>>(new Map());

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const selectedCalendarEvent =
    calendarEvents.find((event) => calendarEventKey(event) === selectedCalendarEventId) ?? null;
  const googleReady = Boolean(authStatus?.signed_in && usingGoogleData);

  useEffect(() => {
    activeListIdRef.current = activeListId;
  }, [activeListId]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    calendarMonthRef.current = calendarMonth;
  }, [calendarMonth]);

  useEffect(() => {
    resolvedThemeRef.current = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    selectedCalendarIdsRef.current = selectedCalendarIds;
  }, [selectedCalendarIds]);

  useEffect(() => {
    taskPriorityMapRef.current = taskPriorityMap;
  }, [taskPriorityMap]);

  useEffect(() => {
    lastSyncedAtRef.current = lastSyncedAt;
  }, [lastSyncedAt]);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    window.localStorage.setItem("googleTodoLanguage", language);
    const dictionary = language === "zh" ? uiDictionary : reverseUiDictionary;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current as Text);
      current = walker.nextNode();
    }
    nodes.forEach((node) => {
      const value = node.nodeValue?.trim();
      if (!value) {
        return;
      }
      const translated = dictionary[value];
      if (translated) {
        node.nodeValue = node.nodeValue?.replace(value, translated) ?? translated;
      }
    });

    document.querySelectorAll<HTMLElement>("[placeholder],[title],[aria-label]").forEach((element) => {
      const placeholder = element.getAttribute("placeholder");
      if (placeholder && dictionary[placeholder]) {
        element.setAttribute("placeholder", dictionary[placeholder]);
      }

      const title = element.getAttribute("title");
      if (title && dictionary[title]) {
        element.setAttribute("title", dictionary[title]);
      }

      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel && dictionary[ariaLabel]) {
        element.setAttribute("aria-label", dictionary[ariaLabel]);
      }
    });
  }, [activeView, language, manageListsOpen, selectedCalendarEventId, selectedTaskId, settingsOpen]);

  useEffect(() => {
    window.localStorage.setItem("googleTodoHotkeys", JSON.stringify(hotkeys));
  }, [hotkeys]);

  useEffect(() => {
    window.localStorage.setItem("googleTodoListColors", JSON.stringify(listColorMap));
  }, [listColorMap]);

  useEffect(() => {
    window.localStorage.setItem("googleTodoListCustomColors", JSON.stringify(listCustomColorMap));
  }, [listCustomColorMap]);

  useEffect(() => {
    window.localStorage.setItem("googleTodoTaskPriorities", JSON.stringify(taskPriorityMap));
  }, [taskPriorityMap]);

  useEffect(() => {
    setTasks((current) => current.map((task) => mergeTaskPriority(task, taskPriorityMap)));
  }, [taskPriorityMap]);

  useEffect(() => {
    window.localStorage.setItem("googleTodoTaskActivityHistory", JSON.stringify(taskActivityHistory));
  }, [taskActivityHistory]);

  useEffect(() => {
    window.localStorage.setItem(NOTE_ACTIVITY_HISTORY_STORAGE_KEY, JSON.stringify(noteActivityHistory));
  }, [noteActivityHistory]);

  useEffect(() => {
    saveBooleanPreference(SHOW_COMPLETED_TASKS_STORAGE_KEY, showCompleted);
  }, [showCompleted]);

  useEffect(() => {
    saveBooleanPreference(SHOW_TASK_COUNT_STORAGE_KEY, showTaskCount);
  }, [showTaskCount]);

  useEffect(() => {
    saveBooleanPreference("googleTodoShowCollapsedSidebarBadges", showCollapsedSidebarBadges);
  }, [showCollapsedSidebarBadges]);

  useEffect(() => {
    saveBooleanPreference(EXPAND_SUBTASKS_STORAGE_KEY, expandSubtasks);
  }, [expandSubtasks]);

  useEffect(() => {
    saveBooleanPreference("googleTodoLaunchMinimizedOnStart", launchMinimizedOnStart);
  }, [launchMinimizedOnStart]);

  useEffect(() => {
    window.localStorage.setItem(CLOSE_BUTTON_BEHAVIOR_STORAGE_KEY, closeButtonBehavior);
  }, [closeButtonBehavior]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onCloseRequested((event) => {
        if (closeButtonBehavior !== "minimizeToTray") {
          return;
        }
        event.preventDefault();
        void invoke("hide_main_window_to_tray").catch(() => undefined);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      unlisten?.();
    };
  }, [closeButtonBehavior]);

  useEffect(() => {
    window.localStorage.setItem("googleTodoAutoSyncIntervalMinutes", autoSyncMode);
  }, [autoSyncMode]);

  useEffect(() => {
    if (selectedCalendarIds === null) {
      window.localStorage.removeItem("googleTodoSelectedCalendarIds");
      return;
    }
    window.localStorage.setItem("googleTodoSelectedCalendarIds", JSON.stringify(selectedCalendarIds));
  }, [selectedCalendarIds]);

  useEffect(() => {
    if (launchMinimizeAppliedRef.current) {
      return;
    }
    launchMinimizeAppliedRef.current = true;
    if (!launchMinimizedOnStart) {
      return;
    }

    const timer = window.setTimeout(() => {
      void invoke("hide_main_window_to_tray").catch(() => undefined);
    }, 450);

    return () => window.clearTimeout(timer);
  }, [launchMinimizedOnStart]);

  useEffect(() => {
    isAutostartEnabled()
      .then((enabled) => {
        setStartupEnabled(enabled);
        setStartupMessage(
          enabled
            ? uiText(language, "Launch at startup is enabled", "已开启开机自启动")
            : uiText(language, "Launch at startup is disabled", "未开启开机自启动"),
        );
      })
      .catch((error) => {
        setStartupMessage(`${uiText(language, "Failed to read startup setting: ", "读取开机自启动设置失败：")}${String(error)}`);
      });
  }, [language]);

  const changeStartupEnabled = async (enabled: boolean) => {
    setStartupSaving(true);
    setStartupMessage(uiText(language, "Saving startup setting...", "正在保存开机自启动设置..."));
    try {
      if (enabled) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }
      const nextEnabled = await isAutostartEnabled();
      setStartupEnabled(nextEnabled);
      setStartupMessage(
        nextEnabled
          ? uiText(language, "Launch at startup is enabled", "已开启开机自启动")
          : uiText(language, "Launch at startup is disabled", "未开启开机自启动"),
      );
    } catch (error) {
      setStartupMessage(`${uiText(language, "Failed to save startup setting: ", "保存开机自启动设置失败：")}${String(error)}`);
    } finally {
      setStartupSaving(false);
    }
  };

  const changeLaunchMinimizedOnStart = (enabled: boolean) => {
    setLaunchMinimizedOnStart(enabled);
  };

  const changeCloseButtonBehavior = (behavior: CloseButtonBehavior) => {
    setCloseButtonBehavior(behavior);
  };

  useEffect(() => {
    setSaveState("idle");
    setSaveMessage(uiText(language, "Auto-sync enabled", "已启用自动同步"));
  }, [language, selectedCalendarEventId, selectedNoteId, selectedTaskId]);

  const activeTitle = useMemo(() => {
    if (activeSmartView) {
      return smartViewTitle(activeSmartView, language);
    }
    return lists.find((list) => list.id === activeListId)?.name ?? "My Tasks";
  }, [activeListId, activeSmartView, language, lists]);

  const activeSubtitle = useMemo(() => {
    if (activeSmartView) {
      return smartViewSubtitle(activeSmartView, language);
    }
    if (usingGoogleData) {
      const syncText = lastSyncedAt
        ? uiText(language, `Last synced ${secondsToDisplay(lastSyncedAt)}`, `上次同步：${secondsToDisplay(lastSyncedAt)}`)
        : uiText(language, "Waiting for first sync", "等待首次同步");
      const pendingText = pendingCount > 0
        ? uiText(language, `  ${pendingCount} pending`, `  ${pendingCount} 条待同步`)
        : "";
      return `${uiText(language, offlineMode ? "Offline cache" : "Synced with Google Tasks", offlineMode ? "离线缓存" : "已与 Google Tasks 同步")}  ${syncText}${pendingText}`;
    }
    return uiText(language, "Local prototype data. Google Tasks is optional for this screen.", "当前显示本地原型数据，此页面可选接入 Google Tasks。");
  }, [activeSmartView, language, lastSyncedAt, offlineMode, pendingCount, usingGoogleData]);

  const scopedTasks = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();
    const byScope =
      activeSmartView === "all"
        ? tasks
        : activeSmartView
          ? tasks.filter((task) => task.dueLabel === activeSmartView)
          : tasks.filter((task) => task.listId === activeListId);

    if (!normalizedSearch) {
      return sortTasksByTime(byScope);
    }

    return sortTasksByTime(byScope.filter((task) => {
      const listName = lists.find((list) => list.id === task.listId)?.name ?? "";
      return [task.title, task.notes, listName, ...task.subtasks.map((subtask) => subtask.title)]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    }));
  }, [activeListId, activeSmartView, lists, searchValue, tasks]);

  const visibleTasks = useMemo(() => {
    return showCompleted ? scopedTasks : scopedTasks.filter((task) => !task.completed);
  }, [scopedTasks, showCompleted]);

  const visibleListItems = useMemo<TaskListItem[]>(() => {
    const taskItems = visibleTasks.map((task) => ({
      kind: "task" as const,
      id: task.id,
      task,
    }));

    if (!activeSmartView) {
      return taskItems;
    }

    const normalizedSearch = searchValue.trim().toLowerCase();
    const eventItems = calendarEvents
      .filter((event) => {
        const label = calendarEventDueLabel(event);
        return activeSmartView === "all" || label === activeSmartView;
      })
      .filter((event) => {
        if (!normalizedSearch) {
          return true;
        }
        return [event.title, event.description ?? "", event.calendar_name, event.location ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      })
      .map((event) => ({
        kind: "calendar" as const,
        id: calendarEventKey(event),
        event,
      }));

    return [...taskItems, ...eventItems].sort((first, second) => {
      const firstTime =
        first.kind === "task"
          ? taskSortTime(first.task)
          : new Date(first.event.start).getTime() || new Date(calendarDateForEvent(first.event)).getTime();
      const secondTime =
        second.kind === "task"
          ? taskSortTime(second.task)
          : new Date(second.event.start).getTime() || new Date(calendarDateForEvent(second.event)).getTime();
      return firstTime - secondTime;
    });
  }, [activeSmartView, calendarEvents, searchValue, visibleTasks]);

  const taskActivityItems = useMemo(() => {
    const historyKeys = new Set(taskActivityHistory.map((record) => `${record.action}:${record.taskId}`));
    const fallbackCompleted = tasks
      .filter((task) => task.completed && !historyKeys.has(`completed:${task.id}`))
      .map<TaskActivityRecord>((task, index) => ({
        id: `fallback-completed-${task.id}`,
        taskId: task.id,
        action: "completed",
        operatedAt: activityTimestampForCompletedTask(task, index),
        taskSnapshot: task,
      }));

    return [...taskActivityHistory, ...fallbackCompleted].sort((first, second) => {
      const firstTime = parseActivityDate(first.operatedAt)?.getTime() ?? 0;
      const secondTime = parseActivityDate(second.operatedAt)?.getTime() ?? 0;
      return (Number.isNaN(secondTime) ? 0 : secondTime) - (Number.isNaN(firstTime) ? 0 : firstTime);
    });
  }, [taskActivityHistory, tasks]);

  const utilityActivityItems = useMemo<UtilityActivityItem[]>(() => {
    const taskItems: UtilityActivityItem[] = taskActivityItems.map((record) => ({
      kind: "task",
      id: record.id,
      action: record.action,
      operatedAt: record.operatedAt,
      taskSnapshot: record.taskSnapshot,
    }));
    const noteItems: UtilityActivityItem[] = noteActivityHistory.map((record) => ({
      kind: "note",
      id: record.id,
      action: record.action,
      operatedAt: record.operatedAt,
      noteSnapshot: record.noteSnapshot,
    }));
    return [...taskItems, ...noteItems].sort((first, second) => {
      const firstTime = parseActivityDate(first.operatedAt)?.getTime() ?? 0;
      const secondTime = parseActivityDate(second.operatedAt)?.getTime() ?? 0;
      return secondTime - firstTime;
    });
  }, [noteActivityHistory, taskActivityItems]);

  const noteLabelSummaries = useMemo(() => {
    const counts = new Map<string, number>();
    notes
      .filter((note) => !note.archived)
      .forEach((note) => {
        note.labels.forEach((label) => {
          counts.set(label, (counts.get(label) ?? 0) + 1);
        });
      });
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((first, second) => first.label.localeCompare(second.label));
  }, [notes]);

  const visibleNotes = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();
    return notes
      .filter((note) => {
        if (activeNoteLabel && !note.labels.includes(activeNoteLabel)) {
          return false;
        }
        if (activeNoteFilter === "archive") {
          return note.archived;
        }
        if (note.archived) {
          return false;
        }
        if (activeNoteFilter === "pinned") {
          return note.pinned;
        }
        if (activeNoteFilter === "reminders") {
          return Boolean(note.reminderDate);
        }
        return true;
      })
      .filter((note) => {
        if (!normalizedSearch) {
          return true;
        }
        return [note.title, note.body, ...note.labels]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      })
      .sort((first, second) => {
        if (first.pinned !== second.pinned) {
          return first.pinned ? -1 : 1;
        }
        const firstEdited = parseActivityDate(first.lastEdited)?.getTime() ?? 0;
        const secondEdited = parseActivityDate(second.lastEdited)?.getTime() ?? 0;
        return secondEdited - firstEdited;
      });
  }, [activeNoteFilter, activeNoteLabel, notes, searchValue]);

  const applySnapshot = (
    snapshot: CachedSnapshot,
    message?: string,
    preferredListId?: string,
    preferredTaskId?: string,
  ) => {
    if (snapshot.task_lists.length === 0 && snapshot.tasks.length === 0) {
      return;
    }

    const nextLists = mapGoogleLists(snapshot.task_lists);
    const nextTasks = mapGoogleTasks(snapshot.tasks, taskPriorityMapRef.current);
    const localTaskOverrides = new Map(localTaskOverridesRef.current);
    const targetListId = preferredListId ?? activeListId;
    const nextActiveListId = nextLists.some((list) => list.id === targetListId)
      ? targetListId
      : nextLists[0]?.id ?? "";

    startTransition(() => {
      setLists(nextLists);
      setListColorMap((current) => ({
        ...Object.fromEntries(nextLists.map((list, index) => [list.id, current[list.id] ?? index])),
      }));
      setTasks((current) => {
        const currentById = new Map(current.map((task) => [task.id, task]));
        return nextTasks.map((task) => {
          const override = localTaskOverrides.get(task.id);
          if (!override) {
            return task;
          }
          return mergeTaskPatch({ ...task, completedAt: currentById.get(task.id)?.completedAt ?? task.completedAt }, override);
        });
      });
      setUsingGoogleData(true);
      setActiveListId(nextActiveListId);
      setSelectedTaskId((current) =>
        preferredTaskId && nextTasks.some((task) => task.id === preferredTaskId)
          ? preferredTaskId
          : nextTasks.some((task) => task.id === current)
          ? current
          : "",
      );
      setLastSyncedAt(snapshot.last_synced_at ?? null);
      setPendingCount(snapshot.pending_count);
      setOfflineMode(snapshot.offline);
      if (message) {
        setSyncMessage(message);
      }
    });
  };

  const applySyncResult = (result: SyncResult, preferredListId?: string) => {
    const nextLists = mapGoogleLists(result.snapshot.task_lists);
    const nextTasks = mapGoogleTasks(result.snapshot.tasks, taskPriorityMapRef.current);
    const localTaskOverrides = new Map(localTaskOverridesRef.current);
    const nextActiveListId =
      preferredListId && nextLists.some((list) => list.id === preferredListId)
        ? preferredListId
        : nextLists[0]?.id ?? "";

    startTransition(() => {
      if (nextLists.length > 0 || nextTasks.length > 0) {
        setLists(nextLists);
        setListColorMap((current) => ({
          ...Object.fromEntries(nextLists.map((list, index) => [list.id, current[list.id] ?? index])),
        }));
        setTasks((current) => {
          const currentById = new Map(current.map((task) => [task.id, task]));
          return nextTasks.map((task) => {
            const override = localTaskOverrides.get(task.id);
            if (!override) {
              return task;
            }
            return mergeTaskPatch({ ...task, completedAt: currentById.get(task.id)?.completedAt ?? task.completedAt }, override);
          });
        });
        setUsingGoogleData(true);
        setActiveListId(nextActiveListId);
        setSelectedTaskId((current) => (nextTasks.some((task) => task.id === current) ? current : ""));
      }

      setLastSyncedAt(result.snapshot.last_synced_at ?? null);
      setPendingCount(result.snapshot.pending_count);
      setOfflineMode(result.status === "offline" || result.snapshot.offline);
      setSyncMessage(result.message);
      if (result.status === "ok" && result.snapshot.pending_count === 0) {
        localTaskOverridesRef.current.clear();
      }
      if (result.status !== "ok") {
        setLastGoogleError(result.message);
      }
      if (result.status === "auth_required") {
        void handleInvalidGoogleAuth(result.message);
      }
    });
  };

  const isInvalidGoogleAuthError = (error: unknown) => {
    const message = String(error).toLowerCase();
    return (
      message.includes("invalid_grant") ||
      message.includes("expired or revoked") ||
      message.includes("authorization expired")
    );
  };

  const handleInvalidGoogleAuth = async (error: unknown) => {
    if (!isInvalidGoogleAuthError(error)) {
      return false;
    }

    const message = uiText(
      languageRef.current,
      "Google authorization expired or was revoked. Please sign in again.",
      "Google 授权已过期或已被撤销，请重新登录。",
    );

    try {
      const status = await googleTasksApi.forgetInvalidAuth();
      setAuthStatus(status);
    } catch {
      setAuthStatus((current) =>
        current ? { ...current, signed_in: false } : { configured: true, signed_in: false },
      );
    }

    setGoogleSyncing(false);
    setCalendarEvents([]);
    setCalendarLists([]);
    setCalendarListMessage(message);
    setSyncMessage(message);
    setLastGoogleError(`${message} ${String(error)}`);
    return true;
  };

  const refreshGoogleData = async (preferredListId?: string) => {
    setGoogleSyncing(true);
    setSyncMessage(uiText(language, "Syncing with Google Tasks...", "正在同步 Google Tasks..."));
    setLastGoogleError("");
    try {
      const result = await syncApi.syncNow();
      applySyncResult(result, preferredListId);
    } catch (error) {
      if (await handleInvalidGoogleAuth(error)) {
        return;
      }
      const message = `${uiText(language, "Sync failed: ", "同步失败：")}${String(error)}`;
      setSyncMessage(message);
      setLastGoogleError(message);
    } finally {
      setGoogleSyncing(false);
    }
  };

  const refreshCalendarEvents = async (monthValue = calendarMonthRef.current) => {
    if (!authStatus?.signed_in) {
      setCalendarEvents([]);
      return;
    }

    try {
      const remoteEvents = await googleTasksApi.calendarEvents(monthValue, selectedCalendarIdsRef.current);
      startTransition(() => {
        setCalendarEvents(remoteEvents);
      });
    } catch (error) {
      if (await handleInvalidGoogleAuth(error)) {
        return;
      }
      const message = String(error);
      if (message.includes("403")) {
        setSyncMessage(
          uiText(
            languageRef.current,
            "Google Calendar sync needs additional permission. Please sign out and sign in again.",
            "Google Calendar 同步需要额外授权，请先退出登录再重新登录。",
          ),
        );
      }
    }
  };

  const refreshCalendarLists = async () => {
    if (!authStatus?.signed_in) {
      setCalendarLists([]);
      setCalendarListMessage(uiText(languageRef.current, "Sign in to Google first", "请先登录 Google"));
      return;
    }

    setLoadingCalendarLists(true);
    setCalendarListMessage("");
    try {
      const remoteLists = await googleTasksApi.calendarLists();
      setCalendarLists(remoteLists);
      setCalendarListMessage(
        remoteLists.length > 0
          ? uiText(languageRef.current, "Calendar list loaded", "日历清单已加载")
          : uiText(languageRef.current, "No calendars returned from Google", "Google 未返回可同步的日历"),
      );
    } catch (error) {
      if (await handleInvalidGoogleAuth(error)) {
        return;
      }
      const message = `${uiText(languageRef.current, "Failed to load calendars: ", "加载日历清单失败：")}${String(error)}`;
      setCalendarListMessage(message);
      setLastGoogleError(message);
    } finally {
      setLoadingCalendarLists(false);
    }
  };

  const refreshGoogleWorkspaceData = async (preferredListId?: string) => {
    if (syncLoopBusyRef.current) {
      syncLoopQueuedRef.current = true;
      syncLoopQueuedListIdRef.current = preferredListId ?? syncLoopQueuedListIdRef.current;
      setSyncMessage(uiText(languageRef.current, "Sync already running. Next changes are queued.", "同步正在进行中，后续修改已排队。"));
      return;
    }

    syncLoopBusyRef.current = true;
    let nextPreferredListId = preferredListId;
    try {
      do {
        syncLoopQueuedRef.current = false;
        syncLoopQueuedListIdRef.current = undefined;
        await refreshGoogleData(nextPreferredListId);
        await refreshCalendarEvents(calendarMonthRef.current);
        nextPreferredListId = syncLoopQueuedListIdRef.current ?? activeListIdRef.current;
      } while (syncLoopQueuedRef.current);
    } finally {
      syncLoopBusyRef.current = false;
    }
  };

  useEffect(() => {
    syncApi
      .cachedSnapshot()
      .then((snapshot) => applySnapshot(snapshot, uiText(language, "Loaded local cache", "已加载本地缓存")))
      .catch(() => setSyncMessage(uiText(language, "Failed to load local cache", "加载本地缓存失败")));

    googleTasksApi
      .authStatus()
      .then((status) => {
        setAuthStatus(status);
        if (status.signed_in) {
          setSyncMessage(uiText(language, "Signed in. Syncing with Google Tasks...", "已登录，正在同步 Google Tasks..."));
          void refreshGoogleWorkspaceData();
        } else {
          setCalendarEvents([]);
          setSyncMessage(uiText(language, "Not signed in to Google", "尚未登录 Google"));
        }
      })
      .catch(() => {
        setAuthStatus({ configured: false, signed_in: false });
        setSyncMessage(uiText(language, "Unable to read Google auth status", "无法读取 Google 登录状态"));
      });

    googleTasksApi
      .proxyConfig()
      .then((config) => {
        setGoogleProxyConfig(config);
        setGoogleProxyMessage(
          config.mode === "custom"
            ? uiText(language, `Proxy: ${config.url}`, `当前代理：${config.url}`)
            : config.mode === "none"
              ? uiText(language, "Proxy disabled", "当前不使用代理")
              : uiText(language, "Using system proxy", "当前使用系统代理"),
        );
      })
      .catch(() => setGoogleProxyMessage(uiText(language, "Failed to read proxy config", "读取代理配置失败")));
  }, [language]);

  useEffect(() => {
    if (!authStatus?.signed_in) {
      setCalendarEvents([]);
      return;
    }
    void refreshCalendarEvents(calendarMonth);
  }, [authStatus?.signed_in, calendarMonth, selectedCalendarIds]);

  useEffect(() => {
    if (!authStatus?.signed_in) {
      setCalendarLists([]);
      return;
    }
    if (settingsOpen || calendarLists.length === 0) {
      void refreshCalendarLists();
    }
  }, [authStatus?.signed_in, settingsOpen]);

  useEffect(() => {
    if (!authStatus?.signed_in) {
      return;
    }
    if (autoSyncMode === "off") {
      return;
    }

    const intervalMinutes = Number(autoSyncMode);

    const timer = window.setInterval(() => {
      void refreshGoogleWorkspaceData(activeListIdRef.current);
    }, intervalMinutes * 60 * 1000);

    return () => window.clearInterval(timer);
  }, [authStatus?.signed_in, autoSyncMode]);

  useEffect(() => {
    if (!authStatus?.signed_in || autoSyncMode === "off") {
      return;
    }

    const intervalMs = Number(autoSyncMode) * 60 * 1000;
    const syncIfStale = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      const lastSyncedAt = lastSyncedAtRef.current;
      const lastSyncedMs = lastSyncedAt ? Number(lastSyncedAt) * 1000 : 0;
      const syncIsStale = !lastSyncedMs || Date.now() - lastSyncedMs >= intervalMs;
      if (syncIsStale) {
        void refreshGoogleWorkspaceData(activeListIdRef.current);
      }
    };

    window.addEventListener("focus", syncIfStale);
    document.addEventListener("visibilitychange", syncIfStale);

    return () => {
      window.removeEventListener("focus", syncIfStale);
      document.removeEventListener("visibilitychange", syncIfStale);
    };
  }, [authStatus?.signed_in, autoSyncMode]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen("google-todo://task-created", async () => {
      if (!disposed) {
        try {
          const snapshot = await syncApi.cachedSnapshot();
          applySnapshot(snapshot, "已写入本地缓存");
        } catch {
          setSyncMessage("任务已创建，但本地缓存刷新失败");
        }
      }
    }, { target: "main" })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [activeListId]);

  const openQuickAddWindow = async () => {
    try {
      const existingWindow = await WebviewWindow.getByLabel(QUICK_ADD_WINDOW_LABEL);
      if (existingWindow) {
        const visible = await existingWindow.isVisible();
        if (visible) {
          await existingWindow.hide();
          return;
        }
        await existingWindow.show();
        await existingWindow.setFocus();
        return;
      }

      const quickAddWindow = new WebviewWindow(QUICK_ADD_WINDOW_LABEL, {
        url: `/quick-add?listId=${encodeURIComponent(activeListIdRef.current)}&theme=${resolvedThemeRef.current}&lang=${languageRef.current}`,
        title: "Quick Add Task",
        width: 680,
        height: 390,
        minWidth: 560,
        minHeight: 340,
        transparent: true,
        decorations: false,
        resizable: false,
        shadow: false,
        focus: true,
        center: true,
      });
      quickAddWindow.once("tauri://error", (error) => {
        setSyncMessage(`快捷录入窗口创建失败：${String(error.payload ?? error)}`);
      });
    } catch (error) {
      setSyncMessage(`快捷录入窗口创建异常：${String(error)}`);
    }
  };

  const toggleMainWindowVisibility = async () => {
    await invoke("toggle_main_window");
  };

  const openHomeView = () => {
    setSettingsOpen(false);
    setManageListsOpen(false);
    setSelectedTaskId("");
    setSelectedNoteId("");
    setSelectedCalendarEventId("");
    setActiveView("list");
    setActiveSmartView("today");
  };

  useEffect(() => {
    let disposed = false;
    let unlistenNewTask: (() => void) | undefined;
    let unlistenOpenHome: (() => void) | undefined;

    listen(TRAY_NEW_TASK_EVENT, () => {
      if (!disposed) {
        void openQuickAddWindow();
      }
    }, { target: "main" })
      .then((fn) => {
        unlistenNewTask = fn;
      })
      .catch(() => undefined);

    listen(TRAY_OPEN_HOME_EVENT, () => {
      if (!disposed) {
        openHomeView();
      }
    }, { target: "main" })
      .then((fn) => {
        unlistenOpenHome = fn;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlistenNewTask?.();
      unlistenOpenHome?.();
    };
  }, []);

  useEffect(() => {
    const shortcutEntries = [
      {
        shortcut: toGlobalShortcut(hotkeys.toggleMainWindow),
        action: () => {
          void toggleMainWindowVisibility();
        },
        label: "主界面",
      },
      {
        shortcut: toGlobalShortcut(hotkeys.quickAdd),
        action: () => {
          void openQuickAddWindow();
        },
        label: "快捷录入",
      },
    ];

    let disposed = false;

    const bindShortcuts = async () => {
      await Promise.all(
        shortcutEntries.map(({ shortcut }) => unregister(shortcut).catch(() => undefined)),
      );

      await Promise.all(
        shortcutEntries.map(async ({ shortcut, action, label }) => {
          try {
            await register(shortcut, (event) => {
              if (event.state === "Pressed") {
                action();
              }
            });
          } catch (error) {
            if (!disposed) {
              setSyncMessage(`${label} 快捷键注册失败：${String(error)}`);
            }
          }
        }),
      );
    };

    void bindShortcuts();

    return () => {
      disposed = true;
      void Promise.all(
        shortcutEntries.map(({ shortcut }) => unregister(shortcut).catch(() => undefined)),
      );
    };
  }, [hotkeys.quickAdd, hotkeys.toggleMainWindow]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (matchesHotkey(event, hotkeys.settings)) {
        event.preventDefault();
        setSettingsOpen(true);
      }
      if (matchesHotkey(event, hotkeys.search)) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('[data-search-input="true"]')?.focus();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSettingsOpen(false);
        setSelectedTaskId("");
        setSelectedNoteId("");
        setSelectedCalendarEventId("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeListId, hotkeys]);

  const loginGoogle = async () => {
    setGoogleSyncing(true);
    setSyncMessage(uiText(language, "Opening system browser for Google sign-in...", "正在打开系统浏览器进行 Google 登录..."));
    setLastGoogleError("");
    try {
      let clientIdOverride: string | undefined;
      let clientSecretOverride: string | undefined;
      if (!authStatus?.configured) {
        const clientId = window.prompt(
          uiText(language, "Paste the Desktop App Client ID for this Google Tasks app.", "请粘贴这个 Google Tasks 应用的 Desktop App Client ID。"),
        );
        const trimmedClientId = clientId?.trim();
        if (!trimmedClientId) {
          setSyncMessage(uiText(language, "Google sign-in canceled", "已取消 Google 登录"));
          return;
        }
        clientIdOverride = trimmedClientId;

        const clientSecret = window.prompt(
          uiText(language, "Paste the matching Desktop App Client Secret. It will only be saved by the backend into Windows Credential Manager.", "请继续粘贴同一个 Desktop App OAuth 客户端的 Client Secret。它只会由后端保存到 Windows 凭据存储。"),
        );
        const trimmedClientSecret = clientSecret?.trim();
        if (!trimmedClientSecret) {
          setSyncMessage(uiText(language, "Google sign-in canceled", "已取消 Google 登录"));
          return;
        }
        clientSecretOverride = trimmedClientSecret;
      }

      const loginStatus = await googleTasksApi.login(clientIdOverride, clientSecretOverride);
      setAuthStatus(loginStatus);
      void refreshGoogleWorkspaceData();
    } catch (error) {
      const message = `登录失败：${String(error)}`;
      setSyncMessage(message);
      setLastGoogleError(message);
      window.alert(message);
    } finally {
      setGoogleSyncing(false);
    }
  };

  const signOutGoogle = async () => {
    try {
      const status = await googleTasksApi.signOut();
      setAuthStatus(status);
      setUsingGoogleData(false);
      setCalendarEvents([]);
      setCalendarLists([]);
      setCalendarListMessage("");
      setLists(mockLists);
      setListColorMap((current) =>
        Object.fromEntries(mockLists.map((list, index) => [list.id, current[list.id] ?? index])),
      );
      setTasks(mockTasks);
      setActiveSmartView("today");
      setSelectedTaskId("");
      setSelectedNoteId("");
      setSelectedCalendarEventId("");
      setSyncMessage(uiText(language, "Signed out. Showing local demo data.", "已退出 Google 登录，当前显示本地演示数据。"));
    } catch (error) {
      const message = `${uiText(language, "Sign-out failed: ", "退出登录失败：")}${String(error)}`;
      setLastGoogleError(message);
      setSyncMessage(message);
    }
  };

  const updateTask = (taskId: string, patch: Partial<Task>) => {
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
    );
    if (taskId === selectedTaskId) {
      setSaveState("idle");
      setSaveMessage(uiText(language, "Changes pending. Auto-sync will run shortly.", "修改已暂存，即将自动同步。"));
    }
  };

  const recordCompletedActivity = (task: Task, completed: boolean) => {
    const operatedAt = new Date().toISOString();
    setTaskActivityHistory((current) => {
      const withoutTaskCompletion = current.filter(
        (record) => !(record.taskId === task.id && record.action === "completed"),
      );
      if (!completed) {
        return withoutTaskCompletion;
      }
      return [
        {
          id: `completed-${task.id}`,
          taskId: task.id,
          action: "completed",
          operatedAt,
          taskSnapshot: { ...task, completed: true, completedAt: operatedAt, lastEdited: "just now" },
        },
        ...withoutTaskCompletion,
      ];
    });
  };

  const recordDeletedActivity = (task: Task) => {
    setTaskActivityHistory((current) => [
      {
        id: `deleted-${task.id}-${Date.now()}`,
        taskId: task.id,
        action: "deleted",
        operatedAt: new Date().toISOString(),
        taskSnapshot: task,
      },
      ...current.filter((record) => !(record.taskId === task.id && record.action === "deleted")),
    ]);
  };

  const changeTaskPriority = (taskId: string, priority: NonNullable<Task["priority"]>) => {
    setTaskPriorityMap((current) => ({ ...current, [taskId]: priority }));
    updateTask(taskId, { priority, lastEdited: "just now" });
  };

  const persistGoogleTaskUpdate = async (taskId: string, patch: Partial<Task>) => {
    if (!googleReady) {
      setSyncMessage(uiText(language, "Google is not connected. Changes are only local for now.", "当前未连接 Google，修改暂时只保存在本地界面。"));
      return false;
    }

    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return false;
    }

    localTaskOverridesRef.current.set(taskId, {
      ...(localTaskOverridesRef.current.get(taskId) ?? {}),
      ...patch,
      ...("completed" in patch
        ? { completedAt: patch.completed ? task.completedAt ?? new Date().toISOString() : undefined }
        : {}),
    });

    try {
      const composedNotes =
        "notes" in patch || "reminderTime" in patch
          ? composeTaskNotes(
              patchValue(patch, task, "notes"),
              patchValue(patch, task, "reminderTime"),
              language,
            )
          : undefined;
      const remote = await syncApi.updateTask({
        task_list_id: task.listId,
        task_id: task.id,
        title: patch.title,
        notes:
          "notes" in patch || "reminderTime" in patch
            ? composedNotes ?? ""
            : undefined,
        due: "dueText" in patch || "dueLabel" in patch ? dueForGoogle(task, patch) : undefined,
        status: patch.completed === undefined ? undefined : patch.completed ? "completed" : "needsAction",
      });
      const [mapped] = mapGoogleTasks([remote], taskPriorityMapRef.current);
      updateTask(taskId, { ...mapped, subtasks: task.subtasks, reminderTime: mapped.reminderTime });
      setSyncMessage(
        uiText(language, "Saved locally. Background sync is running.", "已保存到本地，后台同步中。"),
      );
      return true;
    } catch (error) {
      const message = `${uiText(language, "Save failed: ", "保存失败：")}${String(error)}`;
      setSyncMessage(message);
      setLastGoogleError(message);
      return false;
    }
  };

  const saveSelectedTask = async () => {
    if (!selectedTask) {
      return;
    }

    setSaveState("saving");
    setSaveMessage(
      googleReady
        ? uiText(language, "Syncing to Google Tasks...", "正在同步到 Google Tasks...")
        : uiText(language, "Google is not connected", "当前未连接 Google"),
    );
    const saved = await persistGoogleTaskUpdate(selectedTask.id, {
      title: selectedTask.title,
      notes: selectedTask.notes,
      dueText: selectedTask.dueText,
      dueLabel: selectedTask.dueLabel,
      completed: selectedTask.completed,
    });

    if (saved) {
      setSaveState("saved");
      void refreshGoogleWorkspaceData(activeListIdRef.current);
      setSaveMessage(
        uiText(language, "Saved locally. Syncing in the background.", "已保存到本地，正在后台同步。"),
      );
      window.setTimeout(() => {
        setSaveState("idle");
        setSaveMessage(uiText(language, "Save changes to Google Tasks", "修改后点击保存，同步到 Google Tasks"));
      }, 2200);
      return;
    }

    setSaveState("error");
    setSaveMessage(uiText(language, "Save failed. Please check your sign-in status.", "保存失败，请检查登录状态。"));
  };

  const updateCalendarEvent = (eventId: string, patch: Partial<CalendarEvent>) => {
    setCalendarEvents((current) =>
      current.map((event) =>
        calendarEventKey(event) === eventId ? { ...event, ...patch } : event,
      ),
    );
    if (eventId === selectedCalendarEventId) {
      setSaveState("idle");
      setSaveMessage(uiText(language, "Changes pending. Auto-sync will run shortly.", "修改已暂存，即将自动同步。"));
    }
  };

  const persistCalendarEventUpdate = async (eventId: string, patch: Partial<CalendarEvent>) => {
    const event = calendarEvents.find((item) => calendarEventKey(item) === eventId);
    if (!event) {
      return false;
    }

    setSaveState("saving");
    setSaveMessage(uiText(language, "Syncing to Google Calendar...", "正在同步到 Google Calendar..."));
    try {
      const remote = await googleTasksApi.updateCalendarEvent({
        calendar_id: event.calendar_id,
        event_id: event.id,
        title: patch.title,
        description: patch.description,
        date: patch.start ? calendarDateForEvent({ ...event, ...patch }) : undefined,
        time: patch.start ? calendarEventTimeValue({ ...event, ...patch }) || null : undefined,
      });
      setCalendarEvents((current) =>
        current.map((item) =>
          calendarEventKey(item) === eventId
            ? {
                ...item,
                ...remote,
                calendar_name: item.calendar_name,
                color: item.color,
              }
            : item,
        ),
      );
      setSaveState("saved");
      setSelectedCalendarEventId("");
      setSaveMessage(uiText(language, "Synced to Google Calendar", "已同步到 Google Calendar"));
      window.setTimeout(() => {
        setSaveState("idle");
        setSaveMessage(uiText(language, "Auto-sync enabled", "已启用自动同步"));
      }, 1800);
      return true;
    } catch (error) {
      const message = `${uiText(language, "Calendar save failed: ", "日程保存失败：")}${String(error)}`;
      setSaveState("error");
      setSaveMessage(message);
      setSyncMessage(message);
      setLastGoogleError(message);
      return false;
    }
  };

  const autoPersistTask = async (taskId: string, patch: Partial<Task>) => {
    setSaveState("saving");
    setSaveMessage(
      googleReady
        ? uiText(language, "Syncing to Google Tasks...", "正在同步到 Google Tasks...")
        : uiText(language, "Google is not connected", "当前未连接 Google"),
    );

    const saved = await persistGoogleTaskUpdate(taskId, patch);
    if (saved) {
      setSaveState("saved");
      void refreshGoogleWorkspaceData(activeListIdRef.current);
      setSaveMessage(
        uiText(language, "Saved locally. Syncing in the background.", "已保存到本地，正在后台同步。"),
      );
      window.setTimeout(() => {
        setSaveState("idle");
        setSaveMessage(uiText(language, "Auto-sync enabled", "已启用自动同步"));
      }, 1800);
      return;
    }

    setSaveState("error");
    setSaveMessage(uiText(language, "Auto-sync failed. Please check your sign-in status.", "自动同步失败，请检查登录状态。"));
  };

  const addTaskWithTitle = async (
    titleValue: string,
    listId = activeListId,
    dueLabel: SmartView = "today",
    noteText = "",
  ): Promise<Task | undefined> => {
    const title = titleValue.trim();
    if (!title) {
      return undefined;
    }

    if (googleReady) {
      try {
        const remoteTask = await syncApi.createTask({
          task_list_id: listId,
          title,
          notes: noteText || undefined,
          due: dueTextByView[dueLabel]
            ? dueForGoogle({}, { dueText: dueTextByView[dueLabel], dueLabel })
            : undefined,
        });
        const [newTask] = mapGoogleTasks([remoteTask], taskPriorityMapRef.current);
        setTasks((current) => [newTask, ...current]);
        setPendingCount((current) => current + 1);
        setSyncMessage(uiText(language, "Saved locally. Syncing in the background.", "已保存到本地，正在后台同步。"));
        void refreshGoogleWorkspaceData(listId);
        return newTask;
      } catch (error) {
        const message = `${uiText(language, "Create failed: ", "创建失败：")}${String(error)}`;
        setSyncMessage(message);
        setLastGoogleError(message);
      }
      return undefined;
    }

    const newTask: Task = {
      id: createId("task"),
      listId,
      title,
      notes: noteText,
      dueLabel,
      dueText: dueTextByView[dueLabel],
      completed: false,
      createdAt: "Today",
      lastEdited: "just now",
      subtasks: [],
    };
    setTasks((current) => [newTask, ...current]);
    return newTask;
  };

  const addTask = async () => {
    const dueLabel = activeSmartView && activeSmartView !== "all" ? activeSmartView : "today";
    await addTaskWithTitle(newTaskTitle, activeListId, dueLabel);
    setNewTaskTitle("");
  };

  const addQuickTask = async () => {
    const title = quickDraft.title.trim();
    if (!title) {
      return;
    }

    if (googleReady) {
      try {
        const remoteTask = await syncApi.createTask({
          task_list_id: quickDraft.listId,
          title,
          notes: quickDraft.notes,
          due: dueForGoogle({}, {
            dueText: dueTextByView[quickDraft.dueLabel],
            dueLabel: quickDraft.dueLabel,
          }),
        });
        const [newTask] = mapGoogleTasks([remoteTask], taskPriorityMapRef.current);
        setTasks((current) => [newTask, ...current]);
        setActiveListId(newTask.listId);
        setActiveSmartView(null);
        setActiveView("list");
        setQuickDraft(createDefaultQuickDraft(newTask.listId));
        setPendingCount((current) => current + 1);
        setSyncMessage(uiText(language, "Saved locally. Syncing in the background.", "已保存到本地，正在后台同步。"));
        void refreshGoogleWorkspaceData(newTask.listId);
      } catch (error) {
        const message = `${uiText(language, "Create failed: ", "创建失败：")}${String(error)}`;
        setSyncMessage(message);
        setLastGoogleError(message);
      }
      return;
    }

    const newTask: Task = {
      id: createId("quick-task"),
      listId: quickDraft.listId,
      title,
      notes: quickDraft.notes,
      dueLabel: quickDraft.dueLabel,
      dueText: dueTextByView[quickDraft.dueLabel],
      estimate: quickDraft.estimate || undefined,
      completed: false,
      createdAt: "Today",
      lastEdited: "just now",
      subtasks: [],
    };
    setTasks((current) => [newTask, ...current]);
    setActiveListId(newTask.listId);
    setActiveSmartView(null);
    setActiveView("list");
    setQuickDraft(createDefaultQuickDraft(newTask.listId));
  };

  const addSubtask = async () => {
    if (!selectedTask) {
      return;
    }

    const title = draftSubtaskTitle.trim();
    if (!title) {
      return;
    }

    if (googleReady) {
      try {
        const remoteSubtask = await syncApi.createTask({
          task_list_id: selectedTask.listId,
          title,
          parent: selectedTask.id,
        });
        updateTask(selectedTask.id, {
          subtasks: [
            ...selectedTask.subtasks,
            { id: remoteSubtask.id, title: remoteSubtask.title, completed: remoteSubtask.completed },
          ],
          lastEdited: "pending sync",
        });
        setPendingCount((current) => current + 1);
        setSyncMessage(uiText(language, "Saved locally. Syncing in the background.", "已保存到本地，正在后台同步。"));
        void refreshGoogleWorkspaceData(selectedTask.listId);
      } catch (error) {
        const message = `${uiText(language, "Create failed: ", "创建失败：")}${String(error)}`;
        setSyncMessage(message);
        setLastGoogleError(message);
        return;
      }
    } else {
      updateTask(selectedTask.id, {
        subtasks: [...selectedTask.subtasks, { id: createId("subtask"), title, completed: false }],
        lastEdited: "just now",
      });
    }

    setDraftSubtaskTitle("");
  };

  const toggleTaskComplete = async (taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return;
    }
    const completed = !task.completed;
    const completedAt = completed ? new Date().toISOString() : undefined;
    setTasks((current) =>
      current.map((item) =>
        item.id === taskId ? { ...item, completed, completedAt, lastEdited: "just now" } : item,
      ),
    );
    recordCompletedActivity(task, completed);
    await persistGoogleTaskUpdate(taskId, { completed });
  };

  const toggleSubtask = async (taskId: string, subtaskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    const subtask = task?.subtasks.find((item) => item.id === subtaskId);
    if (!task || !subtask) {
      return;
    }
    const completed = !subtask.completed;
    setTasks((current) =>
      current.map((item) =>
        item.id === taskId
          ? {
              ...item,
              lastEdited: "just now",
              subtasks: item.subtasks.map((currentSubtask) =>
                currentSubtask.id === subtaskId ? { ...currentSubtask, completed } : currentSubtask,
              ),
            }
          : item,
      ),
    );

    if (googleReady) {
      try {
        await syncApi.updateTask({
          task_list_id: task.listId,
          task_id: subtaskId,
          status: completed ? "completed" : "needsAction",
        });
        setSyncMessage(uiText(language, "Saved locally. Syncing in the background.", "已保存到本地，正在后台同步。"));
        void refreshGoogleWorkspaceData(task.listId);
      } catch (error) {
        const message = `${uiText(language, "Status update failed: ", "状态更新失败：")}${String(error)}`;
        setSyncMessage(message);
        setLastGoogleError(message);
      }
    }
  };

  const updateSelectedSubtask = (subtaskId: string, title: string) => {
    if (!selectedTask) {
      return;
    }
    updateTask(selectedTask.id, {
      lastEdited: "just now",
      subtasks: selectedTask.subtasks.map((subtask) =>
        subtask.id === subtaskId ? { ...subtask, title } : subtask,
      ),
    });
  };

  const persistSelectedSubtask = async (subtaskId: string, titleOverride?: string) => {
    if (!selectedTask || !googleReady) {
      return;
    }
    const subtask = selectedTask.subtasks.find((item) => item.id === subtaskId);
    if (!subtask) {
      return;
    }
    try {
      await syncApi.updateTask({
        task_list_id: selectedTask.listId,
        task_id: subtask.id,
        title: titleOverride ?? subtask.title,
      });
      setSyncMessage(uiText(language, "Saved locally. Syncing in the background.", "已保存到本地，正在后台同步。"));
      void refreshGoogleWorkspaceData(selectedTask.listId);
    } catch (error) {
      const message = `${uiText(language, "Subtask save failed: ", "子任务保存失败：")}${String(error)}`;
      setSyncMessage(message);
      setLastGoogleError(message);
    }
  };

  const deleteSelectedTask = async () => {
    if (!selectedTask) {
      return;
    }
    if (googleReady) {
      try {
        await syncApi.deleteTask(selectedTask.listId, selectedTask.id);
        setSyncMessage(uiText(language, "Deleted locally. Syncing in the background.", "已在本地删除，正在后台同步。"));
        void refreshGoogleWorkspaceData(selectedTask.listId);
      } catch (error) {
        const message = `${uiText(language, "Delete failed: ", "删除失败：")}${String(error)}`;
        setSyncMessage(message);
        setLastGoogleError(message);
        return;
      }
    }
    recordDeletedActivity(selectedTask);
    const remainingTasks = tasks.filter((task) => task.id !== selectedTask.id);
    setTasks(remainingTasks);
    setSelectedTaskId("");
  };

  const deleteSelectedCalendarEvent = async () => {
    if (!selectedCalendarEvent) {
      return;
    }

    try {
      await googleTasksApi.deleteCalendarEvent(selectedCalendarEvent.calendar_id, selectedCalendarEvent.id);
      setCalendarEvents((current) =>
        current.filter((event) => calendarEventKey(event) !== selectedCalendarEventId),
      );
      setSelectedCalendarEventId("");
      setSyncMessage(uiText(language, "Calendar event deleted", "日程已删除"));
    } catch (error) {
      const message = `${uiText(language, "Calendar delete failed: ", "日程删除失败：")}${String(error)}`;
      setSyncMessage(message);
      setLastGoogleError(message);
    }
  };

  const markNotePending = () => {
    setSaveState("idle");
    setSaveMessage(uiText(language, "Changes pending. Save happens when focus leaves the field.", "修改已暂存，焦点移出后保存。"));
  };

  const persistNoteUpdate = () => {
    setSaveState("saved");
    setSaveMessage(uiText(language, "Saved locally. Google Keep sync is not connected yet.", "已保存到本地。Google Keep 同步尚未连接。"));
    window.setTimeout(() => {
      setSaveState("idle");
      setSaveMessage(uiText(language, "Saved locally", "已保存到本地"));
    }, 1600);
  };

  const createNote = (titleValue = newTaskTitle) => {
    const title = titleValue.trim() || uiText(language, "New note", "新笔记");
    const newNote: Note = {
      id: createId("note"),
      title,
      body: "",
      labels: activeNoteLabel ? [activeNoteLabel] : [],
      color: "default",
      pinned: false,
      archived: false,
      createdAt: "Today",
      lastEdited: "just now",
    };
    setNotes((current) => [newNote, ...current]);
    setNewTaskTitle("");
    setSelectedTaskId("");
    setSelectedCalendarEventId("");
    setSelectedNoteId(newNote.id);
    setActiveView("notes");
    setActiveNoteFilter("all");
    persistNoteUpdate();
  };

  const updateNote = (noteId: string, patch: Partial<Note>) => {
    setNotes((current) =>
      current.map((note) =>
        note.id === noteId ? { ...note, ...patch, lastEdited: patch.lastEdited ?? "just now" } : note,
      ),
    );
    if (noteId === selectedNoteId) {
      markNotePending();
    }
  };

  const toggleNotePinned = (noteId: string) => {
    const note = notes.find((item) => item.id === noteId);
    if (!note) {
      return;
    }
    updateNote(noteId, { pinned: !note.pinned });
    persistNoteUpdate();
  };

  const recordNoteActivity = (note: Note, action: NoteActivityAction) => {
    setNoteActivityHistory((current) => [
      {
        id: `${action}-${note.id}-${Date.now()}`,
        noteId: note.id,
        action,
        operatedAt: new Date().toISOString(),
        noteSnapshot: note,
      },
      ...current.filter((record) => !(record.noteId === note.id && record.action === action)),
    ]);
  };

  const archiveSelectedNote = () => {
    if (!selectedNote) {
      return;
    }
    recordNoteActivity(selectedNote, "archived");
    updateNote(selectedNote.id, { archived: true });
    persistNoteUpdate();
    setSelectedNoteId("");
    setActiveNoteFilter("archive");
  };

  const deleteSelectedNote = () => {
    if (!selectedNote) {
      return;
    }
    recordNoteActivity(selectedNote, "deleted");
    setNotes((current) => current.filter((note) => note.id !== selectedNote.id));
    persistNoteUpdate();
    setSelectedNoteId("");
  };

  const restoreNoteFromActivity = (noteId: string) => {
    const record = noteActivityHistory.find((item) => item.noteId === noteId);
    if (!record) {
      return;
    }
    const restoredNote = { ...record.noteSnapshot, archived: false, lastEdited: "just now" };
    setNotes((current) => {
      const exists = current.some((note) => note.id === noteId);
      return exists
        ? current.map((note) => (note.id === noteId ? restoredNote : note))
        : [restoredNote, ...current];
    });
    setNoteActivityHistory((current) => current.filter((item) => item.noteId !== noteId));
    setActiveNoteFilter("all");
    setActiveView("notes");
    setSelectedNoteId(noteId);
    persistNoteUpdate();
  };

  const createTaskFromSelectedNote = async () => {
    if (!selectedNote) {
      return;
    }
    const newTask = await addTaskWithTitle(selectedNote.title, activeListId, "today", selectedNote.body);
    if (!newTask) {
      return;
    }
    setActiveView("list");
    setActiveSmartView(null);
    setSelectedNoteId("");
    setSelectedCalendarEventId("");
    setSelectedTaskId(newTask.id);
    setSyncMessage(uiText(language, "Created a task from the selected note.", "已从选中的笔记创建任务。"));
  };

  const createList = (name: string, colorIndex: number) => {
    if (googleReady) {
      window.alert(uiText(language, "Creating Google task lists is not supported in this phase.", "当前阶段暂不支持直接创建 Google 远端清单。"));
      return undefined;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      return undefined;
    }
    const newList: TaskListSummary = {
      id: createId("list"),
      name: trimmedName,
      icon: Folder,
      iconClassName: "text-secondary",
    };
    setLists((current) => [...current, newList]);
    setListColorMap((current) => ({ ...current, [newList.id]: colorIndex }));
    setActiveListId(newList.id);
    setActiveSmartView(null);
    setActiveView("list");
    return newList.id;
  };

  const renameList = (listId: string, nextName?: string) => {
    const list = lists.find((item) => item.id === listId);
    const name = nextName ?? window.prompt(uiText(language, "Rename list", "重命名清单"), list?.name ?? "");
    const trimmedName = name?.trim();
    if (!trimmedName) {
      return;
    }
    setLists((current) =>
      current.map((item) => (item.id === listId ? { ...item, name: trimmedName } : item)),
    );
  };

  const deleteList = (listId: string) => {
    if (googleReady) {
      window.alert(uiText(language, "Deleting Google task lists is not supported in this phase.", "当前阶段暂不支持删除 Google 远端清单。"));
      return;
    }
    if (lists.length <= 1) {
      window.alert(uiText(language, "At least one list must remain.", "至少需要保留一个清单。"));
      return;
    }
    const list = lists.find((item) => item.id === listId);
    const confirmed = window.confirm(
      uiText(
        language,
        `Delete "${list?.name ?? "this list"}"? Local tasks in this list will also be removed.`,
        `确认删除“${list?.name ?? "该清单"}”吗？这个清单下的本地任务也会一并删除。`,
      ),
    );
    if (!confirmed) {
      return;
    }
    const nextLists = lists.filter((item) => item.id !== listId);
    setLists(nextLists);
    setTasks((current) => current.filter((task) => task.listId !== listId));
    setListColorMap((current) => {
      const next = { ...current };
      delete next[listId];
      return next;
    });
    setListCustomColorMap((current) => {
      const next = { ...current };
      delete next[listId];
      return next;
    });
    if (activeListId === listId) {
      setActiveListId(nextLists[0]?.id ?? "");
      setActiveSmartView(null);
    }
    if (selectedTask?.listId === listId) {
      setSelectedTaskId("");
    }
  };

  const moveTask = async (taskId: string, direction: -1 | 1) => {
    const scopedIds = visibleTasks.map((task) => task.id);
    const scopedIndex = scopedIds.indexOf(taskId);
    const swapWithId = scopedIds[scopedIndex + direction];
    if (!swapWithId) {
      return;
    }

    setTasks((current) => {
      const next = [...current];
      const from = next.findIndex((task) => task.id === taskId);
      const to = next.findIndex((task) => task.id === swapWithId);
      if (from < 0 || to < 0) {
        return current;
      }
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });

    if (googleReady) {
      const task = tasks.find((item) => item.id === taskId);
      if (!task) {
        return;
      }
      try {
        await syncApi.moveTask({
          task_list_id: task.listId,
          task_id: task.id,
          previous: direction > 0 ? swapWithId : null,
        });
        setSyncMessage(uiText(language, "Saved locally. Syncing in the background.", "已保存到本地，正在后台同步。"));
        void refreshGoogleWorkspaceData(task.listId);
      } catch (error) {
        const message = `${uiText(language, "Reorder failed: ", "排序失败：")}${String(error)}`;
        setSyncMessage(message);
        setLastGoogleError(message);
      }
    }
  };

  const changeTaskList = async (taskId: string, listId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.listId === listId) {
      return;
    }
    if (googleReady) {
      setSyncMessage(uiText(language, "Moving task to another list...", "正在将任务移动到新的清单..."));
      setLastGoogleError("");
      try {
        const createdTask = await syncApi.createTask({
          task_list_id: listId,
          title: task.title,
          notes: composeTaskNotes(task.notes, task.reminderTime, language),
          due: dueForGoogle(task, { dueText: task.dueText, dueLabel: task.dueLabel }),
        });

        let migratedTask = createdTask;
        if (task.completed) {
          migratedTask = await syncApi.updateTask({
            task_list_id: listId,
            task_id: createdTask.id,
            status: "completed",
          });
        }

        for (const subtask of task.subtasks) {
          const createdSubtask = await syncApi.createTask({
            task_list_id: listId,
            title: subtask.title,
            parent: migratedTask.id,
          });
          if (subtask.completed) {
            await syncApi.updateTask({
              task_list_id: listId,
              task_id: createdSubtask.id,
              status: "completed",
            });
          }
        }

        await syncApi.deleteTask(task.listId, task.id);
        const snapshot = await syncApi.cachedSnapshot();
        applySnapshot(
          snapshot,
          uiText(language, "Saved locally. Syncing in the background.", "已保存到本地，正在后台同步。"),
          listId,
        );
        setActiveSmartView(null);
        void refreshGoogleWorkspaceData(listId);
        return;
      } catch (error) {
        const message = `${uiText(language, "Move failed: ", "移动失败：")}${String(error)}`;
        setSyncMessage(message);
        setLastGoogleError(message);
        return;
      }
    }
    updateTask(taskId, { listId, lastEdited: "just now" });
  };

  const saveGoogleProxyConfig = async () => {
    setGoogleProxySaving(true);
    setGoogleProxyMessage(uiText(language, "Saving proxy settings...", "正在保存代理设置..."));
    try {
      const config = await googleTasksApi.saveProxyConfig(googleProxyConfig);
      setGoogleProxyConfig(config);
      setGoogleProxyMessage(
        config.mode === "custom"
          ? uiText(language, `Proxy: ${config.url}`, `当前代理：${config.url}`)
          : config.mode === "none"
            ? uiText(language, "Proxy disabled", "当前不使用代理")
            : uiText(language, "Using system proxy", "当前使用系统代理"),
      );
      setSyncMessage(uiText(language, "Proxy settings saved", "代理设置已保存"));
    } catch (error) {
      setGoogleProxyMessage(`${uiText(language, "Save failed: ", "保存失败：")}${String(error)}`);
    } finally {
      setGoogleProxySaving(false);
    }
  };

  const selectList = (listId: string) => {
    setActiveListId(listId);
    setActiveSmartView(null);
    setSelectedTaskId("");
    setSelectedNoteId("");
    setSelectedCalendarEventId("");
    if (activeView !== "board" && activeView !== "calendar") {
      setActiveView("list");
    }
  };

  const selectSmartView = (view: SmartView) => {
    setActiveSmartView(view);
    setSelectedTaskId("");
    setSelectedNoteId("");
    setSelectedCalendarEventId("");
    if (activeView !== "board" && activeView !== "calendar") {
      setActiveView("list");
    }
  };

  const closeDetailsFromPage = (event: { target: EventTarget | null }) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-detail-interactive="true"]')) {
      return;
    }
    setSelectedTaskId("");
    setSelectedNoteId("");
    setSelectedCalendarEventId("");
  };

  return (
    <div className={resolvedTheme === "dark" ? "dark h-full" : "h-full"}>
      <div className="flex h-full overflow-hidden bg-canvas text-ink dark:bg-surface-dark dark:text-on-dark">
        <DesignSidebar
          lists={lists}
          tasks={tasks}
          notes={notes}
          noteLabels={noteLabelSummaries}
          activeListId={activeListId}
          activeSmartView={activeSmartView}
          activeNoteFilter={activeNoteFilter}
          activeNoteLabel={activeNoteLabel}
          activeView={activeView}
          language={language}
          showCompleted={showCompleted}
          searchValue={searchValue}
          showTaskCount={showTaskCount}
          showCollapsedSidebarBadges={showCollapsedSidebarBadges}
          collapsed={sidebarCollapsed}
          signedIn={Boolean(authStatus?.signed_in)}
          userName={authStatus?.signed_in ? authStatus.user_name ?? uiText(language, "Google Tasks User", "Google Tasks 用户") : uiText(language, "Not signed in", "未登录")}
          userEmail={authStatus?.signed_in ? authStatus.user_email ?? authStatus.user_hint ?? uiText(language, "Email not returned", "邮箱信息未返回") : uiText(language, "Open settings to sign in", "点击进入设置后登录")}
          userPicture={authStatus?.signed_in ? authStatus.user_picture ?? "" : ""}
          listColorMap={listColorMap}
          listCustomColorMap={listCustomColorMap}
          syncState={googleSyncing ? "syncing" : lastGoogleError ? "error" : offlineMode ? "offline" : "online"}
          syncMessage={syncMessage}
          onSearchChange={setSearchValue}
          onSelectList={selectList}
          onSelectSmartView={selectSmartView}
          onSelectNotesHome={() => {
            setActiveView("notes");
            setActiveNoteFilter("all");
            setActiveNoteLabel(null);
            setSelectedTaskId("");
            setSelectedCalendarEventId("");
          }}
          onSelectNoteFilter={(filter) => {
            setActiveView("notes");
            setActiveNoteFilter(filter);
            setActiveNoteLabel(null);
            setSelectedTaskId("");
            setSelectedCalendarEventId("");
          }}
          onSelectNoteLabel={(label) => {
            setActiveView("notes");
            setActiveNoteLabel(label);
            setActiveNoteFilter("all");
            setSelectedTaskId("");
            setSelectedCalendarEventId("");
          }}
          onCreateList={() => setManageListsOpen(true)}
          onCreateNote={() => createNote()}
          onAccountClick={() => setSettingsOpen(true)}
          onSync={() => void refreshGoogleWorkspaceData(activeListId)}
          onUtilityView={(view) => {
            setSelectedTaskId("");
            setSelectedNoteId("");
            setSelectedCalendarEventId("");
            setActiveView(view);
          }}
          onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        />

        <main className="flex min-w-0 flex-1 flex-col bg-canvas dark:bg-surface-dark">
          <DesignTopBar
            activeView={activeView}
            language={language}
            onViewChange={(view) => {
              setSelectedTaskId("");
              setSelectedNoteId("");
              setSelectedCalendarEventId("");
              setActiveView(view);
            }}
          />

          {activeView === "list" ? (
            <div className="flex min-h-0 flex-1" onClick={closeDetailsFromPage}>
              <ListWorkspace
                title={activeTitle}
                subtitle={activeSubtitle}
                items={visibleListItems}
                lists={lists}
                listColorMap={listColorMap}
                listCustomColorMap={listCustomColorMap}
                selectedTaskId={selectedTaskId}
                selectedCalendarEventId={selectedCalendarEventId}
                language={language}
                showCompleted={showCompleted}
                newTaskTitle={newTaskTitle}
                onNewTaskTitleChange={setNewTaskTitle}
                onAddTask={() => void addTask()}
                onSelectTask={(taskId) => {
                  setSelectedCalendarEventId("");
                  setSelectedTaskId(taskId);
                }}
                onSelectCalendarEvent={(eventId) => {
                  setSelectedTaskId("");
                  setSelectedCalendarEventId(eventId);
                }}
                onToggleTask={(taskId) => void toggleTaskComplete(taskId)}
                onShowCompletedChange={setShowCompleted}
              />
              {selectedCalendarEvent ? (
                <CalendarEventDetailsPanel
                  event={selectedCalendarEvent}
                  language={language}
                  onUpdateEvent={updateCalendarEvent}
                  onPersistEvent={(eventId, patch) => void persistCalendarEventUpdate(eventId, patch)}
                  onDeleteEvent={() => void deleteSelectedCalendarEvent()}
                  saveState={saveState}
                  saveMessage={saveMessage}
                  onClose={() => setSelectedCalendarEventId("")}
                />
              ) : selectedTask ? (
                <TaskDetailsPanel
                  task={selectedTask}
                  lists={lists}
                  language={language}
                  onUpdateTask={updateTask}
                  onPersistTask={(taskId, patch) => void autoPersistTask(taskId, patch)}
                  onChangeTaskList={changeTaskList}
                  onDeleteTask={() => void deleteSelectedTask()}
                  saveState={saveState}
                  saveMessage={saveMessage}
                  onClose={() => setSelectedTaskId("")}
                />
              ) : null}
            </div>
          ) : null}

          {activeView === "board" ? (
            <div className="flex min-h-0 flex-1" onClick={closeDetailsFromPage}>
              <BoardWorkspace
                tasks={scopedTasks}
                lists={lists}
                listColorMap={listColorMap}
                listCustomColorMap={listCustomColorMap}
                language={language}
                selectedTaskId={selectedTaskId}
                onSelectTask={(taskId) => {
                  setSelectedCalendarEventId("");
                  setSelectedTaskId(taskId);
                }}
                onChangeTaskPriority={changeTaskPriority}
              />
              {selectedTask ? (
                <TaskDetailsPanel
                  task={selectedTask}
                  lists={lists}
                  language={language}
                  onUpdateTask={updateTask}
                  onPersistTask={(taskId, patch) => void autoPersistTask(taskId, patch)}
                  onChangeTaskList={changeTaskList}
                  onDeleteTask={() => void deleteSelectedTask()}
                  saveState={saveState}
                  saveMessage={saveMessage}
                  onClose={() => setSelectedTaskId("")}
                />
              ) : null}
            </div>
          ) : null}

          {activeView === "notes" ? (
            <div className="flex min-h-0 flex-1" onClick={closeDetailsFromPage}>
              <NotesWorkspace
                notes={visibleNotes}
                allNotes={notes}
                activeFilter={activeNoteFilter}
                activeLabel={activeNoteLabel}
                language={language}
                newNoteTitle={newTaskTitle}
                selectedNoteId={selectedNoteId}
                onNewNoteTitleChange={setNewTaskTitle}
                onCreateNote={() => createNote()}
                onSelectNote={setSelectedNoteId}
                onTogglePinned={toggleNotePinned}
              />
              {selectedNote ? (
                <NoteDetailsPanel
                  note={selectedNote}
                  language={language}
                  saveState={saveState}
                  saveMessage={saveMessage}
                  onUpdateNote={updateNote}
                  onPersistNote={persistNoteUpdate}
                  onArchive={archiveSelectedNote}
                  onDelete={deleteSelectedNote}
                  onCreateTask={createTaskFromSelectedNote}
                  availableLabels={noteLabelSummaries.map((item) => item.label)}
                  onClose={() => setSelectedNoteId("")}
                />
              ) : null}
            </div>
          ) : null}

          {activeView === "calendar" ? (
            <div className="flex min-h-0 flex-1" onClick={closeDetailsFromPage}>
              <CalendarWorkspace
                tasks={scopedTasks}
                events={calendarEvents}
                lists={lists}
                listColorMap={listColorMap}
                listCustomColorMap={listCustomColorMap}
                language={language}
                monthValue={calendarMonth}
                onMonthChange={setCalendarMonth}
                onSelectTask={(taskId) => {
                  setSelectedCalendarEventId("");
                  setSelectedTaskId(taskId);
                }}
                onSelectCalendarEvent={(eventId) => {
                  setSelectedTaskId("");
                  setSelectedCalendarEventId(eventId);
                }}
              />
              {selectedCalendarEvent ? (
                <CalendarEventDetailsPanel
                  event={selectedCalendarEvent}
                  language={language}
                  onUpdateEvent={updateCalendarEvent}
                  onPersistEvent={(eventId, patch) => void persistCalendarEventUpdate(eventId, patch)}
                  onDeleteEvent={() => void deleteSelectedCalendarEvent()}
                  saveState={saveState}
                  saveMessage={saveMessage}
                  onClose={() => setSelectedCalendarEventId("")}
                />
              ) : selectedTask ? (
                <TaskDetailsPanel
                  task={selectedTask}
                  lists={lists}
                  language={language}
                  onUpdateTask={updateTask}
                  onPersistTask={(taskId, patch) => void autoPersistTask(taskId, patch)}
                  onChangeTaskList={changeTaskList}
                  onDeleteTask={() => void deleteSelectedTask()}
                  saveState={saveState}
                  saveMessage={saveMessage}
                  onClose={() => setSelectedTaskId("")}
                />
              ) : null}
            </div>
          ) : null}

          {activeView === "manage" ? (
            <ManageListsWorkspace
              lists={lists}
              tasks={tasks}
              language={language}
              onCreateList={() => setManageListsOpen(true)}
              onRenameList={renameList}
              onSelectList={selectList}
            />
          ) : null}

          {activeView === "archive" ? (
            <div className="flex min-h-0 flex-1" onClick={closeDetailsFromPage}>
              <UtilityWorkspace
                title="Archive / Trash"
                description="Completed, archived, and deleted items are ordered by the latest action."
                items={utilityActivityItems}
                emptyText="No archived or deleted tasks yet."
                language={language}
                selectedTaskId={selectedTaskId}
                onSelectTask={(taskId) => {
                  if (!tasks.some((task) => task.id === taskId)) {
                    return;
                  }
                  setSelectedCalendarEventId("");
                  setSelectedTaskId(taskId);
                }}
                onRestoreNote={restoreNoteFromActivity}
              />
              {selectedTask ? (
                <TaskDetailsPanel
                  task={selectedTask}
                  lists={lists}
                  language={language}
                  onUpdateTask={updateTask}
                  onPersistTask={(taskId, patch) => void autoPersistTask(taskId, patch)}
                  onChangeTaskList={changeTaskList}
                  onDeleteTask={() => void deleteSelectedTask()}
                  saveState={saveState}
                  saveMessage={saveMessage}
                  onClose={() => setSelectedTaskId("")}
                />
              ) : null}
            </div>
          ) : null}

          {activeView === "trash" ? (
            <div className="flex min-h-0 flex-1" onClick={closeDetailsFromPage}>
              <UtilityWorkspace
                title="Trash"
                description="Deleted tasks and notes are shown here with their source type."
                items={utilityActivityItems.filter((record) => record.action === "deleted")}
                emptyText="Trash is empty."
                language={language}
                selectedTaskId={selectedTaskId}
                onSelectTask={() => undefined}
                onRestoreNote={restoreNoteFromActivity}
              />
              {selectedTask ? (
                <TaskDetailsPanel
                  task={selectedTask}
                  lists={lists}
                  language={language}
                  onUpdateTask={updateTask}
                  onPersistTask={(taskId, patch) => void autoPersistTask(taskId, patch)}
                  onChangeTaskList={changeTaskList}
                  onDeleteTask={() => void deleteSelectedTask()}
                  saveState={saveState}
                  saveMessage={saveMessage}
                  onClose={() => setSelectedTaskId("")}
                />
              ) : null}
            </div>
          ) : null}
        </main>
        <ManageListsModal
          open={manageListsOpen}
          lists={lists}
          tasks={tasks}
          listColorMap={listColorMap}
          listCustomColorMap={listCustomColorMap}
          language={language}
          onColorChange={(listId, colorIndex) => {
            setListColorMap((current) => ({ ...current, [listId]: colorIndex }));
            setListCustomColorMap((current) => {
              const next = { ...current };
              delete next[listId];
              return next;
            });
          }}
          onCustomColorChange={(listId, color) =>
            setListCustomColorMap((current) => ({ ...current, [listId]: color }))
          }
          onCreateList={createList}
          onRenameList={renameList}
          onDeleteList={deleteList}
          onSelectList={(listId) => {
            selectList(listId);
            setManageListsOpen(false);
          }}
          onClose={() => setManageListsOpen(false)}
        />

        <SettingsModal
          open={settingsOpen}
          theme={theme}
          showCompleted={showCompleted}
          showTaskCount={showTaskCount}
          showCollapsedSidebarBadges={showCollapsedSidebarBadges}
          expandSubtasks={expandSubtasks}
          googleProxyConfig={googleProxyConfig}
          googleProxySaving={googleProxySaving}
          googleProxyMessage={googleProxyMessage}
          lastGoogleError={lastGoogleError}
          googleSignedIn={Boolean(authStatus?.signed_in)}
          googleSyncing={googleSyncing}
          googleUserName={authStatus?.user_name ?? uiText(language, "Google Tasks User", "Google Tasks 用户")}
          googleUserEmail={authStatus?.user_email ?? authStatus?.user_hint ?? ""}
          googleUserPicture={authStatus?.user_picture ?? ""}
          language={language}
          onGoogleLogin={() => void loginGoogle()}
          onGoogleSync={() => void refreshGoogleWorkspaceData(activeListId)}
          onGoogleSignOut={() => void signOutGoogle()}
          onLanguageChange={setLanguage}
          onClose={() => setSettingsOpen(false)}
          onThemeChange={setTheme}
          onGoogleProxyChange={setGoogleProxyConfig}
          onGoogleProxySave={() => void saveGoogleProxyConfig()}
          hotkeys={hotkeys}
          startupEnabled={startupEnabled}
          startupSaving={startupSaving}
          startupMessage={startupMessage}
          minimizeOnLaunch={launchMinimizedOnStart}
          closeButtonBehavior={closeButtonBehavior}
          autoSyncMode={autoSyncMode}
          calendarLists={calendarLists}
          selectedCalendarIds={selectedCalendarIds}
          loadingCalendarLists={loadingCalendarLists}
          calendarListMessage={calendarListMessage}
          onHotkeyChange={(key, value) => setHotkeys((current) => ({ ...current, [key]: value }))}
          onHotkeysReset={() => setHotkeys(defaultHotkeys)}
          onStartupChange={(enabled) => void changeStartupEnabled(enabled)}
          onMinimizeOnLaunchChange={changeLaunchMinimizedOnStart}
          onCloseButtonBehaviorChange={changeCloseButtonBehavior}
          onAutoSyncModeChange={setAutoSyncMode}
          onCalendarSelectionChange={(calendarId, selected) => {
            setSelectedCalendarIds((current) => {
              const base = current ?? calendarLists.filter((calendar) => calendar.selected).map((calendar) => calendar.id);
              if (selected) {
                return base.includes(calendarId) ? base : [...base, calendarId];
              }
              return base.filter((id) => id !== calendarId);
            });
          }}
          onShowCompletedChange={setShowCompleted}
          onShowTaskCountChange={setShowTaskCount}
          onShowCollapsedSidebarBadgesChange={setShowCollapsedSidebarBadges}
          onExpandSubtasksChange={setExpandSubtasks}
        />
      </div>
    </div>
  );
}

type DesignSidebarProps = {
  lists: TaskListSummary[];
  tasks: Task[];
  notes: Note[];
  noteLabels: Array<{ label: string; count: number }>;
  activeListId: string;
  activeSmartView: SmartView | null;
  activeNoteFilter: NoteFilter;
  activeNoteLabel: string | null;
  activeView: WorkspaceView;
  language: LanguageMode;
  showCompleted: boolean;
  searchValue: string;
  showTaskCount: boolean;
  showCollapsedSidebarBadges: boolean;
  collapsed: boolean;
  signedIn: boolean;
  userName: string;
  userEmail: string;
  userPicture: string;
  listColorMap: Record<string, number>;
  listCustomColorMap: ListCustomColorMap;
  syncState: "online" | "offline" | "syncing" | "error";
  syncMessage: string;
  onSearchChange: (value: string) => void;
  onSelectList: (listId: string) => void;
  onSelectSmartView: (view: SmartView) => void;
  onSelectNotesHome: () => void;
  onSelectNoteFilter: (filter: NoteFilter) => void;
  onSelectNoteLabel: (label: string) => void;
  onCreateList: () => void;
  onCreateNote: () => void;
  onAccountClick: () => void;
  onSync: () => void;
  onUtilityView: (view: WorkspaceView) => void;
  onToggleCollapsed: () => void;
};

function DesignSidebar({
  lists,
  tasks,
  notes,
  noteLabels,
  activeListId,
  activeSmartView,
  activeNoteFilter,
  activeNoteLabel,
  activeView,
  language,
  showCompleted,
  searchValue,
  showTaskCount,
  showCollapsedSidebarBadges,
  collapsed,
  signedIn,
  userName,
  userEmail,
  userPicture,
  listColorMap,
  listCustomColorMap,
  syncState,
  syncMessage,
  onSearchChange,
  onSelectList,
  onSelectSmartView,
  onSelectNotesHome,
  onSelectNoteFilter,
  onSelectNoteLabel,
  onCreateList,
  onCreateNote,
  onAccountClick,
  onSync,
  onUtilityView,
  onToggleCollapsed,
}: DesignSidebarProps) {
  const smartViews: Array<{ id: SmartView; label: string; icon: typeof CalendarDays }> = [
    { id: "today", label: smartViewTitle("today", language), icon: CalendarCheck },
    { id: "tomorrow", label: smartViewTitle("tomorrow", language), icon: CalendarClock },
    { id: "past", label: smartViewTitle("past", language), icon: Clock3 },
    { id: "all", label: smartViewTitle("all", language), icon: CheckCircle2 },
  ];

  const SyncIcon = syncState === "offline" ? CloudOff : syncState === "syncing" ? RefreshCw : Cloud;
  const countableTasks = showCompleted ? tasks : tasks.filter((task) => !task.completed);
  const activeNotes = notes.filter((note) => !note.archived);
  const noteFilters: Array<{ id: NoteFilter; label: string; icon: typeof StickyNote; count: number }> = [
    { id: "all", label: uiText(language, "All Notes", "全部笔记"), icon: StickyNote, count: activeNotes.length },
    { id: "pinned", label: uiText(language, "Pinned", "已置顶"), icon: Pin, count: activeNotes.filter((note) => note.pinned).length },
    { id: "reminders", label: uiText(language, "Reminders", "提醒"), icon: Bell, count: activeNotes.filter((note) => note.reminderDate).length },
    { id: "archive", label: uiText(language, "Archive", "归档"), icon: Archive, count: notes.filter((note) => note.archived).length },
  ];
  const showCollapsedCountBadges = collapsed && showTaskCount && showCollapsedSidebarBadges;
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const [listOverflowing, setListOverflowing] = useState(false);
  const syncClass =
    syncState === "error"
      ? "text-error"
      : syncState === "offline"
        ? "text-warning"
        : syncState === "syncing"
          ? "text-secondary"
          : "text-success";

  useEffect(() => {
    const element = listScrollRef.current;
    if (!element) {
      return;
    }
    const updateOverflow = () => {
      setListOverflowing(element.scrollHeight > element.clientHeight + 1);
    };
    updateOverflow();
    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(element);
    Array.from(element.children).forEach((child) => resizeObserver.observe(child));
    element.addEventListener("scroll", updateOverflow);
    window.addEventListener("resize", updateOverflow);
    return () => {
      resizeObserver.disconnect();
      element.removeEventListener("scroll", updateOverflow);
      window.removeEventListener("resize", updateOverflow);
    };
  }, [collapsed, lists.length, smartViews.length, showTaskCount, tasks.length]);

  return (
    <aside
      className={cn(
        "hidden h-full shrink-0 flex-col border-r border-hairline bg-surface-soft py-md md:flex dark:border-surface-dark-elevated dark:bg-surface-dark-elevated",
        collapsed ? "w-16 px-xs" : "w-[292px] px-md",
      )}
    >
      <button
        className={cn(
          "app-focus-ring flex h-11 items-center gap-sm rounded-lg text-left transition-colors hover:bg-surface-card dark:hover:bg-surface-dark",
          collapsed ? "justify-center px-xs" : "px-sm",
        )}
        onClick={onAccountClick}
      >
        <UserAvatar
          signedIn={signedIn}
          name={userName}
          email={userEmail}
          picture={userPicture}
          fallback={uiText(language, "NO", "未")}
          className="h-9 w-9 text-caption"
        />
        {!collapsed ? (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-title-md text-ink dark:text-on-dark">{userName}</div>
              <div className="truncate text-caption text-muted dark:text-on-dark-soft">{userEmail}</div>
            </div>
            <ChevronDown size={16} className="text-muted" />
          </>
        ) : null}
      </button>

      {!collapsed ? (
        <>
          <Button className="mt-md w-full rounded-lg shadow-subtle active:translate-y-px" onClick={activeView === "notes" ? onCreateNote : onCreateList}>
            <Plus size={18} />
            {activeView === "notes" ? uiText(language, "New note", "新笔记") : uiText(language, "New List", "新建清单")}
          </Button>
          <label className="mt-md flex h-10 items-center gap-sm rounded-lg border border-hairline bg-surface-card px-sm shadow-subtle transition-colors focus-within:border-primary dark:border-surface-dark-elevated dark:bg-surface-dark">
            <Search size={17} className="text-muted" />
            <input
              data-search-input="true"
              className="min-w-0 flex-1 border-none bg-transparent p-0 text-body-sm text-ink outline-none placeholder:text-muted focus:ring-0 dark:text-on-dark"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={uiText(language, "Search tasks...", "搜索任务...")}
            />
          </label>
        </>
      ) : null}

      <div
        className={cn(
          "mt-md rounded-xl border border-hairline bg-surface-card p-1 shadow-subtle dark:border-surface-dark-elevated dark:bg-surface-dark",
          collapsed ? "grid gap-1" : "grid grid-cols-2 gap-1",
        )}
      >
        <button
          className={cn(
            "app-focus-ring flex h-9 items-center rounded-lg text-body-sm font-medium transition-colors",
            collapsed ? "justify-center px-xs" : "justify-center gap-xs px-sm",
            activeView !== "notes"
              ? "border border-blue-100 bg-blue-50 text-primary shadow-subtle dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200"
              : "text-body hover:bg-surface-card dark:text-on-dark-soft dark:hover:bg-surface-dark",
          )}
          onClick={() => onSelectSmartView(activeSmartView ?? "today")}
          title={uiText(language, "Tasks", "任务")}
        >
          <ListChecks size={18} />
          {!collapsed ? <span>{uiText(language, "Tasks", "任务")}</span> : null}
        </button>
        <button
          className={cn(
            "app-focus-ring flex h-9 items-center rounded-lg text-body-sm font-medium transition-colors",
            collapsed ? "justify-center px-xs" : "justify-center gap-xs px-sm",
            activeView === "notes"
              ? "border border-blue-100 bg-blue-50 text-primary shadow-subtle dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200"
              : "text-body hover:bg-surface-card dark:text-on-dark-soft dark:hover:bg-surface-dark",
          )}
          onClick={onSelectNotesHome}
          title={uiText(language, "Notes", "笔记")}
        >
          <StickyNote size={18} />
          {!collapsed ? <span>{uiText(language, "Notes", "笔记")}</span> : null}
        </button>
      </div>

      <div ref={listScrollRef} id="sidebar-list-scroll" className="mt-md min-h-0 flex-1 overflow-y-auto pr-1 app-scrollbar">
        {activeView === "notes" ? (
          <>
            <nav className="space-y-xs">
              {noteFilters.map((item) => {
                const Icon = item.icon;
                const active = activeNoteFilter === item.id && !activeNoteLabel;
                return (
                  <button
                    key={item.id}
                    className={cn(
                      "app-focus-ring relative flex h-10 w-full items-center rounded-lg text-left text-title-md transition-colors",
                      collapsed ? "justify-center px-xs" : "gap-sm px-sm",
                      active
                        ? "bg-primary text-on-dark shadow-subtle dark:bg-primary dark:text-on-dark"
                        : "text-body hover:bg-surface-card dark:text-on-dark-soft dark:hover:bg-surface-dark",
                    )}
                    onClick={() => onSelectNoteFilter(item.id)}
                    title={item.label}
                  >
                    <Icon size={20} />
                    {showCollapsedCountBadges ? <CollapsedCountBadge count={item.count} active={active} /> : null}
                    {!collapsed ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
                    {!collapsed && showTaskCount ? <span className="text-caption opacity-70">{item.count}</span> : null}
                  </button>
                );
              })}
            </nav>
            <div className="mt-md">
              {!collapsed ? <div className="px-sm text-caption font-semibold text-muted">{uiText(language, "Labels", "标签")}</div> : null}
              <div className="mt-xs space-y-xs">
                {noteLabels.map((item) => {
                  const active = activeNoteLabel === item.label;
                  return (
                    <button
                      key={item.label}
                      className={cn(
                        "app-focus-ring relative flex h-10 w-full items-center rounded-lg text-left text-title-md transition-colors",
                        collapsed ? "justify-center px-xs" : "gap-sm px-sm",
                        active
                          ? "bg-primary text-on-dark shadow-subtle dark:bg-primary dark:text-on-dark"
                          : "text-body hover:bg-surface-card dark:text-on-dark-soft dark:hover:bg-surface-dark",
                      )}
                      onClick={() => onSelectNoteLabel(item.label)}
                      title={item.label}
                    >
                      <Tag size={19} />
                      {showCollapsedCountBadges ? <CollapsedCountBadge count={item.count} active={active} /> : null}
                      {!collapsed ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
                      {!collapsed && showTaskCount ? <span className="text-caption opacity-70">{item.count}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <>
            <nav className="space-y-xs">
              {smartViews.map((item) => {
                const Icon = item.icon;
                const count = item.id === "all"
                  ? countableTasks.length
                  : countableTasks.filter((task) => task.dueLabel === item.id).length;
                const active = activeView === "list" && activeSmartView === item.id;
                return (
                  <button
                    key={item.id}
                    className={cn(
                      "app-focus-ring relative flex h-10 w-full items-center rounded-lg text-left text-title-md transition-colors",
                      collapsed ? "justify-center px-xs" : "gap-sm px-sm",
                      active
                        ? "bg-primary text-on-dark shadow-subtle dark:bg-primary dark:text-on-dark"
                        : "text-body hover:bg-surface-card dark:text-on-dark-soft dark:hover:bg-surface-dark",
                    )}
                    onClick={() => onSelectSmartView(item.id)}
                    title={item.label}
                  >
                    <Icon size={20} />
                    {showCollapsedCountBadges ? <CollapsedCountBadge count={count} active={active} /> : null}
                    {!collapsed ? <span>{item.label}</span> : null}
                    {!collapsed && showTaskCount ? <span className="ml-auto rounded-full bg-surface-card px-xs text-caption text-muted dark:bg-surface-dark-elevated">{count}</span> : null}
                  </button>
                );
              })}
            </nav>

            <div className="mt-md">
              {!collapsed ? <div className="px-sm text-caption font-semibold text-muted">{uiText(language, "Lists", "清单")}</div> : null}
              <div className="mt-xs space-y-xs">
                {lists.map((list, index) => {
                  const ListIcon = [Folder, Briefcase, Home][index % 3];
                  const count = countableTasks.filter((task) => task.listId === list.id).length;
                  const active = activeView === "list" && !activeSmartView && activeListId === list.id;
                  return (
                    <button
                      key={list.id}
                      className={cn(
                        "app-focus-ring relative flex h-10 w-full items-center rounded-lg text-left text-title-md transition-colors",
                        collapsed ? "justify-center px-xs" : "gap-sm px-sm",
                        active ? "bg-primary text-on-dark shadow-subtle dark:bg-primary dark:text-on-dark" : listToneClass(list.id, lists, listColorMap, listCustomColorMap),
                      )}
                      style={!active ? customColorStyle(listCustomColorMap[list.id]) : undefined}
                      onClick={() => onSelectList(list.id)}
                      title={list.name}
                    >
                      <ListIcon size={20} className={active ? "" : list.iconClassName} />
                      {showCollapsedCountBadges ? <CollapsedCountBadge count={count} active={active} /> : null}
                      {!collapsed ? <span className="min-w-0 flex-1 truncate">{list.name}</span> : null}
                      {!collapsed && showTaskCount ? <span className="text-caption opacity-70">{count}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-hairline pt-md dark:border-surface-dark">
        {listOverflowing ? (
          <button
            className={cn(
              "mb-sm flex h-8 w-full items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-card dark:hover:bg-surface-dark",
              collapsed && "h-9",
            )}
            onClick={() => listScrollRef.current?.scrollBy({ top: 160, behavior: "smooth" })}
            title={uiText(language, "Scroll lists", "滚动清单")}
          >
            <ChevronDown size={18} />
            {!collapsed ? <span className="ml-xs text-caption">{uiText(language, "More", "更多")}</span> : null}
          </button>
        ) : null}
        <button
          className={cn(
            "app-focus-ring flex h-10 w-full items-center rounded-lg text-body transition-colors hover:bg-surface-card dark:text-on-dark-soft dark:hover:bg-surface-dark",
            collapsed ? "justify-center px-xs" : "gap-sm px-sm",
            activeView === "archive" && "bg-surface-card text-ink shadow-subtle dark:bg-surface-dark dark:text-on-dark",
          )}
          onClick={() => onUtilityView("archive")}
          title={uiText(language, "Archive and trash", "归档和回收站")}
        >
          <Archive size={19} />
          {!collapsed ? <span>{uiText(language, "Archive / Trash", "归档 / 删除")}</span> : null}
        </button>
        <div className={cn("mt-sm flex items-center", collapsed ? "flex-col gap-xs" : "justify-between")}>
          <button
            className={cn("app-focus-ring grid h-9 w-9 place-items-center rounded-lg transition-colors hover:bg-surface-card", syncClass)}
            onClick={onSync}
            title={syncMessage}
          >
            <SyncIcon size={19} className={syncState === "syncing" ? "animate-spin" : ""} />
          </button>
          <button
            className="app-focus-ring grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-card"
            onClick={onToggleCollapsed}
            title={collapsed ? uiText(language, "Expand sidebar", "展开侧边栏") : uiText(language, "Collapse sidebar", "收起侧边栏")}
          >
            {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
          </button>
        </div>
      </div>
    </aside>
  );
}

function CollapsedCountBadge({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-xxs text-[10px] font-semibold leading-none shadow-subtle",
        active ? "bg-on-dark text-primary" : "bg-primary text-on-dark",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function UserAvatar({
  signedIn,
  name,
  email,
  picture,
  fallback,
  className,
}: {
  signedIn: boolean;
  name: string;
  email: string;
  picture?: string | null;
  fallback: string;
  className?: string;
}) {
  const initials = signedIn ? (name || email || "GT").slice(0, 2).toUpperCase() : fallback;

  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary font-semibold text-on-dark shadow-subtle",
        !signedIn && "bg-muted",
        className,
      )}
    >
      {signedIn && picture ? (
        <img className="h-full w-full rounded-full object-cover" src={picture} alt={name || email || "Google user"} />
      ) : (
        initials
      )}
    </div>
  );
}

type DesignTopBarProps = {
  activeView: WorkspaceView;
  language: LanguageMode;
  onViewChange: (view: WorkspaceView) => void;
};

function DesignTopBar({
  activeView,
  language,
  onViewChange,
}: DesignTopBarProps) {
  const tabs: Array<{ id: WorkspaceView; label: string }> = [
    { id: "list", label: uiText(language, "Tasks", "任务") },
    { id: "board", label: uiText(language, "Board", "看板") },
    { id: "notes", label: uiText(language, "Notes", "笔记") },
    { id: "calendar", label: uiText(language, "Calendar", "日历") },
  ];

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-hairline bg-canvas/95 px-lg dark:border-surface-dark-elevated dark:bg-surface-dark">
      <nav className="inline-flex rounded-lg border border-hairline bg-surface-soft p-1 shadow-subtle dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              "app-focus-ring h-9 rounded-md px-md text-title-md transition-colors",
              activeView === tab.id
                ? "bg-canvas text-primary shadow-subtle dark:bg-surface-dark dark:text-on-dark"
                : "text-muted hover:text-ink dark:text-on-dark-soft dark:hover:text-on-dark",
            )}
            onClick={() => onViewChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="ml-auto" />
    </header>
  );
}

type ListWorkspaceProps = {
  title: string;
  subtitle: string;
  items: TaskListItem[];
  lists: TaskListSummary[];
  listColorMap: Record<string, number>;
  listCustomColorMap: ListCustomColorMap;
  selectedTaskId: string | null;
  selectedCalendarEventId: string | null;
  language: LanguageMode;
  showCompleted: boolean;
  newTaskTitle: string;
  onNewTaskTitleChange: (value: string) => void;
  onAddTask: () => void;
  onSelectTask: (taskId: string) => void;
  onSelectCalendarEvent: (eventId: string) => void;
  onToggleTask: (taskId: string) => void;
  onShowCompletedChange: (checked: boolean) => void;
};

function ListWorkspace({
  title,
  subtitle,
  items,
  lists,
  listColorMap,
  listCustomColorMap,
  selectedTaskId,
  selectedCalendarEventId,
  language,
  showCompleted,
  newTaskTitle,
  onNewTaskTitleChange,
  onAddTask,
  onSelectTask,
  onSelectCalendarEvent,
  onToggleTask,
  onShowCompletedChange,
}: ListWorkspaceProps) {
  const completedCount = items.filter((item) => item.kind === "task" && item.task.completed).length;
  const openTaskCount = items.filter((item) => item.kind === "task" && !item.task.completed).length;
  const todayCount = items.filter((item) => item.kind === "task" && !item.task.completed && item.task.dueLabel === "today").length;
  const calendarCount = items.filter((item) => item.kind === "calendar").length;

  return (
    <section className="min-w-0 flex-1 overflow-y-auto bg-canvas px-lg py-lg dark:bg-surface-dark">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-start justify-between gap-lg">
          <div>
            <h1 className="font-display text-display-md text-ink dark:text-on-dark">{title}</h1>
            <p className="mt-xs text-body-md text-muted dark:text-on-dark-soft">{subtitle}</p>
          </div>
          <button
            className={cn(
              "app-focus-ring inline-flex h-9 shrink-0 items-center gap-sm rounded-lg border border-hairline px-sm text-body-sm transition-colors active:translate-y-px",
              showCompleted ? "bg-primary text-on-dark shadow-subtle" : "bg-surface-card text-muted hover:text-ink",
            )}
            onClick={() => onShowCompletedChange(!showCompleted)}
          >
            <ListChecks size={17} />
            {showCompleted
              ? uiText(language, `Completed shown (${completedCount})`, `显示已完成（${completedCount}）`)
              : uiText(language, `Completed hidden (${completedCount})`, `隐藏已完成（${completedCount}）`)}
          </button>
        </div>

        <div className="mt-lg grid grid-cols-3 gap-sm">
          <SummaryTile label={uiText(language, "Open", "未完成")} value={openTaskCount} />
          <SummaryTile label={uiText(language, "Today", "今天")} value={todayCount} />
          <SummaryTile label={uiText(language, "Calendar", "日程")} value={calendarCount} />
        </div>

        <div className="mt-lg flex h-12 items-center gap-sm rounded-xl border border-hairline bg-surface-card px-sm shadow-subtle transition-colors focus-within:border-primary dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
          <Plus size={20} className="text-muted" />
          <input
            className="min-w-0 flex-1 border-none bg-transparent p-0 text-body-md text-ink outline-none placeholder:text-muted focus:ring-0 dark:text-on-dark"
            value={newTaskTitle}
            onChange={(event) => onNewTaskTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onAddTask();
              }
            }}
            placeholder={uiText(language, "New task", "新任务")}
          />
          <Button className="h-8 px-sm active:translate-y-px" onClick={onAddTask}>{uiText(language, "Add", "添加")}</Button>
        </div>

        <div className="mt-lg space-y-sm">
          {items.length === 0 ? (
            <EmptyState
              title={uiText(language, "No tasks here", "这里没有任务")}
              description={uiText(language, "Create a task or switch to another list.", "创建任务或切换到其他清单。")}
            />
          ) : (
            items.map((item) =>
              item.kind === "task" ? (
                <TaskRow
                  key={item.id}
                  task={item.task}
                  listName={lists.find((list) => list.id === item.task.listId)?.name ?? "Tasks"}
                  toneClass={listToneClass(item.task.listId, lists, listColorMap, listCustomColorMap)}
                  toneStyle={customColorStyle(listCustomColorMap[item.task.listId])}
                  listLabelClass={listLabelToneClass(item.task.listId, lists, listColorMap, listCustomColorMap)}
                  listLabelStyle={customColorStyle(listCustomColorMap[item.task.listId], "label")}
                  language={language}
                  selected={selectedTaskId === item.task.id}
                  onSelect={() => onSelectTask(item.task.id)}
                  onToggle={() => onToggleTask(item.task.id)}
                />
              ) : (
                <CalendarEventRow
                  key={item.id}
                  event={item.event}
                  language={language}
                  selected={selectedCalendarEventId === item.id}
                  onSelect={() => onSelectCalendarEvent(item.id)}
                />
              ),
            )
          )}
        </div>
      </div>
    </section>
  );
}

type TaskRowProps = {
  task: Task;
  listName: string;
  toneClass: string;
  toneStyle?: CSSProperties;
  listLabelClass: string;
  listLabelStyle?: CSSProperties;
  language: LanguageMode;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
};

function TaskRow({
  task,
  listName,
  toneClass,
  toneStyle,
  listLabelClass,
  listLabelStyle,
  language,
  selected,
  onSelect,
  onToggle,
}: TaskRowProps) {
  return (
    <article
      data-detail-interactive="true"
      className={cn(
        "rounded-xl border border-hairline bg-surface-card p-md shadow-subtle transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-panel dark:border-surface-dark-elevated dark:bg-surface-dark-elevated",
        !selected && toneClass,
        selected && "border-primary bg-canvas ring-2 ring-primary/10 dark:border-primary dark:bg-surface-dark",
      )}
      style={!selected ? toneStyle : undefined}
    >
      <div className="flex items-start gap-md">
        <CompletionButton completed={task.completed} onClick={onToggle} />
        <button className="min-w-0 flex-1 text-left" onClick={onSelect}>
          <div className={cn("text-title-md text-ink dark:text-on-dark", task.completed && "text-muted line-through")}>{task.title}</div>
          <div className="mt-xs flex flex-wrap items-center gap-xs text-caption text-muted">
            <Badge className={listLabelClass} style={listLabelStyle}>{listName}</Badge>
            {task.dueText ? <Badge className={dueLabelToneClass(task)}>{displayDueText(task.dueText, language)}</Badge> : null}
            {task.estimate ? <Badge className="border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-400/30 dark:bg-zinc-400/10 dark:text-zinc-200">{task.estimate}</Badge> : null}
          </div>
        </button>
      </div>
    </article>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-card px-md py-sm shadow-subtle dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
      <div className="text-caption text-muted dark:text-on-dark-soft">{label}</div>
      <div className="mt-xxs text-title-lg text-ink dark:text-on-dark">{value}</div>
    </div>
  );
}

function CalendarEventRow({
  event,
  language,
  selected,
  onSelect,
}: {
  event: CalendarEvent;
  language: LanguageMode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <article
      data-detail-interactive="true"
      className={cn(
        "rounded-xl border border-hairline bg-surface-card p-md shadow-subtle transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-panel dark:border-surface-dark-elevated dark:bg-surface-dark-elevated",
        selected && "border-primary ring-2 ring-primary/10 dark:border-primary",
      )}
      style={{ borderLeftColor: event.color ?? "#8B5CF6", borderLeftWidth: 4 }}
    >
      <div className="flex items-start gap-md">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-200">
          <CalendarDays size={17} />
        </div>
        <button className="min-w-0 flex-1 text-left" onClick={onSelect}>
          <div className="text-title-md text-ink dark:text-on-dark">{event.title}</div>
          <div className="mt-xs flex flex-wrap items-center gap-xs text-caption text-muted">
            <Badge className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-200">
              Google Calendar
            </Badge>
            <Badge>{event.calendar_name}</Badge>
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200">
              {calendarDateForEvent(event)}
              {event.all_day ? "" : ` ${formatCalendarEventTime(event, language)}`}
            </Badge>
          </div>
        </button>
      </div>
    </article>
  );
}

function noteViewTitle(filter: NoteFilter, activeLabel: string | null, language: LanguageMode) {
  if (activeLabel) {
    return activeLabel;
  }
  const titles: Record<NoteFilter, [string, string]> = {
    all: ["Notes", "笔记"],
    pinned: ["Pinned", "已置顶"],
    reminders: ["Reminders", "提醒"],
    archive: ["Archive", "归档"],
  };
  return uiText(language, titles[filter][0], titles[filter][1]);
}

type NotesWorkspaceProps = {
  notes: Note[];
  allNotes: Note[];
  activeFilter: NoteFilter;
  activeLabel: string | null;
  language: LanguageMode;
  newNoteTitle: string;
  selectedNoteId: string;
  onNewNoteTitleChange: (value: string) => void;
  onCreateNote: () => void;
  onSelectNote: (noteId: string) => void;
  onTogglePinned: (noteId: string) => void;
};

function NotesWorkspace({
  notes,
  allNotes,
  activeFilter,
  activeLabel,
  language,
  newNoteTitle,
  selectedNoteId,
  onNewNoteTitleChange,
  onCreateNote,
  onSelectNote,
  onTogglePinned,
}: NotesWorkspaceProps) {
  const activeNotes = allNotes.filter((note) => !note.archived);
  const pinnedCount = activeNotes.filter((note) => note.pinned).length;
  const reminderCount = activeNotes.filter((note) => note.reminderDate).length;

  return (
    <section className="min-w-0 flex-1 overflow-y-auto bg-canvas px-lg py-lg dark:bg-surface-dark">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-start justify-between gap-lg">
          <div>
            <h1 className="font-display text-display-md text-ink dark:text-on-dark">
              {noteViewTitle(activeFilter, activeLabel, language)}
            </h1>
            <p className="mt-xs text-body-md text-muted dark:text-on-dark-soft">
              {uiText(language, "Keep ideas, checklists, and reference notes alongside tasks.", "把想法、清单和参考资料放在任务旁边。")}
            </p>
          </div>
          <div className="hidden items-center gap-xs rounded-xl border border-hairline bg-surface-card px-sm py-xs text-caption text-muted shadow-subtle lg:flex dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
            <Cloud size={16} />
            {uiText(language, "Local notes. Keep sync can be connected later.", "本地笔记。Keep 同步可后续接入。")}
          </div>
        </div>

        <div className="mt-lg grid grid-cols-3 gap-sm">
          <SummaryTile label={uiText(language, "All Notes", "全部笔记")} value={activeNotes.length} />
          <SummaryTile label={uiText(language, "Pinned", "已置顶")} value={pinnedCount} />
          <SummaryTile label={uiText(language, "Reminders", "提醒")} value={reminderCount} />
        </div>

        <div className="mt-lg flex h-12 items-center gap-sm rounded-xl border border-hairline bg-surface-card px-sm shadow-subtle transition-colors focus-within:border-primary dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
          <Lightbulb size={20} className="text-muted" />
          <input
            className="min-w-0 flex-1 border-none bg-transparent p-0 text-body-md text-ink outline-none placeholder:text-muted focus:ring-0 dark:text-on-dark"
            value={newNoteTitle}
            onChange={(event) => onNewNoteTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onCreateNote();
              }
            }}
            placeholder={uiText(language, "Take a note...", "写一条笔记...")}
          />
          <Button className="h-8 px-sm active:translate-y-px" onClick={onCreateNote}>
            {uiText(language, "Add", "添加")}
          </Button>
        </div>

        <div className="mt-lg columns-1 gap-md md:columns-2 2xl:columns-3">
          {notes.length === 0 ? (
            <div className="break-inside-avoid">
              <EmptyState
                title={uiText(language, "No notes here", "这里没有笔记")}
                description={uiText(language, "Create a note or switch to another filter.", "创建笔记或切换到其他筛选。")}
              />
            </div>
          ) : (
            notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                language={language}
                selected={selectedNoteId === note.id}
                onSelect={() => onSelectNote(note.id)}
                onTogglePinned={() => onTogglePinned(note.id)}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function NoteCard({
  note,
  language,
  selected,
  onSelect,
  onTogglePinned,
}: {
  note: Note;
  language: LanguageMode;
  selected: boolean;
  onSelect: () => void;
  onTogglePinned: () => void;
}) {
  return (
    <article
      data-detail-interactive="true"
      className={cn(
        "mb-md break-inside-avoid rounded-xl border border-hairline p-md shadow-subtle transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-panel dark:border-surface-dark-elevated",
        noteColorClass(note.color),
        selected && "border-primary ring-2 ring-primary/10 dark:border-primary",
      )}
    >
      <div className="flex items-start gap-sm">
        <button className="min-w-0 flex-1 text-left" onClick={onSelect}>
          <div className="text-title-md text-ink dark:text-on-dark">{note.title || uiText(language, "Untitled note", "无标题笔记")}</div>
        </button>
        <button
          className={cn(
            "app-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-white/70 dark:hover:bg-surface-dark",
            note.pinned ? "text-primary" : "text-muted",
          )}
          onClick={onTogglePinned}
          title={uiText(language, "Pinned", "已置顶")}
        >
          <Pin size={17} />
        </button>
      </div>
      {note.body ? (
        <button className="mt-sm block w-full text-left" onClick={onSelect}>
          <p className="max-h-36 overflow-hidden whitespace-pre-line text-body-sm text-body dark:text-on-dark-soft">
            {note.body}
          </p>
        </button>
      ) : null}
      <div className="mt-md flex flex-wrap items-center gap-xs">
        {note.labels.map((label) => (
          <Badge key={label} className="border-zinc-200 bg-white/70 text-zinc-700 dark:border-zinc-400/30 dark:bg-zinc-400/10 dark:text-zinc-200">
            {label}
          </Badge>
        ))}
        {note.reminderDate ? (
          <Badge className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-200">
            {note.reminderDate}
          </Badge>
        ) : null}
      </div>
    </article>
  );
}

type NoteDetailsPanelProps = {
  note: Note;
  language: LanguageMode;
  saveState: SaveState;
  saveMessage: string;
  onUpdateNote: (noteId: string, patch: Partial<Note>) => void;
  onPersistNote: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onCreateTask: () => void;
  availableLabels: string[];
  onClose: () => void;
};

function NoteDetailsPanel({
  note,
  language,
  saveState,
  saveMessage,
  onUpdateNote,
  onPersistNote,
  onArchive,
  onDelete,
  onCreateTask,
  availableLabels,
  onClose,
}: NoteDetailsPanelProps) {
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [labelDraft, setLabelDraft] = useState("");

  useEffect(() => {
    const autosize = (element: HTMLTextAreaElement | null, maxHeight: number) => {
      if (!element) {
        return;
      }
      element.style.height = "0px";
      element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
    };
    autosize(titleRef.current, 160);
    autosize(bodyRef.current, 520);
  }, [note.id, note.title, note.body]);

  const addLabels = (value: string) => {
    const nextLabels = value
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    if (nextLabels.length === 0) {
      return;
    }
    onUpdateNote(note.id, { labels: [...new Set([...note.labels, ...nextLabels])] });
    setLabelDraft("");
    onPersistNote();
  };

  const toggleLabel = (label: string) => {
    const labels = note.labels.includes(label)
      ? note.labels.filter((item) => item !== label)
      : [...note.labels, label];
    onUpdateNote(note.id, { labels });
    onPersistNote();
  };

  return (
    <aside data-detail-interactive="true" className="hidden w-[420px] shrink-0 flex-col border-l border-hairline bg-surface-soft px-lg py-lg xl:flex dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
      <div className="flex shrink-0 items-center justify-between">
        <button className="app-focus-ring grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-card" onClick={onClose} title={uiText(language, "Close details", "关闭详情")}>
          <X size={18} />
        </button>
        <span className="rounded-lg border border-hairline bg-surface-card px-sm py-xs text-caption text-muted shadow-subtle dark:border-surface-dark dark:bg-surface-dark">
          {note.archived ? uiText(language, "Archive", "归档") : uiText(language, "Notes", "笔记")}
        </span>
        <div className="flex items-center gap-xs">
          <button
            className={cn(
              "app-focus-ring grid h-9 w-9 place-items-center rounded-lg transition-colors hover:bg-surface-card",
              note.pinned ? "text-primary" : "text-muted",
            )}
            onClick={() => {
              onUpdateNote(note.id, { pinned: !note.pinned });
              onPersistNote();
            }}
            title={note.pinned ? uiText(language, "Pinned", "已置顶") : uiText(language, "Pin note", "置顶笔记")}
          >
            <Pin size={18} />
          </button>
          <button className="app-focus-ring grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-card" onClick={onArchive} title={uiText(language, "Archive note", "归档笔记")}>
            <Archive size={18} />
          </button>
          <button className="app-focus-ring grid h-9 w-9 place-items-center rounded-lg text-error transition-colors hover:bg-error-container/30" onClick={onDelete} title={uiText(language, "Delete note", "删除笔记")}>
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      <div className="app-scrollbar mt-lg min-h-0 flex-1 overflow-y-auto pr-xs">
        <div className="space-y-md">
          <textarea
            ref={titleRef}
            rows={1}
            className={cn(
              "min-h-[56px] max-h-40 w-full resize-none overflow-y-auto rounded-xl border border-hairline px-md py-sm text-title-lg text-ink outline-none transition-colors focus:border-primary dark:border-surface-dark dark:text-on-dark",
              noteColorClass(note.color),
            )}
            value={note.title}
            onChange={(event) => onUpdateNote(note.id, { title: event.target.value })}
            onBlur={onPersistNote}
            placeholder={uiText(language, "New note", "新笔记")}
          />
          <textarea
            ref={bodyRef}
            rows={10}
            className={cn(
              "min-h-[280px] max-h-[520px] w-full resize-none overflow-y-auto rounded-xl border border-hairline px-md py-sm text-body-md text-ink outline-none transition-colors focus:border-primary dark:border-surface-dark dark:text-on-dark",
              noteColorClass(note.color),
            )}
            value={note.body}
            onChange={(event) => onUpdateNote(note.id, { body: event.target.value })}
            onBlur={onPersistNote}
            placeholder={uiText(language, "Take a note...", "写一条笔记...")}
          />

          <div className="grid grid-cols-[36px_1fr] items-center gap-md">
            <Tag size={20} className="text-muted" />
            <div className="space-y-sm rounded-xl border border-hairline bg-surface-card p-sm dark:border-surface-dark dark:bg-surface-dark">
              {availableLabels.length > 0 ? (
                <div className="space-y-xs">
                  <div className="text-caption text-muted">{uiText(language, "Existing labels", "已有标签")}</div>
                  <div className="flex flex-wrap gap-xs">
                    {availableLabels.map((label) => {
                      const active = note.labels.includes(label);
                      return (
                        <button
                          key={label}
                          className={cn(
                            "app-focus-ring rounded-full border px-sm py-xxs text-caption font-medium transition-colors",
                            active
                              ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-200"
                              : "border-hairline bg-canvas text-muted hover:text-ink dark:border-surface-dark-elevated dark:bg-surface-dark-elevated dark:text-on-dark-soft",
                          )}
                          onClick={() => toggleLabel(label)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <input
                className="h-9 w-full rounded-lg border border-hairline bg-canvas px-sm text-body-md outline-none transition-colors focus:border-primary dark:border-surface-dark-elevated dark:bg-surface-dark-elevated dark:text-on-dark"
                value={labelDraft}
                onChange={(event) => setLabelDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addLabels(labelDraft);
                  }
                }}
                onBlur={() => addLabels(labelDraft)}
                placeholder={uiText(language, "Add label", "添加标签")}
              />
            </div>

            <Bell size={20} className="text-muted" />
            <input
              type="date"
              className="h-10 rounded-lg border border-hairline bg-surface-card px-sm text-body-md outline-none transition-colors focus:border-primary dark:border-surface-dark dark:bg-surface-dark dark:text-on-dark"
              value={note.reminderDate ?? ""}
              onChange={(event) => onUpdateNote(note.id, { reminderDate: event.target.value || undefined })}
              onBlur={onPersistNote}
            />

            <Palette size={20} className="text-muted" />
            <div className="flex flex-wrap gap-sm">
              {noteColorOptions.map((option) => (
                <button
                  key={option.id}
                  className={cn(
                    "app-focus-ring grid h-9 w-9 place-items-center rounded-full border border-hairline transition-transform hover:scale-105",
                    option.dotClassName,
                    note.color === option.id && "ring-2 ring-primary ring-offset-2",
                  )}
                  onClick={() => {
                    onUpdateNote(note.id, { color: option.id });
                    onPersistNote();
                  }}
                  title={option.label}
                >
                  {note.color === option.id ? <Check size={16} className="text-ink" /> : null}
                </button>
              ))}
            </div>
          </div>

          <button
            className="app-focus-ring flex w-full items-center gap-sm rounded-xl border border-hairline bg-surface-card px-md py-sm text-left text-body-md text-ink shadow-subtle transition-colors hover:border-primary dark:border-surface-dark dark:bg-surface-dark dark:text-on-dark"
            onClick={onCreateTask}
          >
            <ListChecks size={18} className="text-primary" />
            <span className="min-w-0 flex-1">{uiText(language, "Create task from note", "从笔记创建任务")}</span>
            <MoreHorizontal size={18} className="text-muted" />
          </button>
        </div>
      </div>

      <div className="mt-md shrink-0 border-t border-hairline pt-md dark:border-surface-dark">
        <div className="flex items-center gap-sm rounded-xl border border-hairline bg-surface-card px-sm py-sm text-body-sm shadow-subtle dark:border-surface-dark dark:bg-surface-dark">
          {saveState === "saving" ? <RefreshCw size={17} className="animate-spin text-muted" /> : null}
          {saveState === "saved" ? <Check size={17} className="text-success" /> : null}
          {saveState === "error" ? <X size={17} className="text-error" /> : null}
          {saveState === "idle" ? <Cloud size={17} className="text-muted" /> : null}
          <div className={cn("min-h-5 text-caption", saveState === "error" ? "text-error" : saveState === "saved" ? "text-success" : "text-muted")}>
            {saveMessage || uiText(language, "Saved locally", "已保存到本地")}
          </div>
        </div>
      </div>
    </aside>
  );
}

type TaskDetailsPanelProps = {
  task: Task | null;
  lists: TaskListSummary[];
  language: LanguageMode;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => void;
  onPersistTask: (taskId: string, patch: Partial<Task>) => void;
  onChangeTaskList: (taskId: string, listId: string) => void;
  onDeleteTask: () => void;
  saveState: SaveState;
  saveMessage: string;
  onClose: () => void;
};

function TaskDetailsPanel({
  task,
  lists,
  language,
  onUpdateTask,
  onPersistTask,
  onChangeTaskList,
  onDeleteTask,
  saveState,
  saveMessage,
  onClose,
}: TaskDetailsPanelProps) {
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const autosize = (element: HTMLTextAreaElement | null) => {
      if (!element) {
        return;
      }
      element.style.height = "0px";
      element.style.height = `${Math.min(element.scrollHeight, element === titleRef.current ? 160 : 420)}px`;
    };

    autosize(titleRef.current);
    autosize(notesRef.current);
  }, [task?.id, task?.title, task?.notes]);

  if (!task) {
    return (
      <aside data-detail-interactive="true" className="hidden w-[360px] shrink-0 border-l border-hairline bg-surface px-lg py-lg xl:flex xl:flex-col dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
        <EmptyState
          title={uiText(language, "No task selected", "未选择任务")}
          description={uiText(language, "Pick a task from the list to edit details.", "从列表中选择一个任务以编辑详情。")}
        />
      </aside>
    );
  }

  return (
    <aside data-detail-interactive="true" className="hidden w-[400px] shrink-0 flex-col border-l border-hairline bg-surface-soft px-lg py-lg xl:flex dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
      <div className="flex shrink-0 items-center justify-between">
        <button className="app-focus-ring grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-card" onClick={onClose} title={uiText(language, "Close details", "关闭详情")}>
          <X size={18} />
        </button>
        <span className="rounded-lg border border-hairline bg-surface-card px-sm py-xs text-caption text-muted shadow-subtle dark:border-surface-dark dark:bg-surface-dark">
          {uiText(language, "Editing", "编辑中")}
        </span>
        <div className="flex items-center gap-xs">
          <button className="app-focus-ring grid h-9 w-9 place-items-center rounded-lg text-error transition-colors hover:bg-error-container/30" onClick={onDeleteTask} title={uiText(language, "Delete task", "删除任务")}>
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      <div className="app-scrollbar mt-lg min-h-0 flex-1 overflow-y-auto pr-xs">
      <div className="space-y-md">
        <textarea
          ref={titleRef}
          rows={1}
          className="min-h-[56px] max-h-40 w-full resize-none overflow-y-auto rounded-xl border border-hairline bg-surface-card px-md py-sm text-title-lg text-ink outline-none transition-colors focus:border-primary dark:border-surface-dark dark:bg-surface-dark dark:text-on-dark"
          value={task.title}
          onChange={(event) => {
            const title = event.target.value;
            onUpdateTask(task.id, { title, lastEdited: "just now" });
          }}
          onBlur={(event) => onPersistTask(task.id, { title: event.currentTarget.value })}
          placeholder={uiText(language, "Task title", "任务标题")}
        />
        <textarea
          ref={notesRef}
          rows={6}
          className="min-h-[220px] max-h-[420px] w-full resize-none overflow-y-auto rounded-xl border border-hairline bg-surface-card px-md py-sm text-body-md text-ink outline-none transition-colors focus:border-primary dark:border-surface-dark dark:bg-surface-dark dark:text-on-dark"
          value={task.notes}
          onChange={(event) => {
            const notes = event.target.value;
            onUpdateTask(task.id, { notes, lastEdited: "just now" });
          }}
          onBlur={(event) => onPersistTask(task.id, { notes: event.currentTarget.value })}
          placeholder={uiText(language, "Notes", "备注")}
        />

        <div className="grid grid-cols-[36px_1fr] items-center gap-md">
          <ListChecks size={20} className="text-muted" />
          <select
            className="h-10 rounded-lg border border-hairline bg-surface-card px-sm text-body-md outline-none transition-colors focus:border-primary dark:border-surface-dark dark:bg-surface-dark dark:text-on-dark"
            value={task.listId}
            onChange={(event) => onChangeTaskList(task.id, event.target.value)}
          >
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>

          <CalendarDays size={20} className="text-muted" />
          <div className="grid gap-sm">
            <div className="flex gap-sm">
            <input
              type="date"
              className="h-10 min-w-0 flex-1 rounded-lg border border-hairline bg-surface-card px-sm text-body-md outline-none transition-colors focus:border-primary dark:border-surface-dark dark:bg-surface-dark dark:text-on-dark"
              value={inputDateValue(task)}
              onChange={(event) => {
                const value = event.target.value;
                const patch = { dueText: value || undefined, dueLabel: dueLabelFromDate(value), lastEdited: "just now" };
                onUpdateTask(task.id, patch);
                onPersistTask(task.id, patch);
              }}
            />
            </div>
            <div className="flex flex-wrap items-center gap-sm">
              {task.reminderTime ? (
                <div className="flex items-center gap-xs rounded-lg border border-primary bg-primary px-sm py-xs text-caption text-on-dark">
                  <Clock3 size={16} />
                  <input
                    type="time"
                    className="w-[88px] border-none bg-transparent p-0 text-caption text-on-dark outline-none [color-scheme:dark] focus:ring-0"
                    value={task.reminderTime}
                    onChange={(event) => {
                      const patch = {
                        reminderTime: event.target.value || undefined,
                        lastEdited: "just now",
                      };
                      onUpdateTask(task.id, patch);
                      onPersistTask(task.id, patch);
                    }}
                    title={uiText(language, "Reminder time", "提醒时间")}
                  />
                  <button
                    className="grid h-5 w-5 place-items-center rounded transition-colors hover:bg-white/10"
                    onClick={() => {
                      const patch = { reminderTime: undefined, lastEdited: "just now" };
                      onUpdateTask(task.id, patch);
                      onPersistTask(task.id, patch);
                    }}
                    title={uiText(language, "Disable reminder time", "关闭提醒时间")}
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    const patch = { reminderTime: "09:00", lastEdited: "just now" };
                    onUpdateTask(task.id, patch);
                    onPersistTask(task.id, patch);
                  }}
                >
                  <Clock3 size={16} />
                  {uiText(language, "Add time", "添加时间")}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-sm">
              <Button
                variant="secondary"
                onClick={() => {
                  const patch = { dueText: "Today", dueLabel: "today" as SmartView, lastEdited: "just now" };
                  onUpdateTask(task.id, patch);
                  onPersistTask(task.id, patch);
                }}
              >
                {uiText(language, "Today", "今日")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const patch = { dueText: "Tomorrow", dueLabel: "tomorrow" as SmartView, lastEdited: "just now" };
                  onUpdateTask(task.id, patch);
                  onPersistTask(task.id, patch);
                }}
              >
                {uiText(language, "Tomorrow", "明日")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const nextMonday = nextMondayDate();
                  const patch = { dueText: nextMonday, dueLabel: dueLabelFromDate(nextMonday), lastEdited: "just now" };
                  onUpdateTask(task.id, patch);
                  onPersistTask(task.id, patch);
                }}
              >
                {uiText(language, "Next Monday", "下周一")}
              </Button>
            </div>
          </div>
        </div>
      </div>
      </div>

      <div className="mt-md shrink-0 border-t border-hairline pt-md dark:border-surface-dark">
        <div className="flex items-center gap-sm rounded-xl border border-hairline bg-surface-card px-sm py-sm text-body-sm shadow-subtle dark:border-surface-dark dark:bg-surface-dark">
          {saveState === "saving" ? <RefreshCw size={17} className="animate-spin text-muted" /> : null}
          {saveState === "saved" ? <Check size={17} className="text-success" /> : null}
          {saveState === "error" ? <X size={17} className="text-error" /> : null}
          {saveState === "idle" ? <Cloud size={17} className="text-muted" /> : null}
          <div
            className={cn(
              "min-h-5 text-caption",
              saveState === "error" ? "text-error" : saveState === "saved" ? "text-success" : "text-muted",
            )}
          >
            {saveMessage}
          </div>
        </div>
      </div>
    </aside>
  );
}

type CalendarEventDetailsPanelProps = {
  event: CalendarEvent;
  language: LanguageMode;
  onUpdateEvent: (eventId: string, patch: Partial<CalendarEvent>) => void;
  onPersistEvent: (eventId: string, patch: Partial<CalendarEvent>) => void;
  onDeleteEvent: () => void;
  saveState: SaveState;
  saveMessage: string;
  onClose: () => void;
};

function CalendarEventDetailsPanel({
  event,
  language,
  onUpdateEvent,
  onPersistEvent,
  onDeleteEvent,
  saveState,
  saveMessage,
  onClose,
}: CalendarEventDetailsPanelProps) {
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const eventId = calendarEventKey(event);
  const dateValue = calendarDateForEvent(event);
  const timeValue = calendarEventTimeValue(event);
  const lastPersistedSignatureRef = useRef("");
  const lastEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    const autosize = (element: HTMLTextAreaElement | null) => {
      if (!element) {
        return;
      }
      element.style.height = "0px";
      element.style.height = `${Math.min(element.scrollHeight, element === titleRef.current ? 160 : 420)}px`;
    };
    autosize(titleRef.current);
    autosize(notesRef.current);
  }, [event.id, event.title, event.description]);

  useEffect(() => {
    const signature = JSON.stringify({
      id: eventId,
      title: event.title,
      description: event.description ?? "",
      date: dateValue,
      time: timeValue,
    });

    if (lastEventIdRef.current !== eventId) {
      lastEventIdRef.current = eventId;
      lastPersistedSignatureRef.current = signature;
      return;
    }

    if (lastPersistedSignatureRef.current === signature) {
      return;
    }

    const timer = window.setTimeout(() => {
      lastPersistedSignatureRef.current = signature;
      onPersistEvent(eventId, {
        title: event.title,
        description: event.description ?? "",
        start: event.start,
        all_day: event.all_day,
      });
    }, 550);

    return () => window.clearTimeout(timer);
  }, [dateValue, event.all_day, event.description, event.start, event.title, eventId, onPersistEvent, timeValue]);

  const updateEventDateTime = (date: string, time: string) => {
    if (time) {
      onUpdateEvent(eventId, {
        start: `${date}T${time}:00`,
        all_day: false,
      });
      return;
    }
    onUpdateEvent(eventId, {
      start: date,
      all_day: true,
    });
  };

  return (
    <aside data-detail-interactive="true" className="hidden w-[400px] shrink-0 flex-col border-l border-hairline bg-surface-soft px-lg py-lg xl:flex dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
      <div className="flex shrink-0 items-center justify-between">
        <button className="app-focus-ring grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-card" onClick={onClose} title={uiText(language, "Close details", "关闭详情")}>
          <X size={18} />
        </button>
        <span className="rounded-lg border border-hairline bg-surface-card px-sm py-xs text-caption text-muted shadow-subtle dark:border-surface-dark dark:bg-surface-dark">
          {uiText(language, "Calendar event", "日程")}
        </span>
        <button className="app-focus-ring grid h-9 w-9 place-items-center rounded-lg text-error transition-colors hover:bg-error-container/30" onClick={onDeleteEvent} title={uiText(language, "Delete calendar event", "删除日程")}>
          <Trash2 size={18} />
        </button>
      </div>

      <div className="app-scrollbar mt-lg min-h-0 flex-1 overflow-y-auto pr-xs">
        <div className="mb-md flex flex-wrap gap-xs">
          <Badge className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-200">
            Google Calendar
          </Badge>
          <Badge>{event.calendar_name}</Badge>
        </div>
        <div className="space-y-md">
          <textarea
            ref={titleRef}
            rows={1}
            className="min-h-[56px] max-h-40 w-full resize-none overflow-y-auto rounded-xl border border-hairline bg-surface-card px-md py-sm text-title-lg text-ink outline-none transition-colors focus:border-primary dark:border-surface-dark dark:bg-surface-dark dark:text-on-dark"
            value={event.title}
            onChange={(input) => onUpdateEvent(eventId, { title: input.target.value })}
            placeholder={uiText(language, "Event title", "日程标题")}
          />
          <textarea
            ref={notesRef}
            rows={8}
            className="min-h-[260px] max-h-[420px] w-full resize-none overflow-y-auto rounded-xl border border-hairline bg-surface-card px-md py-sm text-body-md text-ink outline-none transition-colors focus:border-primary dark:border-surface-dark dark:bg-surface-dark dark:text-on-dark"
            value={event.description ?? ""}
            onChange={(input) => onUpdateEvent(eventId, { description: input.target.value })}
            placeholder={uiText(language, "Description", "描述")}
          />

          <div className="grid grid-cols-[36px_1fr] items-center gap-md">
            <CalendarDays size={20} className="text-muted" />
            <input
              type="date"
              className="h-10 min-w-0 rounded-lg border border-hairline bg-surface-card px-sm text-body-md outline-none transition-colors focus:border-primary dark:border-surface-dark dark:bg-surface-dark dark:text-on-dark"
              value={dateValue}
              onChange={(input) => updateEventDateTime(input.target.value || localDate(0), timeValue)}
            />

            <Clock3 size={20} className="text-muted" />
            {timeValue ? (
              <div className="flex items-center gap-xs rounded-lg border border-primary bg-primary px-sm py-xs text-caption text-on-dark">
                <input
                  type="time"
                  className="w-[88px] border-none bg-transparent p-0 text-caption text-on-dark outline-none [color-scheme:dark] focus:ring-0"
                  value={timeValue}
                  onChange={(input) => updateEventDateTime(dateValue, input.target.value)}
                  title={uiText(language, "Reminder time", "提醒时间")}
                />
                <button
                  className="grid h-5 w-5 place-items-center rounded transition-colors hover:bg-white/10"
                  onClick={() => updateEventDateTime(dateValue, "")}
                  title={uiText(language, "Disable reminder time", "关闭提醒时间")}
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => updateEventDateTime(dateValue, "09:00")}>
                <Clock3 size={16} />
                {uiText(language, "Add time", "添加时间")}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-md shrink-0 border-t border-hairline pt-md dark:border-surface-dark">
        <div className="flex items-center gap-sm rounded-xl border border-hairline bg-surface-card px-sm py-sm text-body-sm shadow-subtle dark:border-surface-dark dark:bg-surface-dark">
          {saveState === "saving" ? <RefreshCw size={17} className="animate-spin text-muted" /> : null}
          {saveState === "saved" ? <Check size={17} className="text-success" /> : null}
          {saveState === "error" ? <X size={17} className="text-error" /> : null}
          {saveState === "idle" ? <Cloud size={17} className="text-muted" /> : null}
          <div
            className={cn(
              "min-h-5 text-caption",
              saveState === "error" ? "text-error" : saveState === "saved" ? "text-success" : "text-muted",
            )}
          >
            {saveMessage}
          </div>
        </div>
      </div>
    </aside>
  );
}

type BoardWorkspaceProps = {
  tasks: Task[];
  lists: TaskListSummary[];
  listColorMap: Record<string, number>;
  listCustomColorMap: ListCustomColorMap;
  language: LanguageMode;
  selectedTaskId: string;
  onSelectTask: (taskId: string) => void;
  onChangeTaskPriority: (taskId: string, priority: NonNullable<Task["priority"]>) => void;
};

type BoardPointerDrag = {
  taskId: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  active: boolean;
};

function BoardWorkspace({
  tasks,
  lists,
  listColorMap,
  listCustomColorMap,
  language,
  selectedTaskId,
  onSelectTask,
  onChangeTaskPriority,
}: BoardWorkspaceProps) {
  const pointerDragRef = useRef<BoardPointerDrag | null>(null);
  const [pointerDragPreview, setPointerDragPreview] = useState<BoardPointerDrag | null>(null);
  const [dragOverPriority, setDragOverPriority] = useState<NonNullable<Task["priority"]> | null>(null);
  const [hoveredBoardTaskId, setHoveredBoardTaskId] = useState("");
  const columns: Array<{ id: NonNullable<Task["priority"]>; title: string; tasks: Task[] }> = [
    {
      id: "high",
      title: uiText(language, "High Priority", "高优先级"),
      tasks: sortTasksByTime(tasks.filter((task) => !task.completed && taskPriority(task) === "high")),
    },
    {
      id: "medium",
      title: uiText(language, "Medium Priority", "中优先级"),
      tasks: sortTasksByTime(tasks.filter((task) => !task.completed && taskPriority(task) === "medium")),
    },
    {
      id: "low",
      title: uiText(language, "Low Priority", "低优先级"),
      tasks: sortTasksByTime(tasks.filter((task) => !task.completed && taskPriority(task) === "low")),
    },
  ];
  const openTasks = tasks.filter((task) => !task.completed);
  const pointerDraggedTask = pointerDragPreview ? tasks.find((task) => task.id === pointerDragPreview.taskId) : null;

  useEffect(() => {
    const priorityFromPoint = (x: number, y: number) => {
      const target = document.elementFromPoint(x, y) as HTMLElement | null;
      const column = target?.closest("[data-board-priority]") as HTMLElement | null;
      const priority = column?.dataset.boardPriority;
      return priority === "high" || priority === "medium" || priority === "low" ? priority : null;
    };

    const resetDocumentDragState = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const current = pointerDragRef.current;
      if (!current) {
        return;
      }
      event.preventDefault();
      const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
      const next = {
        ...current,
        x: event.clientX,
        y: event.clientY,
        active: current.active || distance > 6,
      };
      pointerDragRef.current = next;
      setPointerDragPreview(next);
      if (next.active) {
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        setDragOverPriority(priorityFromPoint(event.clientX, event.clientY));
      }
    };

    const handlePointerUp = (event: globalThis.PointerEvent) => {
      const current = pointerDragRef.current;
      if (!current) {
        return;
      }
      event.preventDefault();
      pointerDragRef.current = null;
      setPointerDragPreview(null);
      setDragOverPriority(null);
      resetDocumentDragState();
      if (current.active) {
        const priority = priorityFromPoint(event.clientX, event.clientY);
        const draggedTask = tasks.find((task) => task.id === current.taskId);
        if (priority && (!draggedTask || priority !== taskPriority(draggedTask))) {
          onChangeTaskPriority(current.taskId, priority);
        }
      }
    };

    const handlePointerCancel = () => {
      pointerDragRef.current = null;
      setPointerDragPreview(null);
      setDragOverPriority(null);
      resetDocumentDragState();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      resetDocumentDragState();
    };
  }, [onChangeTaskPriority, tasks]);

  return (
    <section className="min-h-0 flex-1 overflow-auto bg-canvas p-lg dark:bg-surface-dark">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-display-md text-ink dark:text-on-dark">{uiText(language, "Board", "看板")}</h1>
          <p className="mt-xs text-body-md text-muted">{uiText(language, "Prioritize current open tasks by dragging them between columns.", "拖动当前未完成任务，在看板中调整优先级。")}</p>
        </div>
        <Badge>{uiText(language, `${openTasks.length} open`, `${openTasks.length} 个未完成`)}</Badge>
      </div>
      <div className="mt-lg grid min-w-[760px] grid-cols-3 gap-lg">
        {columns.map((column) => (
          <div
            key={column.id}
            data-board-priority={column.id}
            className={cn(
              "min-h-[360px] rounded-xl border border-hairline bg-surface-soft p-md shadow-subtle transition-shadow dark:border-surface-dark-elevated dark:bg-surface-dark-elevated",
              dragOverPriority === column.id && "ring-2 ring-primary",
            )}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-title-lg text-ink dark:text-on-dark">{column.title}</h2>
              <Badge>{column.tasks.length}</Badge>
            </div>
            <div className="mt-md space-y-sm">
              {column.tasks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-hairline bg-surface-card p-md text-body-sm text-muted dark:border-surface-dark dark:bg-surface-dark">{uiText(language, "Drop tasks here", "拖动任务到这里")}</div>
              ) : (
                column.tasks.map((task) => (
                  <article
                    key={task.id}
                    data-board-card="true"
                    data-detail-interactive="true"
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "app-focus-ring w-full select-none rounded-xl border p-md text-left shadow-subtle transition-all hover:-translate-y-px hover:ring-1 hover:ring-primary",
                      selectedTaskId === task.id && "ring-2 ring-primary",
                      pointerDragPreview?.active && pointerDragPreview.taskId === task.id && "scale-[0.98] opacity-35",
                      hoveredBoardTaskId === task.id
                        ? listToneClass(task.listId, lists, listColorMap, listCustomColorMap)
                        : "border-hairline bg-surface-card text-ink dark:border-surface-dark-elevated dark:bg-surface-dark dark:text-on-dark",
                    )}
                    style={hoveredBoardTaskId === task.id ? customColorStyle(listCustomColorMap[task.listId]) : undefined}
                    onMouseEnter={() => setHoveredBoardTaskId(task.id)}
                    onMouseLeave={() => setHoveredBoardTaskId((current) => (current === task.id ? "" : current))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectTask(task.id);
                      }
                    }}
                    onClick={() => onSelectTask(task.id)}
                  >
                    <div className="flex items-start gap-sm">
                      <button
                        type="button"
                        className="app-focus-ring -ml-xs mt-0.5 grid h-8 w-8 shrink-0 cursor-grab place-items-center rounded-md text-muted transition-colors hover:bg-surface-card hover:text-primary active:cursor-grabbing dark:hover:bg-surface-dark"
                        style={{ touchAction: "none" }}
                        title={uiText(language, "Drag to change priority", "拖动调整优先级")}
                        aria-label={uiText(language, "Drag to change priority", "拖动调整优先级")}
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => {
                          if (event.button !== 0) {
                            return;
                          }
                          const card = event.currentTarget.closest("[data-board-card]") as HTMLElement | null;
                          const rect = card?.getBoundingClientRect();
                          if (!rect) {
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          const nextDrag = {
                            taskId: task.id,
                            startX: event.clientX,
                            startY: event.clientY,
                            x: event.clientX,
                            y: event.clientY,
                            width: rect.width,
                            height: rect.height,
                            offsetX: event.clientX - rect.left,
                            offsetY: event.clientY - rect.top,
                            active: false,
                          };
                          pointerDragRef.current = nextDrag;
                          setPointerDragPreview(nextDrag);
                        }}
                      >
                        <GripVertical size={16} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="text-title-md text-ink dark:text-on-dark">{task.title}</div>
                        <div className="mt-sm flex flex-wrap gap-xs text-caption text-muted">
                          <Badge
                            className={listLabelToneClass(task.listId, lists, listColorMap, listCustomColorMap)}
                            style={customColorStyle(listCustomColorMap[task.listId], "label")}
                          >
                            {lists.find((list) => list.id === task.listId)?.name ?? uiText(language, "Tasks", "任务")}
                          </Badge>
                          <Badge>{priorityLabel(taskPriority(task), language)}</Badge>
                          {task.dueText ? <Badge className={dueLabelToneClass(task)}>{displayDueText(task.dueText, language)}</Badge> : null}
                        </div>
                      </div>
                    </div>
                  </article>
                ))
              )}
              {pointerDragPreview?.active && dragOverPriority === column.id ? (
                <div className="h-16 rounded-xl border-2 border-dashed border-primary/60 bg-primary/5 dark:bg-primary/10" />
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {pointerDragPreview?.active && pointerDraggedTask ? (
        <div
          className={cn(
            "pointer-events-none fixed z-50 rounded-xl border border-primary/40 p-md text-left opacity-95 shadow-panel",
            listToneClass(pointerDraggedTask.listId, lists, listColorMap, listCustomColorMap),
          )}
          style={{
            ...customColorStyle(listCustomColorMap[pointerDraggedTask.listId]),
            left: pointerDragPreview.x - pointerDragPreview.offsetX,
            top: pointerDragPreview.y - pointerDragPreview.offsetY,
            width: pointerDragPreview.width,
            maxWidth: 320,
          }}
        >
          <div className="flex items-start gap-sm">
            <span className="-ml-xs mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-primary">
              <GripVertical size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-title-md text-ink dark:text-on-dark">{pointerDraggedTask.title}</div>
              <div className="mt-sm flex flex-wrap gap-xs text-caption text-muted">
                <Badge>{priorityLabel(taskPriority(pointerDraggedTask), language)}</Badge>
                {pointerDraggedTask.dueText ? <Badge className={dueLabelToneClass(pointerDraggedTask)}>{displayDueText(pointerDraggedTask.dueText, language)}</Badge> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

type CalendarWorkspaceProps = {
  tasks: Task[];
  events: CalendarEvent[];
  lists: TaskListSummary[];
  listColorMap: Record<string, number>;
  listCustomColorMap: ListCustomColorMap;
  language: LanguageMode;
  monthValue: string;
  onMonthChange: (value: string) => void;
  onSelectTask: (taskId: string) => void;
  onSelectCalendarEvent: (eventId: string) => void;
};

function CalendarWorkspace({
  tasks,
  events,
  lists,
  listColorMap,
  listCustomColorMap,
  language,
  monthValue,
  onMonthChange,
  onSelectTask,
  onSelectCalendarEvent,
}: CalendarWorkspaceProps) {
  const [hoveredTaskState, setHoveredTaskState] = useState<{ taskId: string; x: number; y: number } | null>(null);
  const [year, month] = monthValue.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  const unscheduled = sortTasksByTime(tasks.filter((task) => !task.dueText && !task.completed));
  const monthStart = `${monthValue}-01`;
  const monthEnd = `${monthValue}-${String(daysInMonth).padStart(2, "0")}`;
  const monthlyEvents = events.filter((event) => {
    const startDate = event.start.slice(0, 10);
    const endDate = event.end?.slice(0, 10) ?? startDate;
    return startDate <= monthEnd && endDate >= monthStart;
  });
  const hoveredTask = hoveredTaskState ? tasks.find((task) => task.id === hoveredTaskState.taskId) ?? null : null;
  const hoveredTaskListName = hoveredTask
    ? lists.find((list) => list.id === hoveredTask.listId)?.name ?? uiText(language, "Tasks", "任务")
    : "";
  const updateTaskHover = (taskId: string, event: { clientX: number; clientY: number }) => {
    setHoveredTaskState({ taskId, x: event.clientX, y: event.clientY });
  };
  const clearTaskHover = (taskId: string) => {
    setHoveredTaskState((current) => (current?.taskId === taskId ? null : current));
  };
  const hoverCardLeft =
    hoveredTaskState && typeof window !== "undefined"
      ? Math.min(hoveredTaskState.x + 14, Math.max(16, window.innerWidth - 356))
      : 0;
  const hoverCardTop =
    hoveredTaskState && typeof window !== "undefined"
      ? Math.min(hoveredTaskState.y + 8, Math.max(16, window.innerHeight - 520))
      : 0;

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-canvas p-lg dark:bg-surface-dark">
      <div className="flex items-start justify-between">
        <div>
          <label className="inline-flex cursor-pointer items-center gap-sm">
            <span className="font-display text-display-md text-ink dark:text-on-dark">{formatMonthTitle(monthValue, language)}</span>
            <input
              type="month"
              className="h-9 rounded-lg border border-hairline bg-canvas px-sm text-body-sm text-ink outline-none focus:border-primary dark:border-surface-dark-elevated dark:bg-surface-dark dark:text-on-dark"
              value={monthValue}
              onChange={(event) => onMonthChange(event.target.value)}
            />
          </label>
          <p className="mt-xs text-body-md text-muted">
            {uiText(language, "A calm monthly view for dates. Google Tasks due dates are date-only.", "按月查看任务日期。Google Tasks 的到期日仅支持日期，不支持具体时间。")}
          </p>
          <p className="mt-xxs text-body-sm text-muted">
            {uiText(language, "Google Calendar schedules also appear here.", "这里也会显示 Google Calendar 日程。")}
          </p>
        </div>
      </div>

      <div className="mt-lg grid grid-cols-[1fr_300px] gap-lg">
        <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-hairline bg-surface-card shadow-subtle dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="border-b border-hairline px-sm py-sm text-caption font-semibold uppercase text-muted dark:border-surface-dark">{day}</div>
          ))}
          {cells.map((day, index) => {
            const cellDate = day ? `${monthValue}-${String(day).padStart(2, "0")}` : "";
            const dayTasks = day
              ? sortTasksByTime(tasks.filter((task) => !task.completed && calendarDateForTask(task) === cellDate))
              : [];
            const dayEvents = day
              ? events.filter((event) => calendarEventOccursOnDate(event, cellDate))
              : [];
            return (
              <div key={`${day ?? "blank"}-${index}`} className="min-h-24 border-b border-r border-hairline bg-canvas/60 p-sm dark:border-surface-dark">
                <div className="text-caption text-muted">{day ?? ""}</div>
                <div className="mt-xs space-y-xs">
                  {dayEvents.slice(0, 2).map((event) => (
                    <button
                      key={event.id}
                      data-detail-interactive="true"
                      className="block w-full truncate rounded-md px-xs py-xxs text-left text-caption text-ink transition-colors hover:ring-1 hover:ring-primary dark:text-on-dark"
                      style={{
                        backgroundColor: event.color ? `${event.color}26` : undefined,
                        borderLeft: `3px solid ${event.color ?? "#8B5CF6"}`,
                      }}
                      title={`${formatCalendarEventTime(event, language)} ${event.title}`}
                      onClick={() => onSelectCalendarEvent(calendarEventKey(event))}
                    >
                      <span className="mr-xxs text-muted">
                        {formatCalendarEventTime(event, language)}
                      </span>
                      {event.title}
                    </button>
                  ))}
                  {dayTasks.slice(0, 3).map((task) => (
                    <div key={task.id} className="relative">
                      <button
                        data-detail-interactive="true"
                        className={cn("block w-full truncate rounded-md px-xs py-xxs text-left text-caption transition-colors hover:ring-1 hover:ring-primary", listToneClass(task.listId, lists, listColorMap, listCustomColorMap, true))}
                        style={customColorStyle(listCustomColorMap[task.listId], "pill")}
                        onMouseEnter={(event) => updateTaskHover(task.id, event)}
                        onMouseMove={(event) => updateTaskHover(task.id, event)}
                        onMouseLeave={() => clearTaskHover(task.id)}
                        onFocus={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          setHoveredTaskState({ taskId: task.id, x: rect.right, y: rect.top });
                        }}
                        onBlur={() => clearTaskHover(task.id)}
                        onClick={() => onSelectTask(task.id)}
                      >
                        {task.title}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <aside>
          <h2 className="text-title-lg text-ink dark:text-on-dark">
            {uiText(language, "Schedules this month", "本月日程")}
          </h2>
          <div className="mt-md space-y-sm">
            {monthlyEvents.length === 0 ? (
                <div className="rounded-xl border border-dashed border-hairline bg-surface-card p-md text-body-sm text-muted">
                {uiText(language, "No Google Calendar schedules in this month.", "这个月没有 Google Calendar 日程。")}
              </div>
            ) : (
              monthlyEvents.slice(0, 10).map((event) => (
                <div
                  key={event.id}
                  className="rounded-xl border border-hairline bg-surface-card p-md shadow-subtle dark:border-surface-dark dark:bg-surface-dark"
                  style={{
                    borderLeftColor: event.color ?? "#8B5CF6",
                    borderLeftWidth: 4,
                  }}
                >
                  <div className="text-title-md text-ink dark:text-on-dark">{event.title}</div>
                  <div className="mt-xxs text-caption text-muted">
                    {event.calendar_name}
                    {" · "}
                    {calendarDateForEvent(event)}
                    {" · "}
                    {formatCalendarEventTime(event, language)}
                  </div>
                  {event.location ? (
                    <div className="mt-xxs text-caption text-muted">{event.location}</div>
                  ) : null}
                </div>
              ))
            )}
          </div>
          <h2 className="mt-lg text-title-lg text-ink dark:text-on-dark">
            {uiText(language, "Unscheduled", "未安排")}
          </h2>
          <div className="mt-md space-y-sm">
            {unscheduled.length === 0 ? (
              <div className="rounded-lg border border-dashed border-hairline p-md text-body-sm text-muted">
                {uiText(language, "All open tasks have dates.", "所有未完成任务都已有日期。")}
              </div>
            ) : (
              unscheduled.map((task) => (
                <button
                  key={task.id}
                  data-detail-interactive="true"
                  className={cn("app-focus-ring w-full rounded-xl p-md text-left shadow-subtle transition-all hover:-translate-y-px hover:ring-1 hover:ring-primary", listToneClass(task.listId, lists, listColorMap, listCustomColorMap))}
                  style={customColorStyle(listCustomColorMap[task.listId])}
                  onMouseEnter={(event) => updateTaskHover(task.id, event)}
                  onMouseMove={(event) => updateTaskHover(task.id, event)}
                  onMouseLeave={() => clearTaskHover(task.id)}
                  onClick={() => onSelectTask(task.id)}
                >
                  {task.title}
                </button>
              ))
            )}
          </div>
        </aside>
      </div>
      {hoveredTask && hoveredTaskState ? (
        <div
          className="pointer-events-none fixed z-50"
          style={{ left: hoverCardLeft, top: hoverCardTop }}
        >
          <CalendarTaskHoverCard task={hoveredTask} listName={hoveredTaskListName} language={language} />
        </div>
      ) : null}
    </section>
  );
}

function CalendarTaskHoverCard({ task, listName, language }: { task: Task; listName: string; language: LanguageMode }) {
  const completedSubtasks = task.subtasks.filter((subtask) => subtask.completed).length;
  const notes = task.notes.trim();
  return (
    <div className="z-40 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-hairline bg-canvas p-md text-left shadow-panel dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
      <div className="text-title-md text-ink dark:text-on-dark">{task.title}</div>
      <div className="mt-sm flex flex-wrap gap-xs">
        <Badge>{listName}</Badge>
        <Badge>{priorityLabel(taskPriority(task), language)}</Badge>
        {task.dueText ? <Badge>{displayDueText(task.dueText, language)}</Badge> : null}
        {task.estimate ? <Badge>{task.estimate}</Badge> : null}
        {task.reminderTime ? <Badge>{uiText(language, `Reminder ${task.reminderTime}`, `提醒 ${task.reminderTime}`)}</Badge> : null}
      </div>
      {notes ? <p className="mt-sm whitespace-pre-wrap text-body-sm text-muted dark:text-on-dark-soft">{notes}</p> : null}
      {task.subtasks.length > 0 ? (
        <div className="mt-sm space-y-xs">
          <div className="text-caption text-muted dark:text-on-dark-soft">
            {uiText(language, `${completedSubtasks}/${task.subtasks.length} subtasks`, `${completedSubtasks}/${task.subtasks.length} 个子任务`)}
          </div>
          {task.subtasks.map((subtask) => (
            <div key={subtask.id} className="flex items-start gap-xs text-caption text-muted dark:text-on-dark-soft">
              <CompletionGlyph completed={subtask.completed} />
              <span className={cn("min-w-0 flex-1", subtask.completed && "line-through")}>{subtask.title}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type ManageListsWorkspaceProps = {
  lists: TaskListSummary[];
  tasks: Task[];
  language: LanguageMode;
  onCreateList: () => void;
  onRenameList: (listId: string) => void;
  onSelectList: (listId: string) => void;
};

function ManageListsWorkspace({ lists, tasks, language, onCreateList, onRenameList, onSelectList }: ManageListsWorkspaceProps) {
  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-canvas p-lg dark:bg-surface-dark">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-display-md text-ink dark:text-on-dark">{uiText(language, "Manage Lists", "管理清单")}</h1>
          <p className="mt-xs text-body-md text-muted">{uiText(language, "Review local lists and open a focused task list.", "查看本地清单并打开对应任务列表。")}</p>
        </div>
        <Button onClick={onCreateList}>
          <Plus size={18} />
          {uiText(language, "New List", "新建清单")}
        </Button>
      </div>

      <div className="mt-lg overflow-hidden rounded-lg border border-hairline bg-surface dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
        <div className="grid grid-cols-[1fr_120px_220px] border-b border-hairline px-md py-sm text-caption font-semibold uppercase text-muted dark:border-surface-dark">
          <span>{uiText(language, "Name", "名称")}</span>
          <span>{uiText(language, "Tasks", "任务")}</span>
          <span>{uiText(language, "Actions", "操作")}</span>
        </div>
        {lists.map((list) => {
          const Icon = list.icon;
          return (
            <div key={list.id} className="grid grid-cols-[1fr_120px_220px] items-center border-b border-hairline px-md py-md last:border-b-0 dark:border-surface-dark">
              <div className="flex items-center gap-sm">
                <Icon size={20} className={list.iconClassName} />
                <span className="text-title-md text-ink dark:text-on-dark">{list.name}</span>
              </div>
              <span className="text-body-sm text-muted">{tasks.filter((task) => task.listId === list.id).length}</span>
              <div className="flex gap-sm">
                <Button className="h-8 px-sm" variant="secondary" onClick={() => onSelectList(list.id)}>{uiText(language, "Open", "打开")}</Button>
                <Button className="h-8 px-sm" variant="secondary" onClick={() => onRenameList(list.id)}>{uiText(language, "Rename", "重命名")}</Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type ManageListsModalProps = {
  open: boolean;
  lists: TaskListSummary[];
  tasks: Task[];
  listColorMap: Record<string, number>;
  listCustomColorMap: ListCustomColorMap;
  language: LanguageMode;
  onColorChange: (listId: string, colorIndex: number) => void;
  onCustomColorChange: (listId: string, color: string) => void;
  onCreateList: (name: string, colorIndex: number) => string | undefined;
  onRenameList: (listId: string, nextName?: string) => void;
  onDeleteList: (listId: string) => void;
  onSelectList: (listId: string) => void;
  onClose: () => void;
};

function ManageListsModal({
  open,
  lists,
  tasks,
  listColorMap,
  listCustomColorMap,
  language,
  onColorChange,
  onCustomColorChange,
  onCreateList,
  onRenameList,
  onDeleteList,
  onSelectList,
  onClose,
}: ManageListsModalProps) {
  const [selectedListId, setSelectedListId] = useState(lists[0]?.id ?? "");
  const [mode, setMode] = useState<"edit" | "create">("edit");
  const [nameDraft, setNameDraft] = useState("");
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState(0);
  const [customHex, setCustomHex] = useState(listColorSwatches[0].hex.replace("#", ""));

  const selectedList = lists.find((list) => list.id === selectedListId) ?? lists[0] ?? null;
  const selectedIndex = selectedList
    ? Math.max(0, lists.findIndex((list) => list.id === selectedList.id))
    : 0;
  const selectedColor = selectedList
    ? listColorMap[selectedList.id] ?? selectedIndex
    : createColor;
  const selectedCustomColor = selectedList ? listCustomColorMap[selectedList.id] : undefined;
  const activeColor = mode === "create" ? createColor : selectedColor;
  const activeCustomColor = mode === "create" ? normalizeHexColor(customHex) ?? undefined : selectedCustomColor;
  const activeSwatch = listColorSwatches[activeColor % listColorSwatches.length];
  const activeHex = activeCustomColor ?? activeSwatch.hex;

  useEffect(() => {
    if (!open) {
      return;
    }
    if (!selectedList && lists[0]) {
      setSelectedListId(lists[0].id);
      return;
    }
    setNameDraft(selectedList?.name ?? "");
  }, [lists, open, selectedList]);

  useEffect(() => {
    setCustomHex(activeHex.replace("#", ""));
  }, [activeHex]);

  if (!open) {
    return null;
  }

  const setActiveColor = (colorIndex: number) => {
    if (mode === "create") {
      setCreateColor(colorIndex);
      return;
    }
    if (selectedList) {
      onColorChange(selectedList.id, colorIndex);
    }
  };

  const applyCustomColor = () => {
    const normalized = normalizeHexColor(customHex);
    if (normalized) {
      const matchIndex = listColorSwatches.findIndex((swatch) => swatch.hex.toUpperCase() === normalized);
      if (matchIndex >= 0) {
        setActiveColor(matchIndex);
      } else if (mode === "create") {
        setCustomHex(normalized.replace("#", ""));
      } else if (selectedList) {
        onCustomColorChange(selectedList.id, normalized);
      }
      setCustomHex(normalized.replace("#", ""));
      return;
    }
    window.alert(uiText(language, "Please enter a 6-digit HEX color, for example 3B82F6.", "请输入 6 位 HEX 色值，例如 3B82F6。"));
  };

  const saveChanges = () => {
    if (mode === "create") {
      const newListId = onCreateList(createName, createColor);
      if (newListId) {
        const normalized = normalizeHexColor(customHex);
        if (normalized && !listColorSwatches.some((swatch) => swatch.hex.toUpperCase() === normalized)) {
          onCustomColorChange(newListId, normalized);
        }
        setSelectedListId(newListId);
        setCreateName("");
        setMode("edit");
      }
      return;
    }

    if (selectedList) {
      onRenameList(selectedList.id, nameDraft);
      onSelectList(selectedList.id);
    }
  };

  const deleteSelectedList = () => {
    if (!selectedList) {
      return;
    }
    const currentIndex = lists.findIndex((list) => list.id === selectedList.id);
    const nextSelection = lists[currentIndex + 1] ?? lists[currentIndex - 1] ?? null;
    onDeleteList(selectedList.id);
    if (nextSelection) {
      setSelectedListId(nextSelection.id);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/20 p-md backdrop-blur-sm">
      <section className="flex h-[80vh] max-h-[800px] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-hairline bg-canvas shadow-panel dark:border-surface-dark-elevated dark:bg-surface-dark">
        <header className="flex shrink-0 items-center justify-between border-b border-hairline bg-canvas px-lg py-md dark:border-surface-dark-elevated dark:bg-surface-dark">
          <h2 className="text-title-lg text-ink dark:text-on-dark">{uiText(language, "Manage Lists", "管理清单")}</h2>
          <button className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-soft hover:text-ink dark:hover:bg-surface-dark-elevated dark:hover:text-on-dark" onClick={onClose} title={uiText(language, "Close", "关闭")}>
            <X size={18} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="flex h-full w-1/3 min-w-[240px] flex-col border-r border-hairline bg-surface-soft dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
            <div className="p-md text-caption font-semibold uppercase tracking-wide text-muted-soft">{uiText(language, "Your Lists", "你的清单")}</div>
            <div className="app-scrollbar flex-1 space-y-xxs overflow-y-auto px-sm pb-md">
              {lists.map((list, index) => {
                const Icon = list.icon;
                const colorIndex = listColorMap[list.id] ?? index;
                const customColor = listCustomColorMap[list.id];
                const selected = mode === "edit" && selectedList?.id === list.id;
                return (
                  <button
                    key={list.id}
                    className={cn(
                      "group flex w-full items-center gap-sm rounded-lg border px-sm py-xs text-left transition-colors",
                      selected
                        ? "border-hairline bg-canvas shadow-subtle dark:border-surface-dark dark:bg-surface-dark"
                        : "border-transparent hover:bg-surface-strong dark:hover:bg-surface-dark",
                    )}
                    onClick={() => {
                      setSelectedListId(list.id);
                      setMode("edit");
                    }}
                  >
                    <span
                      className={cn("h-4 w-4 shrink-0 rounded-full border border-black/10", !customColor && listColorSwatches[colorIndex % listColorSwatches.length].className)}
                      style={customColor ? customColorStyle(customColor, "dot") : undefined}
                    />
                    <Icon size={17} className="shrink-0 text-muted" />
                    <span className={cn("min-w-0 flex-1 truncate text-body-md", selected ? "font-medium text-ink dark:text-on-dark" : "text-body dark:text-on-dark-soft")}>{list.name}</span>
                    <span className="rounded-full bg-surface-container-high px-xs text-caption text-muted dark:bg-surface-dark-elevated">
                      {tasks.filter((task) => task.listId === list.id).length}
                    </span>
                    {selected ? <ChevronRight size={18} className="text-muted" /> : null}
                  </button>
                );
              })}
            </div>

            <div className="border-t border-hairline bg-canvas p-md dark:border-surface-dark-elevated dark:bg-surface-dark">
              <button
                className="flex w-full items-center justify-center gap-xs rounded-lg border border-hairline bg-canvas px-md py-sm text-button text-ink shadow-subtle transition-colors hover:bg-surface-soft dark:border-surface-dark-elevated dark:bg-surface-dark dark:text-on-dark dark:hover:bg-surface-dark-elevated"
                onClick={() => {
                  setMode("create");
                  setCreateName("");
                  setCreateColor(0);
                }}
              >
                <Plus size={17} />
                {uiText(language, "Create New List", "创建新清单")}
              </button>
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col bg-canvas dark:bg-surface-dark">
            <div className="app-scrollbar flex-1 overflow-y-auto p-xl">
              <div className="mx-auto max-w-md space-y-lg">
                <div className="space-y-sm">
                  <label className="block text-caption font-medium text-muted dark:text-on-dark-soft">{uiText(language, "List Name", "清单名称")}</label>
                  <input
                    className="h-10 w-full rounded-lg border border-outline-variant bg-canvas px-md text-body-md text-ink outline-none transition-shadow focus:border-primary focus:ring-1 focus:ring-primary dark:border-surface-dark-elevated dark:bg-surface-dark-elevated dark:text-on-dark"
                    value={mode === "create" ? createName : nameDraft}
                    onChange={(event) => mode === "create" ? setCreateName(event.target.value) : setNameDraft(event.target.value)}
                    placeholder={mode === "create" ? uiText(language, "New list name", "新清单名称") : uiText(language, "List name", "清单名称")}
                  />
                </div>

                <div className="space-y-md">
                  <label className="block text-caption font-medium text-muted dark:text-on-dark-soft">{uiText(language, "List Color", "清单颜色")}</label>
                  <div className="grid grid-cols-6 gap-md">
                    {listColorSwatches.map((swatch, index) => {
                      const selected = activeColor % listColorSwatches.length === index;
                      return (
                        <button
                          key={swatch.name}
                          className="relative flex h-10 w-10 items-center justify-center rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                          onClick={() => setActiveColor(index)}
                          title={swatch.name}
                        >
                          <span className={cn("absolute inset-0 rounded-full border border-black/10", swatch.className)} />
                          {selected ? <span className="absolute inset-[-4px] rounded-full border-2 border-primary" /> : null}
                          {selected ? <Check size={18} className="relative z-10 text-white drop-shadow" /> : null}
                        </button>
                      );
                    })}
                    <button
                      className="relative h-10 w-10 overflow-hidden rounded-full border border-black/10 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                      onClick={() => setCustomHex(activeHex.replace("#", ""))}
                      title={uiText(language, "Custom color", "自定义颜色")}
                    >
                      <span className="absolute inset-0" style={{ background: "conic-gradient(from 0deg, #ff0000, #ff8000, #ffff00, #00ff00, #00ffff, #0000ff, #8000ff, #ff00ff, #ff0000)" }} />
                    </button>
                  </div>

                  <div className="space-y-md rounded-lg border border-hairline bg-surface-soft p-md dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
                    <div className="text-caption font-medium uppercase tracking-wide text-muted">{uiText(language, "Custom Picker", "自定义颜色")}</div>
                    <label className="grid h-32 cursor-pointer place-items-center overflow-hidden rounded-lg border border-hairline text-caption text-muted shadow-subtle dark:border-surface-dark" style={{ backgroundColor: activeHex }}>
                      <span className="rounded bg-black/35 px-sm py-xs text-white shadow-subtle">{uiText(language, "Pick any color", "选择任意颜色")}</span>
                      <input
                        className="sr-only"
                        type="color"
                        value={activeHex}
                        onChange={(event) => {
                          const nextColor = event.target.value.toUpperCase();
                          setCustomHex(nextColor.replace("#", ""));
                          if (mode === "edit" && selectedList) {
                            onCustomColorChange(selectedList.id, nextColor);
                          }
                        }}
                      />
                    </label>
                    <div className="flex items-center gap-sm">
                      <div className="flex h-10 flex-1 items-center rounded-lg border border-outline-variant bg-canvas px-sm dark:border-surface-dark dark:bg-surface-dark">
                        <span className="mr-xxs font-code text-muted-soft">#</span>
                        <input
                          className="w-full border-none bg-transparent p-0 font-code text-body-md uppercase outline-none focus:ring-0 dark:text-on-dark"
                          value={customHex}
                          maxLength={6}
                          onChange={(event) => setCustomHex(event.target.value)}
                        />
                      </div>
                      <Button className="h-10" onClick={applyCustomColor}>{uiText(language, "Apply", "应用")}</Button>
                    </div>
                  </div>
                </div>

                {mode === "edit" && selectedList ? (
                  <div className="border-t border-hairline pt-lg dark:border-surface-dark-elevated">
                    <h3 className="text-title-md text-error">{uiText(language, "Danger Zone", "危险操作")}</h3>
                    <p className="mt-xs text-body-sm text-muted dark:text-on-dark-soft">{uiText(language, "Deleting a list also removes local tasks in that list. Remote Google lists cannot be deleted in this phase.", "删除清单会同时移除该清单下的本地任务。已连接 Google 时暂不允许删除远端清单。")}</p>
                    <Button className="mt-md" variant="danger" onClick={deleteSelectedList}>
                      <Trash2 size={17} />
                      {uiText(language, "Delete List", "删除清单")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>

            <footer className="flex shrink-0 justify-end gap-md border-t border-hairline bg-surface-soft p-lg dark:border-surface-dark-elevated dark:bg-surface-dark-elevated">
              <Button variant="secondary" onClick={onClose}>{uiText(language, "Cancel", "取消")}</Button>
              <Button onClick={saveChanges}>{mode === "create" ? uiText(language, "Create List", "创建清单") : uiText(language, "Save Changes", "保存修改")}</Button>
            </footer>
          </section>
        </div>
      </section>
    </div>
  );
}

type UtilityWorkspaceProps = {
  title: string;
  description: string;
  items: UtilityActivityItem[];
  emptyText: string;
  language: LanguageMode;
  selectedTaskId: string;
  onSelectTask: (taskId: string) => void;
  onRestoreNote: (noteId: string) => void;
};

function parseActivityDate(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    const parsed = new Date(trimmed.length > 10 ? numeric : numeric * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  const lower = trimmed.toLowerCase();
  const now = new Date();
  const relative = lower.match(/^(\d+)\s*([mhd])\s*ago$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const offset = unit === "m" ? amount * 60_000 : unit === "h" ? amount * 3_600_000 : amount * 86_400_000;
    return new Date(now.getTime() - offset);
  }
  if (lower === "just now" || lower === "today") {
    return now;
  }
  if (lower === "yesterday") {
    return new Date(now.getTime() - 86_400_000);
  }
  if (lower === "last week") {
    return new Date(now.getTime() - 7 * 86_400_000);
  }

  return null;
}

function activityTimestampForCompletedTask(task: Task, fallbackIndex: number) {
  const parsed = parseActivityDate(task.completedAt) ?? parseActivityDate(task.lastEdited) ?? parseActivityDate(task.createdAt);
  if (parsed) {
    return parsed.toISOString();
  }
  return new Date(Date.now() - (fallbackIndex + 1) * 1000).toISOString();
}

function formatActivityTime(value: string, language: LanguageMode) {
  const parsed = parseActivityDate(value);
  if (!parsed) {
    return uiText(language, "Unknown time", "时间未知");
  }
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function UtilityWorkspace({ title, description, items, emptyText, language, selectedTaskId, onSelectTask, onRestoreNote }: UtilityWorkspaceProps) {
  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-canvas p-lg dark:bg-surface-dark">
      <h1 className="font-display text-display-md text-ink dark:text-on-dark">{uiDictionary[title] && language === "zh" ? uiDictionary[title] : title}</h1>
      <p className="mt-xs text-body-md text-muted">{uiDictionary[description] && language === "zh" ? uiDictionary[description] : description}</p>
      <div className="mt-lg max-w-3xl space-y-sm">
        {items.length === 0 ? (
          <EmptyState
            title={uiDictionary[emptyText] && language === "zh" ? uiDictionary[emptyText] : emptyText}
            description={uiText(language, "Nothing to review here right now.", "现在没有需要查看的内容。")}
          />
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              data-detail-interactive="true"
              className={cn(
                "flex w-full items-start gap-md rounded-lg border border-hairline bg-surface p-md text-left transition-colors dark:border-surface-dark-elevated dark:bg-surface-dark-elevated",
                item.kind === "task" && item.action === "completed" ? "hover:ring-1 hover:ring-primary" : "",
                item.kind === "task" && selectedTaskId === item.taskSnapshot.id && item.action === "completed" && "ring-2 ring-primary",
              )}
            >
              <button
                className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center text-muted", item.kind === "task" && item.action === "completed" && "cursor-pointer")}
                onClick={() => {
                  if (item.kind === "task" && item.action === "completed") {
                    onSelectTask(item.taskSnapshot.id);
                  }
                }}
                title={item.kind === "task" ? uiText(language, "Open task", "打开任务") : uiText(language, "Note", "笔记")}
              >
                {item.kind === "task" && item.action === "completed" ? (
                  <CompletionGlyph completed />
                ) : item.kind === "note" ? (
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-blue-50 text-primary dark:bg-blue-400/10 dark:text-blue-200">
                    <StickyNote size={13} />
                  </span>
                ) : (
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-error text-on-dark">
                    <X size={14} />
                  </span>
                )}
              </button>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-title-md text-ink dark:text-on-dark">
                  {item.kind === "task" ? item.taskSnapshot.title : item.noteSnapshot.title}
                </span>
                <span className="mt-xxs flex flex-wrap items-center gap-xs text-caption text-muted dark:text-on-dark-soft">
                  <Badge className={item.kind === "note" ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-200" : undefined}>
                    {item.kind === "note" ? uiText(language, "Note", "笔记") : uiText(language, "Task", "任务")}
                  </Badge>
                  <span>
                    {item.action === "completed"
                      ? uiText(language, "Completed", "已完成")
                      : item.action === "archived"
                        ? uiText(language, "Archived", "已归档")
                        : uiText(language, "Deleted", "已删除")}
                    {" · "}
                    {formatActivityTime(item.operatedAt, language)}
                  </span>
                </span>
              </span>
              {item.kind === "note" ? (
                <Button variant="secondary" onClick={() => onRestoreNote(item.noteSnapshot.id)}>
                  {uiText(language, "Restore note", "恢复笔记")}
                </Button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-hairline bg-surface-soft p-xl text-center dark:border-surface-dark dark:bg-surface-dark-elevated">
      <div className="font-display text-title-lg text-ink dark:text-on-dark">{title}</div>
      <p className="mt-xs text-body-sm text-muted">{description}</p>
    </div>
  );
}

function CompletionButton({ completed, onClick }: { completed: boolean; onClick: () => void }) {
  return (
    <button className="app-focus-ring mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted transition-colors hover:text-primary active:scale-95" onClick={onClick}>
      <CompletionGlyph completed={completed} />
    </button>
  );
}

function CompletionGlyph({ completed }: { completed: boolean }) {
  return completed ? (
    <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-on-dark">
      <Check size={14} />
    </span>
  ) : (
    <Circle size={21} />
  );
}

function Badge({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span
      className={cn("inline-flex max-w-full items-center rounded-full border px-xs py-xxs text-caption font-medium", className ?? "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-400/30 dark:bg-zinc-400/10 dark:text-zinc-200")}
      style={style}
    >
      {children}
    </span>
  );
}
