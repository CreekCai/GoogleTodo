use std::{
    collections::HashMap,
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use rand::{distributions::Alphanumeric, Rng};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::google_tasks::{
    self, CreateTaskInput, GoogleTaskDto, GoogleTaskListDto, GoogleTasksState, MoveTaskInput,
    UpdateTaskInput,
};

const DB_FILE_NAME: &str = "google_tasks_cache.sqlite3";

#[derive(Debug, Serialize)]
pub struct CachedSnapshot {
    pub task_lists: Vec<GoogleTaskListDto>,
    pub tasks: Vec<GoogleTaskDto>,
    pub last_synced_at: Option<String>,
    pub pending_count: i64,
    pub offline: bool,
}

#[derive(Debug, Serialize)]
pub struct SyncResult {
    pub status: String,
    pub message: String,
    pub snapshot: CachedSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingItem {
    id: i64,
    operation: String,
    local_id: Option<String>,
    task_list_id: String,
    task_id: Option<String>,
    payload_json: String,
}

#[tauri::command]
pub async fn sync_cached_snapshot(app: AppHandle) -> Result<CachedSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || sync_cached_snapshot_blocking(app))
        .await
        .map_err(to_message)?
}

fn sync_cached_snapshot_blocking(app: AppHandle) -> Result<CachedSnapshot, String> {
    let conn = open_app_database(&app)?;
    read_cached_snapshot(&conn, false)
}

#[tauri::command]
pub async fn sync_google_now(app: AppHandle) -> Result<SyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || sync_google_now_blocking(app))
        .await
        .map_err(to_message)?
}

fn sync_google_now_blocking(app: AppHandle) -> Result<SyncResult, String> {
    let conn = open_app_database(&app)?;
    let state = app.state::<GoogleTasksState>();
    match run_full_sync(&app, &conn, &state) {
        Ok(()) => Ok(SyncResult {
            status: "ok".to_string(),
            message: "同步完成".to_string(),
            snapshot: read_cached_snapshot(&conn, false)?,
        }),
        Err(error) => {
            let status = classify_google_error(&error);
            Ok(SyncResult {
                message: user_message_for_status(&status, &error),
                status: status.to_string(),
                snapshot: read_cached_snapshot(&conn, status == "offline")?,
            })
        }
    }
}

#[tauri::command]
pub async fn sync_create_task(
    app: AppHandle,
    input: CreateTaskInput,
) -> Result<GoogleTaskDto, String> {
    tauri::async_runtime::spawn_blocking(move || sync_create_task_blocking(app, input))
        .await
        .map_err(to_message)?
}

fn sync_create_task_blocking(
    app: AppHandle,
    input: CreateTaskInput,
) -> Result<GoogleTaskDto, String> {
    let conn = open_app_database(&app)?;
    let task = local_task_from_create(&input);
    upsert_task(&conn, &task)?;
    enqueue_pending(
        &conn,
        "create_task",
        Some(&task.id),
        &input.task_list_id,
        None,
        &serde_json::to_value(input.clone()).map_err(to_message)?,
    )?;
    Ok(task)
}

#[tauri::command]
pub async fn sync_update_task(
    app: AppHandle,
    input: UpdateTaskInput,
) -> Result<GoogleTaskDto, String> {
    tauri::async_runtime::spawn_blocking(move || sync_update_task_blocking(app, input))
        .await
        .map_err(to_message)?
}

fn sync_update_task_blocking(
    app: AppHandle,
    input: UpdateTaskInput,
) -> Result<GoogleTaskDto, String> {
    let conn = open_app_database(&app)?;
    let task = update_cached_task(&conn, &input)?;
    enqueue_pending(
        &conn,
        "update_task",
        None,
        &input.task_list_id,
        Some(&input.task_id),
        &serde_json::to_value(input.clone()).map_err(to_message)?,
    )?;
    Ok(task)
}

#[tauri::command]
pub async fn sync_delete_task(
    app: AppHandle,
    task_list_id: String,
    task_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        sync_delete_task_blocking(app, task_list_id, task_id)
    })
    .await
    .map_err(to_message)?
}

