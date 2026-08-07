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

export type ArchiveCleanupResult = {
  deleted_count: number;
  cutoff: string;
};

export type SyncQueueItem = {
  id: number;
  operation: string;
  task_title: string;
  task_list_id: string;
  task_id: string | null;
  sync_status: "waiting" | "syncing" | "completed" | "failed";
  created_at: string;
  synced_at: string | null;
  attempt_count: number;
  last_error: string | null;
  queue_position: number | null;
};

export type SyncQueueSnapshot = {
  items: SyncQueueItem[];
  waiting_count: number;
  syncing_count: number;
  completed_count: number;
  failed_count: number;
};

let taskMutationQueue: Promise<void> = Promise.resolve();

function enqueueTaskMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = taskMutationQueue.then(mutation);
  taskMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export const syncApi = {
  appSettings: () => invoke<Record<string, string>>("sync_app_settings"),
  setAppSetting: (key: string, value: string | null) =>
    invoke<void>("sync_set_app_setting", { key, value }),
  cachedSnapshot: () => invoke<CachedSnapshot>("sync_cached_snapshot"),
  queueStatus: () => invoke<SyncQueueSnapshot>("sync_queue_status"),
  purgeArchivedTasks: (olderThanDays: 7 | 30) =>
    invoke<ArchiveCleanupResult>("sync_purge_archived_tasks", { olderThanDays }),
  syncNow: () => taskMutationQueue.then(() => invoke<SyncResult>("sync_google_now")),
  createTask: (input: CreateTaskInput) =>
    enqueueTaskMutation(() => invoke<GoogleTaskDto>("sync_create_task", { input })),
  updateTask: (input: UpdateTaskInput) =>
    enqueueTaskMutation(() => invoke<GoogleTaskDto>("sync_update_task", { input })),
  deleteTask: (taskListId: string, taskId: string) =>
    enqueueTaskMutation(() => invoke<void>("sync_delete_task", { taskListId, taskId })),
  moveTask: (input: MoveTaskInput) =>
    enqueueTaskMutation(() => invoke<GoogleTaskDto>("sync_move_task", { input })),
};
