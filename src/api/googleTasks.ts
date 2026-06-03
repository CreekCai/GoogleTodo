import { invoke } from "@tauri-apps/api/core";

export type AuthStatus = {
  configured: boolean;
  signed_in: boolean;
  user_hint?: string | null;
  user_name?: string | null;
  user_email?: string | null;
};

export type GoogleProxyMode = "system" | "custom" | "none";

export type GoogleProxyConfig = {
  mode: GoogleProxyMode;
  url: string;
};

export type GoogleTaskListDto = {
  id: string;
  title: string;
};

export type GoogleTaskDto = {
  id: string;
  task_list_id: string;
  title: string;
  notes?: string | null;
  due?: string | null;
  status: string;
  parent?: string | null;
  position?: string | null;
  completed: boolean;
  completed_at?: string | null;
};

export type GoogleCalendarEventDto = {
  id: string;
  calendar_id: string;
  calendar_name: string;
  title: string;
  description?: string | null;
  location?: string | null;
  start: string;
  end?: string | null;
  all_day: boolean;
  color?: string | null;
};

export type GoogleCalendarListDto = {
  id: string;
  name: string;
  color?: string | null;
  selected: boolean;
  primary: boolean;
};

export type UpdateCalendarEventInput = {
  calendar_id: string;
  event_id: string;
  title?: string | null;
  description?: string | null;
  date?: string | null;
  time?: string | null;
};

export type CreateTaskInput = {
  task_list_id: string;
  title: string;
  notes?: string | null;
  due?: string | null;
  parent?: string | null;
  previous?: string | null;
};

export type UpdateTaskInput = {
  task_list_id: string;
  task_id: string;
  title?: string | null;
  notes?: string | null;
  due?: string | null;
  status?: "needsAction" | "completed";
};

export type MoveTaskInput = {
  task_list_id: string;
  task_id: string;
  parent?: string | null;
  previous?: string | null;
};

export const googleTasksApi = {
  authStatus: () => invoke<AuthStatus>("google_auth_status"),
  proxyConfig: () => invoke<GoogleProxyConfig>("google_proxy_config"),
  saveProxyConfig: (config: GoogleProxyConfig) =>
    invoke<GoogleProxyConfig>("google_save_proxy_config", { config }),
  saveClientId: (clientId: string) => invoke<AuthStatus>("google_save_client_id", { clientId }),
  saveClientCredentials: (clientId: string, clientSecret: string) =>
    invoke<AuthStatus>("google_save_client_credentials", { clientId, clientSecret }),
  login: (clientIdOverride?: string, clientSecretOverride?: string) =>
    invoke<AuthStatus>("google_oauth_login", { clientIdOverride, clientSecretOverride }),
  signOut: () => invoke<AuthStatus>("google_sign_out"),
  taskLists: () => invoke<GoogleTaskListDto[]>("google_task_lists"),
  tasks: (taskListId: string) => invoke<GoogleTaskDto[]>("google_tasks", { taskListId }),
  calendarLists: () => invoke<GoogleCalendarListDto[]>("google_calendar_lists"),
  calendarEvents: (month: string, calendarIds?: string[] | null) =>
    invoke<GoogleCalendarEventDto[]>("google_calendar_events", { month, calendarIds }),
  updateCalendarEvent: (input: UpdateCalendarEventInput) =>
    invoke<GoogleCalendarEventDto>("google_update_calendar_event", { input }),
  deleteCalendarEvent: (calendarId: string, eventId: string) =>
    invoke<void>("google_delete_calendar_event", { calendarId, eventId }),
  createTask: (input: CreateTaskInput) =>
    invoke<GoogleTaskDto>("google_create_task", { input }),
  updateTask: (input: UpdateTaskInput) =>
    invoke<GoogleTaskDto>("google_update_task", { input }),
  deleteTask: (taskListId: string, taskId: string) =>
    invoke<void>("google_delete_task", { taskListId, taskId }),
  moveTask: (input: MoveTaskInput) => invoke<GoogleTaskDto>("google_move_task", { input }),
};