fn sync_delete_task_blocking(
    app: AppHandle,
    task_list_id: String,
    task_id: String,
) -> Result<(), String> {
    let conn = open_app_database(&app)?;
    delete_cached_task(&conn, &task_id)?;
    enqueue_pending(
        &conn,
        "delete_task",
        None,
        &task_list_id,
        Some(&task_id),
        &Value::Null,
    )
}

#[tauri::command]
pub async fn sync_move_task(
    app: AppHandle,
    input: MoveTaskInput,
) -> Result<GoogleTaskDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_app_database(&app)?;
        let task = read_task(&conn, &input.task_id)?
            .ok_or_else(|| "Local cached task not found for move".to_string())?;
        enqueue_pending(
            &conn,
            "move_task",
            None,
            &input.task_list_id,
            Some(&input.task_id),
            &serde_json::to_value(input.clone()).map_err(to_message)?,
        )?;
        Ok(task)
    })
    .await
    .map_err(to_message)?
}
fn run_full_sync(
    app: &AppHandle,
    conn: &Connection,
    state: &State<GoogleTasksState>,
) -> Result<(), String> {
    flush_pending_queue(app, conn, state)?;
    let lists = retry_auth_once(state, || {
        google_tasks::google_task_lists(app.clone(), state.clone())
    })?;

    replace_task_lists(conn, &lists)?;
    replace_tasks_begin(conn)?;
    for list in &lists {
        let tasks = retry_auth_once(state, || {
            google_tasks::google_tasks(app.clone(), state.clone(), list.id.clone())
        })?;
        for task in tasks {
            upsert_task(conn, &task)?;
        }
    }
    delete_tasks_not_in_lists(conn, &lists)?;
    set_meta(conn, "lastSyncedAt", &now_string())?;
    Ok(())
}

fn flush_pending_queue(
    app: &AppHandle,
    conn: &Connection,
    state: &State<GoogleTasksState>,
) -> Result<(), String> {
    let pending = pending_items(conn)?;
    let mut id_map: HashMap<String, String> = HashMap::new();

    for item in pending {
        match item.operation.as_str() {
            "create_task" => {
                let mut input: CreateTaskInput =
                    serde_json::from_str(&item.payload_json).map_err(to_message)?;
                if let Some(parent) = input.parent.clone().and_then(|id| id_map.get(&id).cloned()) {
                    input.parent = Some(parent);
                }
                let remote = retry_auth_once(state, || {
                    google_tasks::google_create_task(app.clone(), state.clone(), input.clone())
                })?;
                if let Some(local_id) = item.local_id.as_deref() {
                    id_map.insert(local_id.to_string(), remote.id.clone());
                    delete_cached_task(conn, local_id)?;
                }
                upsert_task(conn, &remote)?;
                delete_pending(conn, item.id)?;
            }
            "update_task" => {
                let mut input: UpdateTaskInput =
                    serde_json::from_str(&item.payload_json).map_err(to_message)?;
                if let Some(remote_id) = id_map.get(&input.task_id).cloned() {
                    input.task_id = remote_id;
                }
                let remote = retry_auth_once(state, || {
                    google_tasks::google_update_task(app.clone(), state.clone(), input.clone())
                })?;
                upsert_task(conn, &remote)?;
                delete_pending(conn, item.id)?;
            }
            "delete_task" => {
                if let Some(task_id) = item.task_id.as_deref() {
                    let remote_id = id_map.get(task_id).map(String::as_str).unwrap_or(task_id);
                    if !remote_id.starts_with("local-") {
                        retry_auth_once(state, || {
                            google_tasks::google_delete_task(
                                app.clone(),
                                state.clone(),
                                item.task_list_id.clone(),
                                remote_id.to_string(),
                            )
                        })?;
                    }
                }
                delete_pending(conn, item.id)?;
            }
            "move_task" => {
                let mut input: MoveTaskInput =
                    serde_json::from_str(&item.payload_json).map_err(to_message)?;
                if let Some(remote_id) = id_map.get(&input.task_id).cloned() {
                    input.task_id = remote_id;
                }
                let remote = retry_auth_once(state, || {
                    google_tasks::google_move_task(app.clone(), state.clone(), input.clone())
                })?;
                upsert_task(conn, &remote)?;
                delete_pending(conn, item.id)?;
            }
            _ => delete_pending(conn, item.id)?,
        }
    }

    Ok(())
}

