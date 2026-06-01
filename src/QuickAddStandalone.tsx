import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { CalendarDays, Check, ChevronDown, Clock3, Folder, Loader2, Plus, Search, X } from "lucide-react";
import { syncApi } from "./api/sync";
import { cn } from "./lib/classNames";

type QuickList = {
  id: string;
  title: string;
};

type SubmitState = "idle" | "saving" | "saved" | "error";
type QuickTheme = "light" | "dark";
type LanguageMode = "en" | "zh";

type QuickDirectiveParseResult = {
  title: string;
  dueDate?: string;
  reminderTime?: string;
};

type ListMentionMatch = {
  keyword: string;
  start: number;
  end: number;
};

const copy = {
  en: {
    titlePlaceholder: "What needs to be done?",
    notesPlaceholder: "Add details or context...",
    noList: "No list",
    noListMatch: "No matching list",
    today: "Today",
    tomorrow: "Tomorrow",
    nextMonday: "Next Mon",
    dateTitle: "Pick date",
    addTime: "Add time",
    clearDate: "Clear date",
    clearTime: "Clear time",
    press: "Press",
    cancel: "cancel",
    create: "Create Task",
    creating: "Creating...",
    created: "Created",
    chooseTitle: "Choose a list and enter a task title.",
    saving: "Saving task...",
    savedOffline: "Saved offline. It will sync later.",
    savedGoogle: "Saved to Google Tasks.",
    saveFailed: "Save failed:",
    cacheMissing: "No local cache. Sync once in the main window first.",
    createHint: "Press Ctrl+Enter to create.",
    list: "List",
    reminderTime: "Reminder time",
    close: "Close",
    chooseList: "Choose a list",
    listSearchHint: "Type after # to filter",
    selected: "Selected",
  },
  zh: {
    titlePlaceholder: "准备做什么？",
    notesPlaceholder: "添加详细描述或上下文...",
    noList: "暂无清单",
    noListMatch: "没有匹配的清单",
    today: "今日",
    tomorrow: "明日",
    nextMonday: "下周一",
    dateTitle: "选择日期",
    addTime: "添加时间",
    clearDate: "清除日期",
    clearTime: "清除时间",
    press: "按",
    cancel: "取消",
    create: "创建任务",
    creating: "创建中...",
    created: "已创建",
    chooseTitle: "请先选择清单并填写任务标题。",
    saving: "正在保存任务...",
    savedOffline: "已离线保存，联网后会自动同步。",
    savedGoogle: "已保存到 Google Tasks。",
    saveFailed: "保存失败：",
    cacheMissing: "无法读取本地缓存，请先在主窗口同步一次。",
    createHint: "按 Ctrl+Enter 创建任务。",
    list: "清单",
    reminderTime: "提醒时间",
    close: "关闭",
    chooseList: "选择清单",
    listSearchHint: "在 # 后输入可筛选",
    selected: "已选择",
  },
} as const;

