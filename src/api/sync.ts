import { invoke } from "@tauri-apps/api/core";
import type {
  CreateTaskInput,
  GoogleTaskDto,
  GoogleTaskListDto,
  MoveTaskInput,
  UpdateTaskInput,
} from "./googleTasks";

export type CachedSnapshot = {
  task_lists: GoogleTaskListDto[];
  tasks: GoogleTaskDto[];
  last_synced_at?: string | null;
  pending_count: number;
  offline: boolean;
};

export type SyncResult = {
  status: "ok" | "offline" | "auth_required" | "forbidden" | "not_found" | "error";
  message: string;
  snapshot: CachedSnapshot;
};

export const syncApi = {
  appSettings: () => invoke<Record<string, string>>("sync_app_settings"),
  setAppSetting: (key: string, value: string | null) =>
    invoke<void>("sync_set_app_setting", { key, value }),
  cachedSnapshot: () => invoke<CachedSnapshot>("sync_cached_snapshot"),
  syncNow: () => invoke<SyncResult>("sync_google_now"),
  createTask: (input: CreateTaskInput) => invoke<GoogleTaskDto>("sync_create_task", { input }),
  updateTask: (input: UpdateTaskInput) => invoke<GoogleTaskDto>("sync_update_task", { input }),
  deleteTask: (taskListId: string, taskId: string) =>
    invoke<void>("sync_delete_task", { taskListId, taskId }),
  moveTask: (input: MoveTaskInput) => invoke<GoogleTaskDto>("sync_move_task", { input }),
};