fn retry_auth_once<T>(
    state: &State<GoogleTasksState>,
    mut action: impl FnMut() -> Result<T, String>,
) -> Result<T, String> {
    match action() {
        Ok(value) => Ok(value),
        Err(error) if classify_google_error(&error) == "auth_required" => {
            state.clear_access_cache()?;
            action()
        }
        Err(error) => Err(error),
    }
}

fn open_app_database(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(to_message)?;
    open_database_at(&dir)
}

fn open_database_at(dir: &Path) -> Result<Connection, String> {
    fs::create_dir_all(dir).map_err(to_message)?;
    let conn = Connection::open(dir.join(DB_FILE_NAME)).map_err(to_message)?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS task_lists (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          raw_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_synced_at TEXT
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          task_list_id TEXT NOT NULL,
          title TEXT NOT NULL,
          notes TEXT,
          due TEXT,
          status TEXT NOT NULL,
          parent TEXT,
          position TEXT,
          completed INTEGER NOT NULL,
          completed_at TEXT,
          raw_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_synced_at TEXT
        );

        CREATE TABLE IF NOT EXISTS sync_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pending_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          operation TEXT NOT NULL,
          local_id TEXT,
          task_list_id TEXT NOT NULL,
          task_id TEXT,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        );
        "#,
    )
    .map_err(to_message)?;

    let _ = conn.execute("ALTER TABLE tasks ADD COLUMN completed_at TEXT", []);
    Ok(())
}

fn read_cached_snapshot(conn: &Connection, offline: bool) -> Result<CachedSnapshot, String> {
    let task_lists = read_task_lists(conn)?;
    let tasks = read_tasks(conn)?;
    let last_synced_at = get_meta(conn, "lastSyncedAt")?;
    let pending_count = conn
        .query_row("SELECT COUNT(*) FROM pending_queue", [], |row| row.get(0))
        .map_err(to_message)?;

    Ok(CachedSnapshot {
        task_lists,
        tasks,
        last_synced_at,
        pending_count,
        offline,
    })
}

fn read_task_lists(conn: &Connection) -> Result<Vec<GoogleTaskListDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, title FROM task_lists ORDER BY title COLLATE NOCASE")
        .map_err(to_message)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(GoogleTaskListDto {
                id: row.get(0)?,
                title: row.get(1)?,
            })
        })
        .map_err(to_message)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(to_message)
}

fn read_tasks(conn: &Connection) -> Result<Vec<GoogleTaskDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, task_list_id, title, notes, due, status, parent, position, completed, completed_at
             FROM tasks
             ORDER BY task_list_id, position, updated_at",
        )
        .map_err(to_message)?;
    let rows = stmt
        .query_map([], |row| {
            let completed: i64 = row.get(8)?;
            Ok(GoogleTaskDto {
                id: row.get(0)?,
                task_list_id: row.get(1)?,
                title: row.get(2)?,
                notes: row.get(3)?,
                due: row.get(4)?,
                status: row.get(5)?,
                parent: row.get(6)?,
                position: row.get(7)?,
                completed: completed == 1,
                completed_at: row.get(9)?,
            })
        })
        .map_err(to_message)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(to_message)
}

fn replace_task_lists(conn: &Connection, lists: &[GoogleTaskListDto]) -> Result<(), String> {
    conn.execute("DELETE FROM task_lists", [])
        .map_err(to_message)?;
    for list in lists {
        upsert_task_list(conn, list)?;
    }
    Ok(())
}

fn upsert_task_list(conn: &Connection, list: &GoogleTaskListDto) -> Result<(), String> {
    let raw_json = serde_json::to_string(list).map_err(to_message)?;
    conn.execute(
        "INSERT INTO task_lists (id, title, raw_json, updated_at, last_synced_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           raw_json = excluded.raw_json,
           updated_at = excluded.updated_at,
           last_synced_at = excluded.last_synced_at",
        params![list.id, list.title, raw_json, now_string()],
    )
    .map_err(to_message)?;
    Ok(())
}