function queryValue(name: string) {
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

function initialTheme(): QuickTheme {
  const theme = queryValue("theme");
  if (theme === "dark" || theme === "light") {
    return theme;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function initialLanguage(): LanguageMode {
  const lang = queryValue("lang");
  if (lang === "zh" || lang === "en") {
    return lang;
  }
  return window.localStorage.getItem("googleTodoLanguage") === "zh" ? "zh" : "en";
}

function formatDate(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(base: Date, offset: number) {
  const date = new Date(base);
  date.setDate(date.getDate() + offset);
  return date;
}

function localDate(offsetDays = 0) {
  return formatDate(addDays(new Date(), offsetDays));
}

function nextMonday() {
  const date = new Date();
  const day = date.getDay();
  const offset = day === 1 ? 7 : (8 - day) % 7 || 7;
  date.setDate(date.getDate() + offset);
  return formatDate(date);
}

function formatDisplayDate(dateValue: string, language: LanguageMode) {
  if (!dateValue) {
    return "";
  }
  const parsed = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dateValue;
  }
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function dueForGoogle(dateValue: string) {
  return dateValue ? `${dateValue}T00:00:00.000Z` : undefined;
}

function composeNotes(notes: string, reminderTime: string, language: LanguageMode) {
  const trimmedNotes = notes.trim();
  if (!reminderTime) {
    return trimmedNotes || undefined;
  }
  const reminderLine = language === "zh" ? `提醒时间：${reminderTime}` : `Reminder time: ${reminderTime}`;
  return trimmedNotes ? `${reminderLine}\n\n${trimmedNotes}` : reminderLine;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function findListMention(text: string): ListMentionMatch | null {
  const match = text.match(/\s#([^\s#]*)$/);
  if (!match || match.index === undefined) {
    return null;
  }
  const source = match[0];
  const hashOffset = source.lastIndexOf("#");
  const start = match.index + hashOffset;
  return {
    keyword: match[1] ?? "",
    start,
    end: match.index + source.length,
  };
}

function removeTitleRange(text: string, start: number, end: number) {
  return normalizeWhitespace(`${text.slice(0, start)} ${text.slice(end)}`);
}

function filterListCandidates(lists: QuickList[], keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) {
    return lists;
  }
  const startsWith = lists.filter((list) => list.title.toLowerCase().startsWith(normalized));
  const includes = lists.filter(
    (list) => !list.title.toLowerCase().startsWith(normalized) && list.title.toLowerCase().includes(normalized),
  );
  return [...startsWith, ...includes];
}

function chineseWeekdayToNumber(value: string) {
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    日: 0,
    天: 0,
  };
  return map[value] ?? 0;
}

function resolveWeekdayDate(base: Date, weekday: number, mode: "current" | "next" | "plain") {
  const currentDay = base.getDay();

  if (mode === "next") {
    const date = new Date(base);
    let offset = (weekday - currentDay + 7) % 7;
    if (offset === 0) {
      offset = 7;
    }
    date.setDate(base.getDate() + offset);
    return formatDate(date);
  }

  if (mode === "current") {
    const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
    const date = new Date(base);
    date.setDate(base.getDate() + mondayOffset + (weekday === 0 ? 6 : weekday - 1));
    return formatDate(date);
  }

  const date = new Date(base);
  let offset = (weekday - currentDay + 7) % 7;
  if (offset === 0) {
    offset = 7;
  }
  date.setDate(base.getDate() + offset);
  return formatDate(date);
}

function resolveWeekendDate(base: Date) {
  const day = base.getDay();
  const saturday = new Date(base);
  if (day === 6 || day === 0) {
    saturday.setDate(base.getDate() - (day === 0 ? 1 : 0));
  } else {
    saturday.setDate(base.getDate() + (6 - day));
  }
  return formatDate(saturday);
}

function formatTime(hours: number, minutes: number) {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseExplicitTime(
  hoursText: string,
  minutesText: string | undefined,
  halfHour: boolean,
  period: string | undefined,
) {
  let hours = Number.parseInt(hoursText, 10);
  let minutes = halfHour ? 30 : 0;
  if (minutesText !== undefined) {
    minutes = Number.parseInt(minutesText, 10);
  }
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours > 23 || minutes > 59) {
    return null;
  }

  if (period === "下午" || period === "晚上" || period === "今晚") {
    if (hours < 12) {
      hours += 12;
    }
  } else if ((period === "早上" || period === "明早") && hours === 12) {
    hours = 0;
  }

  return formatTime(hours, minutes);
}

function parseQuickAddDirectives(text: string, now = new Date()): QuickDirectiveParseResult {
  let working = text;
  let dueDate: string | undefined;
  let reminderTime: string | undefined;
  let changed = false;

  const consume = (pattern: RegExp, apply: (...captures: string[]) => void) => {
    working = working.replace(pattern, (...args) => {
      const captures = args.slice(1, -2) as string[];
      apply(...captures, args[0] as string);
      changed = true;
      return " ";
    });
  };

  consume(/明早/g, () => {
    dueDate = formatDate(addDays(now, 1));
    reminderTime = "09:00";
  });

  consume(/今晚/g, () => {
    dueDate = dueDate ?? formatDate(now);
    reminderTime = "18:00";
  });

  consume(/后天/g, () => {
    dueDate = formatDate(addDays(now, 2));
  });

  consume(/明天/g, () => {
    dueDate = formatDate(addDays(now, 1));
  });

  consume(/今天/g, () => {
    dueDate = formatDate(now);
  });

  consume(/周末/g, () => {
    dueDate = resolveWeekendDate(now);
  });

  consume(/下周([一二三四五六日天])/g, (weekday) => {
    dueDate = resolveWeekdayDate(now, chineseWeekdayToNumber(weekday), "next");
  });

  consume(/本周([一二三四五六日天])/g, (weekday) => {
    dueDate = resolveWeekdayDate(now, chineseWeekdayToNumber(weekday), "current");
  });

  consume(/周([一二三四五六日天])/g, (weekday) => {
    dueDate = resolveWeekdayDate(now, chineseWeekdayToNumber(weekday), "plain");
  });

  consume(
    /(?:(明天|后天|今天|明早|今晚|早上|中午|下午|晚上)\s*)?([0-2]?\d)(?:[:：](\d{1,2})|点半|点)/g,
    (period, hours, minutes, source) => {
      if (period === "明天") {
        dueDate = formatDate(addDays(now, 1));
      } else if (period === "后天") {
        dueDate = formatDate(addDays(now, 2));
      } else if (period === "今天") {
        dueDate = formatDate(now);
      } else if (period === "明早") {
        dueDate = formatDate(addDays(now, 1));
      } else {
        dueDate = dueDate ?? formatDate(now);
      }

      reminderTime =
        parseExplicitTime(hours, minutes || undefined, source.includes("点半"), period || undefined) ??
        reminderTime;
    },
  );

  consume(/(早上|中午|下午|晚上)/g, (period) => {
    const defaults: Record<string, string> = {
      早上: "09:00",
      中午: "12:00",
      下午: "15:00",
      晚上: "18:00",
    };
    reminderTime = defaults[period];
    dueDate = dueDate ?? formatDate(now);
  });

  return {
    title: changed ? normalizeWhitespace(working) : text,
    dueDate,
    reminderTime,
  };
}

export function QuickAddStandalone() {
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [theme] = useState<QuickTheme>(() => initialTheme());
  const [language] = useState<LanguageMode>(() => initialLanguage());
  const [lists, setLists] = useState<QuickList[]>([]);
  const [listId, setListId] = useState(queryValue("listId"));
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState(localDate(0));
  const [reminderTime, setReminderTime] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState<string>(copy[initialLanguage()].createHint);
  const [activeListCandidateIndex, setActiveListCandidateIndex] = useState(0);

  const text = copy[language];
  const selectedList = lists.find((list) => list.id === listId);
  const canSubmit = useMemo(() => title.trim().length > 0 && listId.length > 0, [listId, title]);
  const displayDate = useMemo(() => formatDisplayDate(dueDate, language), [dueDate, language]);
  const listMention = useMemo(() => findListMention(title), [title]);
  const listCandidates = useMemo(
    () => (listMention ? filterListCandidates(lists, listMention.keyword) : []),
    [listMention, lists],
  );
  const listPickerOpen = Boolean(listMention);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, [language, theme]);

  useEffect(() => {
    setMessage(copy[language].createHint);
  }, [language]);

  useEffect(() => {
    syncApi
      .cachedSnapshot()
      .then((snapshot) => {
        const nextLists = snapshot.task_lists;
        setLists(nextLists);
        setListId((current) => current || (nextLists[0]?.id ?? ""));
      })
      .catch(() => setMessage(text.cacheMissing));
  }, [text.cacheMissing]);

  useEffect(() => {
    setActiveListCandidateIndex(0);
  }, [listMention?.keyword, listMention?.start]);

  const closeWindow = () => {
    getCurrentWebviewWindow().close().catch(() => undefined);
  };

  const toggleDueDate = (value: string) => {
    setDueDate((current) => (current === value ? "" : value));
  };

  const applyParsedDirectives = (rawTitle: string) => {
    const parsed = parseQuickAddDirectives(rawTitle, new Date());
    const nextTitle = parsed.title;

    if (nextTitle !== rawTitle) {
      setTitle(nextTitle);
    }
    if (parsed.dueDate !== undefined && parsed.dueDate !== dueDate) {
      setDueDate(parsed.dueDate);
    }
    if (parsed.reminderTime !== undefined && parsed.reminderTime !== reminderTime) {
      setReminderTime(parsed.reminderTime);
    }

    return parsed;
  };

  const selectListCandidate = (candidate: QuickList) => {
    if (!listMention) {
      return;
    }
    setListId(candidate.id);
    const nextTitle = removeTitleRange(title, listMention.start, listMention.end);
    setTitle(nextTitle);
    window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      const cursor = nextTitle.length;
      titleInputRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  const closeListPicker = () => {
    if (!listMention) {
      return;
    }
    setTitle((current) => removeTitleRange(current, listMention.start, listMention.end));
  };

  const submit = async () => {
    const parsed = applyParsedDirectives(title);
    const finalTitle = parsed.title.trim();

    if (!finalTitle || !listId) {
      setState("error");
      setMessage(text.chooseTitle);
      return;
    }

    setState("saving");
    setMessage(text.saving);
    try {
      const task = await syncApi.createTask({
        task_list_id: listId,
        title: finalTitle,
        notes: composeNotes(notes, parsed.reminderTime ?? reminderTime, language),
        due: dueForGoogle(parsed.dueDate ?? dueDate),
      });
      await emitTo("main", "google-todo://task-created", {
        taskId: task.id,
        taskListId: listId,
      });
      setState("saved");
      setMessage(task.id.startsWith("local-") ? text.savedOffline : text.savedGoogle);
      window.setTimeout(closeWindow, 700);
    } catch (error) {
      setState("error");
      setMessage(`${text.saveFailed}${String(error)}`);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (listPickerOpen) {
          closeListPicker();
          return;
        }
        closeWindow();
        return;
      }

      if (listPickerOpen) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveListCandidateIndex((current) =>
            listCandidates.length === 0 ? 0 : (current + 1) % listCandidates.length,
          );
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveListCandidateIndex((current) =>
            listCandidates.length === 0 ? 0 : (current - 1 + listCandidates.length) % listCandidates.length,
          );
          return;
        }
        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
          if (listCandidates[activeListCandidateIndex]) {
            event.preventDefault();
            selectListCandidate(listCandidates[activeListCandidateIndex]);
          }
          return;
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeListCandidateIndex, listCandidates, listPickerOpen, title, listMention, dueDate, reminderTime, listId]);

  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center overflow-hidden bg-transparent p-md font-sans antialiased",
        theme === "dark" ? "text-on-dark" : "text-body",
      )}
      data-tauri-drag-region
    >
      <main
        className={cn(
          "flex w-full max-w-[640px] flex-col overflow-hidden rounded-lg border shadow-panel",
          theme === "dark" ? "border-outline-variant/20 bg-surface-dark-elevated" : "border-hairline bg-canvas",
        )}
      >
        <section className="flex flex-col gap-sm p-lg" data-tauri-drag-region>
          <div className="flex items-start gap-md">
            <input
              ref={titleInputRef}
              className={cn(
                "min-w-0 flex-1 border-none bg-transparent p-0 text-title-lg outline-none placeholder:text-muted focus:ring-0",
                theme === "dark" ? "text-on-dark" : "text-ink",
              )}
              value={title}
              onBlur={() => {
                applyParsedDirectives(title);
              }}
              onChange={(event) => {
                const nextValue = event.target.value;
                setTitle(nextValue);
                if (/[，。！？、,.!? ]$/.test(nextValue)) {
                  window.requestAnimationFrame(() => {
                    applyParsedDirectives(nextValue);
                  });
                }
              }}
              autoFocus
              placeholder={text.titlePlaceholder}
            />
            <button
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded transition-colors",
                theme === "dark" ? "text-on-dark-soft hover:bg-surface-dark hover:text-on-dark" : "text-muted hover:bg-surface-soft hover:text-ink",
              )}
              onClick={closeWindow}
              title={text.close}
            >
              <X size={18} />
            </button>
          </div>

          {listPickerOpen ? (
            <div
              className={cn(
                "overflow-hidden rounded-xl border shadow-panel",
                theme === "dark"
                  ? "border-outline-variant/20 bg-surface-dark-elevated"
                  : "border-hairline bg-canvas",
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-between border-b px-md py-sm",
                  theme === "dark" ? "border-outline-variant/10" : "border-hairline-soft",
                )}
              >
                <div className="flex min-w-0 items-center gap-sm">
                  <div
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                      theme === "dark" ? "bg-surface-dark text-on-dark-soft" : "bg-surface-soft text-muted",
                    )}
                  >
                    <Search size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className={cn("text-body-sm font-semibold", theme === "dark" ? "text-on-dark" : "text-ink")}>
                      {text.chooseList}
                    </div>
                    <div className="truncate text-caption text-muted">
                      {listMention?.keyword ? `#${listMention.keyword}` : text.listSearchHint}
                    </div>
                  </div>
                </div>
                <div className="hidden items-center gap-xxs text-caption text-muted sm:flex">
                  <KeyChip theme={theme}>↑</KeyChip>
                  <KeyChip theme={theme}>↓</KeyChip>
                  <KeyChip theme={theme}>Enter</KeyChip>
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto p-xs">
                {listCandidates.length === 0 ? (
                  <div
                    className={cn(
                      "rounded-lg border border-dashed px-md py-lg text-center text-body-sm",
                      theme === "dark" ? "border-outline-variant/20 text-on-dark-soft" : "border-hairline text-muted",
                    )}
                  >
                    {text.noListMatch}
                  </div>
                ) : (
                  listCandidates.map((candidate, index) => {
                    const active = index === activeListCandidateIndex;
                    const selected = candidate.id === listId;
                    return (
                      <button
                        key={candidate.id}
                        className={cn(
                          "group flex w-full items-center gap-sm rounded-lg px-sm py-sm text-left transition-all",
                          active
                            ? theme === "dark"
                              ? "bg-on-dark text-surface-dark shadow-subtle"
                              : "bg-primary text-on-dark shadow-subtle"
                            : theme === "dark"
                              ? "text-on-dark hover:bg-surface-dark"
                              : "text-ink hover:bg-surface-soft",
                        )}
                        onMouseEnter={() => setActiveListCandidateIndex(index)}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          selectListCandidate(candidate);
                        }}
                      >
                        <span
                          className={cn(
                            "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                            active
                              ? theme === "dark"
                                ? "bg-surface-dark/10"
                                : "bg-white/15"
                              : theme === "dark"
                                ? "bg-surface-dark text-on-dark-soft"
                                : "bg-surface-soft text-muted",
                          )}
                        >
                          <Folder size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body-sm font-medium">{candidate.title}</span>
                          {selected ? (
                            <span className={cn("mt-xxs block text-caption", active ? "opacity-80" : "text-muted")}>
                              {text.selected}
                            </span>
                          ) : null}
                        </span>
                        {selected ? <Check size={17} /> : <ChevronDown size={16} className="rotate-[-90deg] opacity-40" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}

          <textarea
            className={cn(
              "mt-xs h-[72px] w-full resize-none border-none bg-transparent p-0 text-body-sm outline-none placeholder:text-muted-soft focus:ring-0",
              theme === "dark" ? "text-on-dark-soft" : "text-body",
            )}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={text.notesPlaceholder}
          />

          <div className={cn("my-sm h-px w-full", theme === "dark" ? "bg-outline-variant/10" : "bg-hairline-soft")} />

          <div className="flex flex-wrap items-center gap-sm">
            <div className="relative">
              <select
                className={cn(
                  "h-8 min-w-[128px] appearance-none rounded border px-sm pr-xl text-caption outline-none transition-colors focus:border-primary",
                  theme === "dark"
                    ? "border-outline-variant/20 bg-surface-dark text-on-dark-soft hover:border-outline-variant/40 hover:text-on-dark"
                    : "border-hairline bg-surface text-ink hover:border-outline-variant",
                )}
                value={listId}
                onChange={(event) => setListId(event.target.value)}
              >
                {lists.length === 0 ? <option value="">{text.noList}</option> : null}
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.title}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-xs top-1/2 -translate-y-1/2 text-muted" />
            </div>

            <div className={cn("flex items-center rounded border p-[2px]", theme === "dark" ? "border-outline-variant/20 bg-surface-dark" : "border-hairline bg-surface-soft")}>
              <DateShortcut active={dueDate === localDate(0)} theme={theme} onClick={() => toggleDueDate(localDate(0))}>
                {text.today}
              </DateShortcut>
              <DateShortcut active={dueDate === localDate(1)} theme={theme} onClick={() => toggleDueDate(localDate(1))}>
                {text.tomorrow}
              </DateShortcut>
              <DateShortcut active={dueDate === nextMonday()} theme={theme} onClick={() => toggleDueDate(nextMonday())}>
                {text.nextMonday}
              </DateShortcut>
              <div className={cn("mx-xs h-3 w-px", theme === "dark" ? "bg-outline-variant/20" : "bg-hairline")} />
              <label
                className={cn(
                  "relative flex h-7 cursor-pointer items-center gap-xs rounded px-sm text-caption transition-colors",
                  dueDate
                    ? theme === "dark"
                      ? "bg-on-dark text-surface-dark"
                      : "bg-primary text-on-dark"
                    : theme === "dark"
                      ? "text-on-dark-soft hover:text-on-dark"
                      : "text-muted hover:text-ink",
                )}
                title={text.dateTitle}
              >
                <CalendarDays size={16} />
                {displayDate ? <span>{displayDate}</span> : null}
                <input
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </label>
              {dueDate ? (
                <button
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded text-caption transition-colors",
                    theme === "dark" ? "text-on-dark-soft hover:bg-surface-dark-elevated hover:text-on-dark" : "text-muted hover:bg-canvas hover:text-ink",
                  )}
                  onClick={() => setDueDate("")}
                  title={text.clearDate}
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>

            {reminderTime ? (
              <div
                className={cn(
                  "flex h-8 items-center gap-xs rounded border px-sm text-caption transition-colors",
                  theme === "dark"
                    ? "border-on-dark bg-on-dark text-surface-dark"
                    : "border-primary bg-primary text-on-dark",
                )}
              >
                <Clock3 size={16} />
                <input
                  className={cn(
                    "w-[78px] border-none bg-transparent p-0 text-caption outline-none focus:ring-0",
                    theme === "dark" ? "text-surface-dark [color-scheme:light]" : "text-on-dark [color-scheme:dark]",
                  )}
                  type="time"
                  value={reminderTime}
                  onChange={(event) => setReminderTime(event.target.value)}
                  title={text.reminderTime}
                />
                <button
                  className={cn(
                    "grid h-5 w-5 place-items-center rounded transition-colors",
                    theme === "dark" ? "hover:bg-surface-dark/10" : "hover:bg-white/10",
                  )}
                  onClick={() => setReminderTime("")}
                  title={text.clearTime}
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                className={cn(
                  "flex h-8 items-center gap-xs rounded border px-sm text-caption transition-colors",
                  theme === "dark"
                    ? "border-outline-variant/20 bg-surface-dark text-on-dark-soft hover:border-outline-variant/40 hover:text-on-dark"
                    : "border-hairline bg-surface text-ink hover:border-outline-variant",
                )}
                onClick={() => setReminderTime("09:00")}
              >
                <Clock3 size={16} className="text-muted" />
                {text.addTime}
              </button>
            )}
          </div>
        </section>

        <footer
          className={cn(
            "flex items-center justify-between border-t px-lg py-sm",
            theme === "dark" ? "border-outline-variant/10 bg-surface-dark" : "border-hairline bg-surface-soft",
          )}
          data-tauri-drag-region
        >
          <div className="hidden items-center gap-md text-caption text-muted-soft sm:flex">
            <span className="flex items-center gap-xxs">
              {text.press} <KeyChip theme={theme}>Esc</KeyChip> {text.cancel}
            </span>
            <span className="flex items-center gap-xxs">
              {text.press} <KeyChip theme={theme}>Ctrl</KeyChip> <KeyChip theme={theme}>Enter</KeyChip> {text.create}
            </span>
          </div>
          <div className="sm:hidden" />

          <button
            className={cn(
              "inline-flex h-9 items-center justify-center gap-xs rounded px-lg text-button shadow-subtle transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
              state === "saved" ? "bg-success text-white" : state === "error" ? "bg-error text-white" : "bg-primary text-on-dark hover:bg-primary-active",
            )}
            disabled={state === "saving"}
            onClick={() => void submit()}
          >
            {state === "saving" ? <Loader2 size={17} className="animate-spin" /> : null}
            {state === "saved" ? <Check size={17} /> : null}
            {state === "idle" || state === "error" ? <Plus size={17} /> : null}
            {state === "saving" ? text.creating : state === "saved" ? text.created : text.create}
          </button>
        </footer>

        <div
          className={cn(
            "min-h-7 px-lg pb-xs text-caption",
            state === "error" ? "text-error" : state === "saved" ? "text-success" : "text-muted",
            theme === "dark" ? "bg-surface-dark" : "bg-surface-soft",
          )}
        >
          {selectedList ? `${message} ${text.list}: ${selectedList.title}` : message}
        </div>
      </main>
    </div>
  );
}

function DateShortcut({
  active,
  theme,
  children,
  onClick,
}: {
  active: boolean;
  theme: QuickTheme;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "h-7 rounded-sm px-md text-caption transition-colors",
        active
          ? theme === "dark"
            ? "bg-on-dark text-surface-dark shadow-subtle"
            : "bg-primary text-on-dark shadow-subtle"
          : theme === "dark"
            ? "text-on-dark-soft hover:text-on-dark"
            : "text-muted hover:text-ink",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function KeyChip({ theme, children }: { theme: QuickTheme; children: ReactNode }) {
  return (
    <kbd
      className={cn(
        "rounded-sm border px-xs py-xxs font-code text-[11px] shadow-subtle",
        theme === "dark" ? "border-outline-variant/20 bg-surface-dark-elevated text-on-dark-soft" : "border-hairline bg-canvas text-muted",
      )}
    >
      {children}
    </kbd>
  );
}