fn replace_tasks_begin(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM tasks WHERE id NOT LIKE 'local-%'", [])
        .map_err(to_message)?;
    Ok(())
}

fn delete_tasks_not_in_lists(conn: &Connection, lists: &[GoogleTaskListDto]) -> Result<(), String> {
    let valid_lists = lists
        .iter()
        .map(|list| list.id.as_str())
        .collect::<Vec<_>>();
    let tasks = read_tasks(conn)?;
    for task in tasks {
        if !task.id.starts_with("local-") && !valid_lists.contains(&task.task_list_id.as_str()) {
            delete_cached_task(conn, &task.id)?;
        }
    }
    Ok(())
}

fn upsert_task(conn: &Connection, task: &GoogleTaskDto) -> Result<(), String> {
    let raw_json = serde_json::to_string(task).map_err(to_message)?;
    conn.execute(
        "INSERT INTO tasks
         (id, task_list_id, title, notes, due, status, parent, position, completed, completed_at, raw_json, updated_at, last_synced_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
         ON CONFLICT(id) DO UPDATE SET
           task_list_id = excluded.task_list_id,
           title = excluded.title,
           notes = excluded.notes,
           due = excluded.due,
           status = excluded.status,
           parent = excluded.parent,
           position = excluded.position,
           completed = excluded.completed,
           completed_at = excluded.completed_at,
           raw_json = excluded.raw_json,
           updated_at = excluded.updated_at,
           last_synced_at = excluded.last_synced_at",
        params![
            task.id,
            task.task_list_id,
            task.title,
            task.notes,
            task.due,
            task.status,
            task.parent,
            task.position,
            if task.completed { 1 } else { 0 },
            task.completed_at,
            raw_json,
            now_string()
        ],
    )
    .map_err(to_message)?;
    Ok(())
}

fn read_task(conn: &Connection, task_id: &str) -> Result<Option<GoogleTaskDto>, String> {
    conn.query_row(
        "SELECT id, task_list_id, title, notes, due, status, parent, position, completed, completed_at
         FROM tasks WHERE id = ?1",
        params![task_id],
        |row| {
            let completed: i64 = row.get(8)?;
            Ok(GoogleTaskDto {
                id: row.get(0)?,
                task_list_id: row.get(1)?,
                title: row.get(2)?,
                notes: row.get(3)?,
                due: row.get(4)?,
                status: row.get(5)?,
                parent: row.get(6)?,
                position: row.get(7)?,
                completed: completed == 1,
                completed_at: row.get(9)?,
            })
        },
    )
    .optional()
    .map_err(to_message)
}

fn update_cached_task(conn: &Connection, input: &UpdateTaskInput) -> Result<GoogleTaskDto, String> {
    let mut task = read_task(conn, &input.task_id)?
        .ok_or_else(|| "本地缓存中没有找到要更新的任务".to_string())?;
    if let Some(title) = input.title.as_deref() {
        task.title = title.to_string();
    }
    if input.notes.is_some() {
        task.notes = input.notes.clone();
    }
    if input.due.is_some() {
        task.due = input.due.clone();
    }
    if let Some(status) = input.status.as_deref() {
        task.status = status.to_string();
        task.completed = status == "completed";
        task.completed_at = if task.completed {
            Some(now_string())
        } else {
            None
        };
    }
    upsert_task(conn, &task)?;
    Ok(task)
}

fn delete_cached_task(conn: &Connection, task_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM tasks WHERE id = ?1 OR parent = ?1",
        params![task_id],
    )
    .map_err(to_message)?;
    Ok(())
}

fn enqueue_pending(
    conn: &Connection,
    operation: &str,
    local_id: Option<&str>,
    task_list_id: &str,
    task_id: Option<&str>,
    payload: &Value,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO pending_queue
         (operation, local_id, task_list_id, task_id, payload_json, created_at, attempt_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
        params![
            operation,
            local_id,
            task_list_id,
            task_id,
            payload.to_string(),
            now_string()
        ],
    )
    .map_err(to_message)?;
    Ok(())
}

fn pending_items(conn: &Connection) -> Result<Vec<PendingItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, operation, local_id, task_list_id, task_id, payload_json
             FROM pending_queue ORDER BY id ASC",
        )
        .map_err(to_message)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PendingItem {
                id: row.get(0)?,
                operation: row.get(1)?,
                local_id: row.get(2)?,
                task_list_id: row.get(3)?,
                task_id: row.get(4)?,
                payload_json: row.get(5)?,
            })
        })
        .map_err(to_message)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(to_message)
}

fn delete_pending(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM pending_queue WHERE id = ?1", params![id])
        .map_err(to_message)?;
    Ok(())
}

fn get_meta(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM sync_meta WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(to_message)
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(to_message)?;
    Ok(())
}

fn local_task_from_create(input: &CreateTaskInput) -> GoogleTaskDto {
    GoogleTaskDto {
        id: format!("local-{}", random_id()),
        task_list_id: input.task_list_id.clone(),
        title: input.title.clone(),
        notes: input.notes.clone(),
        due: input.due.clone(),
        status: "needsAction".to_string(),
        parent: input.parent.clone(),
        position: None,
        completed: false,
        completed_at: None,
    }
}

fn classify_google_error(error: &str) -> &'static str {
    let lower = error.to_lowercase();
    if lower.contains("http 401") || lower.contains("invalid_grant") {
        "auth_required"
    } else if lower.contains("http 403") {
        "forbidden"
    } else if lower.contains("http 404") {
        "not_found"
    } else if lower.contains("无法连接")
        || lower.contains("error sending request")
        || lower.contains("dns")
        || lower.contains("timeout")
        || lower.contains("connection")
    {
        "offline"
    } else {
        "error"
    }
}

fn user_message_for_status(status: &str, error: &str) -> String {
    match status {
        "auth_required" => format!("登录已失效，请重新登录。详情：{error}"),
        "forbidden" => {
            format!("Google Tasks 权限不足，请检查 OAuth scope 和授权账号。详情：{error}")
        }
        "not_found" => format!("Google 上的任务或列表不存在，已保留本地缓存。详情：{error}"),
        "offline" => format!("当前网络不可用，已进入离线模式。详情：{error}"),
        _ => format!("同步失败：{error}"),
    }
}

fn now_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn random_id() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect()
}

fn to_message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_creates_cache_tables() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");
        let conn = open_database_at(temp_dir.path()).expect("打开测试数据库失败");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('task_lists', 'tasks', 'sync_meta', 'pending_queue')",
                [],
                |row| row.get(0),
            )
            .expect("读取表数量失败");
        assert_eq!(count, 4);
    }

    #[test]
    fn cache_snapshot_returns_lists_tasks_and_pending_count() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");
        let conn = open_database_at(temp_dir.path()).expect("打开测试数据库失败");
        upsert_task_list(
            &conn,
            &GoogleTaskListDto {
                id: "list-1".to_string(),
                title: "My Tasks".to_string(),
            },
        )
        .expect("写入列表失败");
        upsert_task(
            &conn,
            &GoogleTaskDto {
                id: "task-1".to_string(),
                task_list_id: "list-1".to_string(),
                title: "测试任务".to_string(),
                notes: None,
                due: None,
                status: "needsAction".to_string(),
                parent: None,
                position: None,
                completed: false,
                completed_at: None,
            },
        )
        .expect("写入任务失败");
        enqueue_pending(
            &conn,
            "delete_task",
            None,
            "list-1",
            Some("task-1"),
            &Value::Null,
        )
        .expect("写入 pending 失败");

        let snapshot = read_cached_snapshot(&conn, true).expect("读取缓存失败");
        assert_eq!(snapshot.task_lists.len(), 1);
        assert_eq!(snapshot.tasks.len(), 1);
        assert_eq!(snapshot.pending_count, 1);
        assert!(snapshot.offline);
    }

    #[test]
    fn classify_common_google_errors() {
        assert_eq!(
            classify_google_error("HTTP 401 Unauthorized"),
            "auth_required"
        );
        assert_eq!(classify_google_error("HTTP 403 Forbidden"), "forbidden");
        assert_eq!(classify_google_error("HTTP 404 Not Found"), "not_found");
        assert_eq!(classify_google_error("error sending request"), "offline");
    }
}
