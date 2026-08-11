use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Write},
    path::Path,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rand::{distributions::Alphanumeric, Rng};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::google_tasks::{
    self, CreateTaskInput, GoogleTaskDto, GoogleTaskListDto, GoogleTasksState, MoveTaskInput,
    UpdateTaskInput,
};

const DB_FILE_NAME: &str = "google_tasks_cache.sqlite3";
const SYNC_RETRY_DELAYS_SECONDS: [u64; 3] = [1, 2, 4];
const DIAGNOSTIC_LOG_FILE_NAME: &str = "google-todo-diagnostic.jsonl";
const DIAGNOSTIC_LOG_ROTATED_FILE_NAME: &str = "google-todo-diagnostic.jsonl.1";
const DIAGNOSTIC_LOG_RETENTION_SECONDS: u64 = 3 * 24 * 60 * 60;
static DIAGNOSTIC_LOG_LOCK: Mutex<()> = Mutex::new(());
static SYNC_RUN_LOCK: Mutex<()> = Mutex::new(());

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

#[derive(Debug, Serialize)]
pub struct ArchiveCleanupResult {
    pub deleted_count: usize,
    pub cutoff: String,
}

#[derive(Debug, Serialize)]
pub struct SyncQueueItem {
    pub id: i64,
    pub operation: String,
    pub task_title: String,
    pub task_list_id: String,
    pub task_id: Option<String>,
    pub sync_status: String,
    pub created_at: String,
    pub synced_at: Option<String>,
    pub attempt_count: i64,
    pub last_error: Option<String>,
    pub queue_position: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct SyncQueueSnapshot {
    pub items: Vec<SyncQueueItem>,
    pub waiting_count: i64,
    pub syncing_count: i64,
    pub completed_count: i64,
    pub failed_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingItem {
    id: i64,
    operation: String,
    local_id: Option<String>,
    task_list_id: String,
    task_id: Option<String>,
    payload_json: String,
    sync_status: String,
}

#[tauri::command]
pub async fn sync_cached_snapshot(app: AppHandle) -> Result<CachedSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || sync_cached_snapshot_blocking(app))
        .await
        .map_err(to_message)?
}

#[tauri::command]
pub async fn sync_app_settings(app: AppHandle) -> Result<HashMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_app_database(&app)?;
        read_app_settings(&conn)
    })
    .await
    .map_err(to_message)?
}

#[tauri::command]
pub async fn sync_set_app_setting(
    app: AppHandle,
    key: String,
    value: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_app_database(&app)?;
        set_app_setting(&conn, &key, value.as_deref())
    })
    .await
    .map_err(to_message)?
}

#[tauri::command]
pub async fn sync_queue_status(app: AppHandle) -> Result<SyncQueueSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_app_database(&app)?;
        read_sync_queue_snapshot(&conn)
    })
    .await
    .map_err(to_message)?
}

#[tauri::command]
pub async fn sync_record_diagnostic_event(
    app: AppHandle,
    event: String,
    details: Value,
) -> Result<(), String> {
    if event.is_empty()
        || event.len() > 80
        || !event
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return Err("Invalid diagnostic event name".to_string());
    }
    append_diagnostic_log(&app, &event, details);
    Ok(())
}

#[tauri::command]
pub async fn sync_open_diagnostic_log_folder(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(to_message)?;
    fs::create_dir_all(&dir).map_err(to_message)?;
    append_diagnostic_log(&app, "diagnostic_log_folder_opened", Value::Null);
    open::that(&dir).map_err(to_message)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn sync_purge_archived_tasks(
    app: AppHandle,
    older_than_days: u32,
) -> Result<ArchiveCleanupResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if older_than_days != 7 && older_than_days != 30 {
            return Err("Archive cleanup only supports 7 or 30 days".to_string());
        }
        let conn = open_app_database(&app)?;
        let cutoff = SystemTime::now()
            .checked_sub(Duration::from_secs(u64::from(older_than_days) * 86_400))
            .ok_or_else(|| "Could not calculate archive cleanup cutoff".to_string())?
            .duration_since(UNIX_EPOCH)
            .map_err(to_message)?
            .as_secs();
        let deleted_count = purge_archived_tasks_before(&conn, cutoff)?;
        conn.execute_batch("PRAGMA optimize; VACUUM;")
            .map_err(to_message)?;
        Ok(ArchiveCleanupResult {
            deleted_count,
            cutoff: cutoff.to_string(),
        })
    })
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
    let _sync_guard = SYNC_RUN_LOCK
        .lock()
        .map_err(|_| "Synchronization lock is unavailable".to_string())?;
    append_diagnostic_log(&app, "sync_started", Value::Null);
    let mut conn = open_app_database(&app)?;
    let state = app.state::<GoogleTasksState>();
    match run_full_sync(&app, &mut conn, &state) {
        Ok(()) => Ok(SyncResult {
            status: "ok".to_string(),
            message: "同步完成".to_string(),
            snapshot: read_cached_snapshot(&conn, false)?,
        }),
        Err(error) => {
            delete_meta(&conn, "activeSyncBatchMaxId")?;
            let status = classify_google_error(&error);
            append_diagnostic_log(
                &app,
                "sync_failed",
                json!({ "status": status, "error": error }),
            );
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
    append_diagnostic_log(
        &app,
        "task_mutation_received",
        json!({
            "operation": "create_task",
            "task_list_id": input.task_list_id,
            "task_title": input.title,
            "due": input.due,
        }),
    );
    let conn = open_app_database(&app)?;
    let transaction = conn.unchecked_transaction().map_err(to_message)?;
    let task = local_task_from_create(&input);
    upsert_task(&transaction, &task)?;
    enqueue_pending(
        &transaction,
        "create_task",
        Some(&task.id),
        &input.task_list_id,
        None,
        Some(&task.title),
        &serde_json::to_value(input.clone()).map_err(to_message)?,
    )?;
    transaction.commit().map_err(to_message)?;
    append_diagnostic_log(
        &app,
        "task_enqueued",
        json!({
            "operation": "create_task",
            "task_list_id": task.task_list_id,
            "task_id": task.id,
            "task_title": task.title,
        }),
    );
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
    let changed_fields = update_changed_fields(&input);
    append_diagnostic_log(
        &app,
        "task_mutation_received",
        json!({
            "operation": "update_task",
            "task_list_id": input.task_list_id,
            "task_id": input.task_id,
            "changed_fields": changed_fields,
            "due": input.due,
            "status": input.status,
        }),
    );
    let conn = open_app_database(&app)?;
    let transaction = conn.unchecked_transaction().map_err(to_message)?;
    let task = update_cached_task(&transaction, &input)?;
    enqueue_pending(
        &transaction,
        "update_task",
        None,
        &input.task_list_id,
        Some(&input.task_id),
        Some(&task.title),
        &serde_json::to_value(input.clone()).map_err(to_message)?,
    )?;
    transaction.commit().map_err(to_message)?;
    append_diagnostic_log(
        &app,
        "task_enqueued",
        json!({
            "operation": "update_task",
            "task_list_id": task.task_list_id,
            "task_id": task.id,
            "task_title": task.title,
            "changed_fields": changed_fields,
        }),
    );
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
    append_diagnostic_log(
        &app,
        "task_mutation_received",
        json!({
            "operation": "delete_task",
            "task_list_id": task_list_id,
            "task_id": task_id,
        }),
    );
    let conn = open_app_database(&app)?;
    let transaction = conn.unchecked_transaction().map_err(to_message)?;
    let task_title = read_task(&transaction, &task_id)?.map(|task| task.title);
    delete_cached_task(&transaction, &task_id)?;
    enqueue_pending(
        &transaction,
        "delete_task",
        None,
        &task_list_id,
        Some(&task_id),
        task_title.as_deref(),
        &Value::Null,
    )?;
    transaction.commit().map_err(to_message)?;
    append_diagnostic_log(
        &app,
        "task_enqueued",
        json!({
            "operation": "delete_task",
            "task_list_id": task_list_id,
            "task_id": task_id,
            "task_title": task_title,
        }),
    );
    Ok(())
}

#[tauri::command]
pub async fn sync_move_task(app: AppHandle, input: MoveTaskInput) -> Result<GoogleTaskDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        append_diagnostic_log(
            &app,
            "task_mutation_received",
            json!({
                "operation": "move_task",
                "task_list_id": input.task_list_id,
                "task_id": input.task_id,
            }),
        );
        let conn = open_app_database(&app)?;
        let transaction = conn.unchecked_transaction().map_err(to_message)?;
        let task = read_task(&transaction, &input.task_id)?
            .ok_or_else(|| "Local cached task not found for move".to_string())?;
        enqueue_pending(
            &transaction,
            "move_task",
            None,
            &input.task_list_id,
            Some(&input.task_id),
            Some(&task.title),
            &serde_json::to_value(input.clone()).map_err(to_message)?,
        )?;
        transaction.commit().map_err(to_message)?;
        append_diagnostic_log(
            &app,
            "task_enqueued",
            json!({
                "operation": "move_task",
                "task_list_id": input.task_list_id,
                "task_id": input.task_id,
                "task_title": task.title,
            }),
        );
        Ok(task)
    })
    .await
    .map_err(to_message)?
}
fn run_full_sync(
    app: &AppHandle,
    conn: &mut Connection,
    state: &State<GoogleTasksState>,
) -> Result<(), String> {
    let batch_max_sequence = max_pending_sequence(conn)?;
    if let Some(sequence) = batch_max_sequence {
        set_meta(conn, "activeSyncBatchMaxId", &sequence.to_string())?;
    } else {
        delete_meta(conn, "activeSyncBatchMaxId")?;
    }
    append_diagnostic_log(
        app,
        "sync_batch_started",
        json!({ "batch_max_sequence": batch_max_sequence }),
    );
    flush_pending_queue(app, conn, state, batch_max_sequence)?;
    let lists = retry_auth_once(state, || {
        google_tasks::google_task_lists(app.clone(), state.clone())
    })?;

    let mut remote_tasks = Vec::new();
    for list in &lists {
        let tasks = retry_auth_once(state, || {
            google_tasks::google_tasks(app.clone(), state.clone(), list.id.clone())
        })?;
        remote_tasks.extend(tasks);
    }
    replace_remote_snapshot(conn, &lists, &remote_tasks)?;
    set_meta(conn, "lastSyncedAt", &now_string())?;
    delete_meta(conn, "activeSyncBatchMaxId")?;
    append_diagnostic_log(
        app,
        "sync_completed",
        json!({
            "task_list_count": lists.len(),
            "task_count": remote_tasks.len(),
            "batch_max_sequence": batch_max_sequence,
        }),
    );
    Ok(())
}

fn flush_pending_queue(
    app: &AppHandle,
    conn: &Connection,
    state: &State<GoogleTasksState>,
    batch_max_sequence: Option<i64>,
) -> Result<(), String> {
    let pending = pending_items_through(conn, batch_max_sequence)?;
    let mut id_map: HashMap<String, String> = HashMap::new();

    for item in pending {
        let item_id = item.id;
        let mut retry_index = 0;

        loop {
            mark_pending_syncing(conn, item_id)?;
            append_diagnostic_log(
                app,
                "queue_item_syncing",
                json!({
                    "queue_id": item_id,
                    "operation": item.operation,
                    "task_list_id": item.task_list_id,
                    "task_id": item.task_id,
                    "attempt": retry_index + 1,
                }),
            );
            match process_pending_item(app, conn, state, item.clone(), &mut id_map) {
                Ok(()) => {
                    mark_pending_completed(conn, item_id)?;
                    append_diagnostic_log(
                        app,
                        "queue_item_completed",
                        json!({
                            "queue_id": item_id,
                            "operation": item.operation,
                            "task_id": item.task_id,
                            "attempts": retry_index + 1,
                        }),
                    );
                    break;
                }
                Err(error) => {
                    let status = classify_google_error(&error);
                    let retryable = matches!(status, "offline" | "error");
                    if !retryable || retry_index >= SYNC_RETRY_DELAYS_SECONDS.len() {
                        mark_pending_failed(conn, item_id, &error)?;
                        append_diagnostic_log(
                            app,
                            "queue_item_failed",
                            json!({
                                "queue_id": item_id,
                                "operation": item.operation,
                                "task_id": item.task_id,
                                "attempts": retry_index + 1,
                                "status": status,
                                "error": error,
                            }),
                        );
                        return Err(error);
                    }

                    append_diagnostic_log(
                        app,
                        "queue_item_retry_scheduled",
                        json!({
                            "queue_id": item_id,
                            "operation": item.operation,
                            "task_id": item.task_id,
                            "attempt": retry_index + 1,
                            "retry_in_seconds": SYNC_RETRY_DELAYS_SECONDS[retry_index],
                            "status": status,
                            "error": error,
                        }),
                    );
                    std::thread::sleep(Duration::from_secs(
                        SYNC_RETRY_DELAYS_SECONDS[retry_index],
                    ));
                    retry_index += 1;
                }
            }
        }
    }

    Ok(())
}

fn process_pending_item(
    app: &AppHandle,
    conn: &Connection,
    state: &State<GoogleTasksState>,
    item: PendingItem,
    id_map: &mut HashMap<String, String>,
) -> Result<(), String> {
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
        }
        "update_task" => {
            let mut input: UpdateTaskInput =
                serde_json::from_str(&item.payload_json).map_err(to_message)?;
            let local_task_id = input.task_id.clone();
            if let Some(remote_id) = id_map.get(&input.task_id).cloned() {
                input.task_id = remote_id;
            }
            let remote = retry_auth_once(state, || {
                google_tasks::google_update_task(app.clone(), state.clone(), input.clone())
            })?;
            if !has_newer_pending_for_task(conn, item.id, &local_task_id)? {
                upsert_task(conn, &remote)?;
            }
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
        }
        "move_task" => {
            let mut input: MoveTaskInput =
                serde_json::from_str(&item.payload_json).map_err(to_message)?;
            let local_task_id = input.task_id.clone();
            if let Some(remote_id) = id_map.get(&input.task_id).cloned() {
                input.task_id = remote_id;
            }
            let remote = retry_auth_once(state, || {
                google_tasks::google_move_task(app.clone(), state.clone(), input.clone())
            })?;
            if !has_newer_pending_for_task(conn, item.id, &local_task_id)? {
                upsert_task(conn, &remote)?;
            }
        }
        _ => {}
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

fn update_changed_fields(input: &UpdateTaskInput) -> Vec<&'static str> {
    let mut fields = Vec::new();
    if input.title.is_some() {
        fields.push("title");
    }
    if input.notes.is_some() {
        fields.push("notes");
    }
    if input.due.is_some() {
        fields.push("due");
    }
    if input.status.is_some() {
        fields.push("status");
    }
    fields
}

fn sanitize_diagnostic_value(value: Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .filter_map(|(key, value)| {
                    let normalized = key.to_ascii_lowercase();
                    let sensitive = ["note", "token", "secret", "credential", "authorization"]
                        .iter()
                        .any(|fragment| normalized.contains(fragment));
                    (!sensitive).then(|| (key, sanitize_diagnostic_value(value)))
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .map(sanitize_diagnostic_value)
                .collect(),
        ),
        Value::String(value) if value.len() > 2_000 => {
            Value::String(format!("{}…", value.chars().take(2_000).collect::<String>()))
        }
        value => value,
    }
}

fn append_diagnostic_log(app: &AppHandle, event: &str, details: Value) {
    let Ok(_guard) = DIAGNOSTIC_LOG_LOCK.lock() else {
        return;
    };
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }

    let path = dir.join(DIAGNOSTIC_LOG_FILE_NAME);
    let now = unix_now();
    let _ = prune_diagnostic_log(&path, now);
    let _ = fs::remove_file(dir.join(DIAGNOSTIC_LOG_ROTATED_FILE_NAME));

    let record = json!({
        "timestamp": now.to_string(),
        "event": event,
        "details": sanitize_diagnostic_value(details),
    });
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{record}");
    }
}

fn prune_diagnostic_log(path: &Path, now: u64) -> Result<(), std::io::Error> {
    if !path.exists() {
        return Ok(());
    }

    let cutoff = now.saturating_sub(DIAGNOSTIC_LOG_RETENTION_SECONDS);
    let mut first_line = String::new();
    BufReader::new(fs::File::open(path)?).read_line(&mut first_line)?;
    if diagnostic_timestamp(first_line.trim()).is_some_and(|timestamp| timestamp >= cutoff) {
        return Ok(());
    }

    let content = fs::read_to_string(path)?;
    let mut retained = String::new();
    for line in content.lines() {
        if diagnostic_timestamp(line).is_some_and(|timestamp| timestamp >= cutoff) {
            retained.push_str(line);
            retained.push('\n');
        }
    }
    fs::write(path, retained)
}

fn diagnostic_timestamp(line: &str) -> Option<u64> {
    let record = serde_json::from_str::<Value>(line).ok()?;
    let timestamp = record.get("timestamp")?;
    timestamp
        .as_str()
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| timestamp.as_u64())
}

fn open_app_database(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(to_message)?;
    open_database_at(&dir)
}

fn open_database_at(dir: &Path) -> Result<Connection, String> {
    fs::create_dir_all(dir).map_err(to_message)?;
    let conn = Connection::open(dir.join(DB_FILE_NAME)).map_err(to_message)?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(to_message)?;
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

        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pending_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          operation TEXT NOT NULL,
          local_id TEXT,
          task_list_id TEXT NOT NULL,
          task_id TEXT,
          task_title TEXT,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          sync_status TEXT NOT NULL DEFAULT 'waiting',
          synced_at TEXT
        );
        "#,
    )
    .map_err(to_message)?;

    let _ = conn.execute("ALTER TABLE tasks ADD COLUMN completed_at TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE pending_queue ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'waiting'",
        [],
    );
    let _ = conn.execute("ALTER TABLE pending_queue ADD COLUMN synced_at TEXT", []);
    let _ = conn.execute("ALTER TABLE pending_queue ADD COLUMN task_title TEXT", []);
    conn.execute(
        "UPDATE pending_queue
         SET task_title = (
           SELECT title FROM tasks
           WHERE tasks.id = COALESCE(pending_queue.task_id, pending_queue.local_id)
         )
         WHERE task_title IS NULL",
        [],
    )
    .map_err(to_message)?;
    Ok(())
}

fn read_cached_snapshot(conn: &Connection, offline: bool) -> Result<CachedSnapshot, String> {
    let task_lists = read_task_lists(conn)?;
    let tasks = read_tasks(conn)?;
    let last_synced_at = get_meta(conn, "lastSyncedAt")?;
    let pending_count = conn
        .query_row(
            "SELECT COUNT(*) FROM pending_queue WHERE sync_status <> 'completed'",
            [],
            |row| row.get(0),
        )
        .map_err(to_message)?;

    Ok(CachedSnapshot {
        task_lists,
        tasks,
        last_synced_at,
        pending_count,
        offline,
    })
}

fn read_sync_queue_snapshot(conn: &Connection) -> Result<SyncQueueSnapshot, String> {
    let count_status = |status: &str| -> Result<i64, String> {
        conn.query_row(
            "SELECT COUNT(*) FROM pending_queue WHERE sync_status = ?1",
            params![status],
            |row| row.get(0),
        )
        .map_err(to_message)
    };

    let mut stmt = conn
        .prepare(
            "SELECT id, operation, local_id, task_list_id, task_id, task_title, payload_json,
                    created_at, attempt_count, last_error, sync_status, synced_at
             FROM pending_queue
             ORDER BY
               CASE sync_status
                 WHEN 'syncing' THEN 0
                 WHEN 'waiting' THEN 1
                 WHEN 'failed' THEN 2
                 ELSE 3
               END,
               CASE WHEN sync_status = 'completed' THEN -id ELSE id END ASC
             LIMIT 250",
        )
        .map_err(to_message)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, Option<String>>(11)?,
            ))
        })
        .map_err(to_message)?;

    let mut waiting_position = 0usize;
    let mut items = Vec::new();
    for row in rows {
        let (
            id,
            operation,
            local_id,
            task_list_id,
            task_id,
            stored_task_title,
            payload_json,
            created_at,
            attempt_count,
            last_error,
            sync_status,
            synced_at,
        ) = row.map_err(to_message)?;
        let lookup_id = task_id.as_deref().or(local_id.as_deref());
        let cached_title = lookup_id
            .map(|id| {
                conn.query_row(
                    "SELECT title FROM tasks WHERE id = ?1",
                    params![id],
                    |task_row| task_row.get::<_, String>(0),
                )
                .optional()
                .map_err(to_message)
            })
            .transpose()?
            .flatten();
        let payload_title = serde_json::from_str::<Value>(&payload_json)
            .ok()
            .and_then(|value| value.get("title").and_then(Value::as_str).map(str::to_string));
        let task_title = stored_task_title
            .filter(|title| !title.trim().is_empty())
            .or(payload_title)
            .or(cached_title)
            .unwrap_or_else(|| operation.clone());
        let queue_position = if sync_status == "waiting" {
            waiting_position += 1;
            Some(waiting_position)
        } else {
            None
        };
        items.push(SyncQueueItem {
            id,
            operation,
            task_title,
            task_list_id,
            task_id: task_id.or(local_id),
            sync_status,
            created_at,
            synced_at,
            attempt_count,
            last_error,
            queue_position,
        });
    }

    Ok(SyncQueueSnapshot {
        items,
        waiting_count: count_status("waiting")?,
        syncing_count: count_status("syncing")?,
        completed_count: count_status("completed")?,
        failed_count: count_status("failed")?,
    })
}

fn purge_archived_tasks_before(conn: &Connection, cutoff: u64) -> Result<usize, String> {
    let previous_cutoff = get_meta(conn, "archivePurgedBefore")?
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let effective_cutoff = previous_cutoff.max(cutoff);
    set_meta(conn, "archivePurgedBefore", &effective_cutoff.to_string())?;
    conn.execute(
        "DELETE FROM tasks
         WHERE completed = 1
           AND completed_at IS NOT NULL
           AND CASE
             WHEN completed_at NOT GLOB '*[^0-9]*' THEN CAST(completed_at AS INTEGER)
             ELSE CAST(strftime('%s', completed_at) AS INTEGER)
           END <= ?1",
        params![effective_cutoff],
    )
    .map_err(to_message)
}

fn read_app_settings(conn: &Connection) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM app_settings")
        .map_err(to_message)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(to_message)?;
    rows.collect::<Result<HashMap<_, _>, _>>()
        .map_err(to_message)
}

fn set_app_setting(conn: &Connection, key: &str, value: Option<&str>) -> Result<(), String> {
    if let Some(value) = value {
        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at",
            params![key, value, now_string()],
        )
        .map_err(to_message)?;
    } else {
        conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])
            .map_err(to_message)?;
    }
    Ok(())
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

fn replace_remote_snapshot(
    conn: &mut Connection,
    lists: &[GoogleTaskListDto],
    remote_tasks: &[GoogleTaskDto],
) -> Result<(), String> {
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(to_message)?;
    let dirty_task_ids = pending_dirty_task_ids(&transaction)?;
    let remote_task_ids = remote_tasks
        .iter()
        .map(|task| task.id.as_str())
        .collect::<HashSet<_>>();

    replace_task_lists(&transaction, lists)?;
    for task in remote_tasks {
        if !dirty_task_ids.contains(&task.id) {
            upsert_task(&transaction, task)?;
        }
    }

    for cached_task in read_tasks(&transaction)? {
        if !cached_task.id.starts_with("local-")
            && !remote_task_ids.contains(cached_task.id.as_str())
            && !dirty_task_ids.contains(&cached_task.id)
        {
            delete_cached_task(&transaction, &cached_task.id)?;
        }
    }

    transaction.commit().map_err(to_message)
}

fn pending_dirty_task_ids(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT task_id, local_id
             FROM pending_queue
             WHERE sync_status <> 'completed'",
        )
        .map_err(to_message)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        })
        .map_err(to_message)?;
    let mut ids = HashSet::new();
    for row in rows {
        let (task_id, local_id) = row.map_err(to_message)?;
        ids.extend(task_id);
        ids.extend(local_id);
    }
    Ok(ids)
}

fn has_newer_pending_for_task(
    conn: &Connection,
    current_queue_id: i64,
    task_id: &str,
) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM pending_queue
           WHERE id > ?1
             AND sync_status <> 'completed'
             AND (task_id = ?2 OR local_id = ?2)
         )",
        params![current_queue_id, task_id],
        |row| row.get(0),
    )
    .map_err(to_message)
}

fn upsert_task(conn: &Connection, task: &GoogleTaskDto) -> Result<(), String> {
    if task.completed {
        if let (Some(completed_at), Some(cutoff)) = (
            task.completed_at.as_deref(),
            get_meta(conn, "archivePurgedBefore")?.and_then(|value| value.parse::<u64>().ok()),
        ) {
            let completed_epoch = conn
                .query_row(
                    "SELECT CASE
                       WHEN ?1 NOT GLOB '*[^0-9]*' THEN CAST(?1 AS INTEGER)
                       ELSE CAST(strftime('%s', ?1) AS INTEGER)
                     END",
                    params![completed_at],
                    |row| row.get::<_, Option<u64>>(0),
                )
                .map_err(to_message)?;
            if completed_epoch.is_some_and(|value| value <= cutoff) {
                delete_cached_task(conn, &task.id)?;
                return Ok(());
            }
        }
    }
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
    task_title: Option<&str>,
    payload: &Value,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO pending_queue
         (operation, local_id, task_list_id, task_id, task_title, payload_json, created_at, attempt_count, sync_status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 'waiting')",
        params![
            operation,
            local_id,
            task_list_id,
            task_id,
            task_title,
            payload.to_string(),
            now_string()
        ],
    )
    .map_err(to_message)?;
    Ok(())
}

fn max_pending_sequence(conn: &Connection) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT MAX(id) FROM pending_queue WHERE sync_status <> 'completed'",
        [],
        |row| row.get(0),
    )
    .map_err(to_message)
}

fn pending_items_through(
    conn: &Connection,
    batch_max_sequence: Option<i64>,
) -> Result<Vec<PendingItem>, String> {
    let Some(batch_max_sequence) = batch_max_sequence else {
        return Ok(Vec::new());
    };
    let mut stmt = conn
        .prepare(
            "SELECT id, operation, local_id, task_list_id, task_id, payload_json, sync_status
             FROM pending_queue
             WHERE sync_status <> 'completed' AND id <= ?1
             ORDER BY id ASC",
        )
        .map_err(to_message)?;
    let rows = stmt
        .query_map(params![batch_max_sequence], |row| {
            Ok(PendingItem {
                id: row.get(0)?,
                operation: row.get(1)?,
                local_id: row.get(2)?,
                task_list_id: row.get(3)?,
                task_id: row.get(4)?,
                payload_json: row.get(5)?,
                sync_status: row.get(6)?,
            })
        })
        .map_err(to_message)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(to_message)
}

fn mark_pending_syncing(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE pending_queue
         SET sync_status = 'syncing', attempt_count = attempt_count + 1, last_error = NULL
         WHERE id = ?1",
        params![id],
    )
    .map_err(to_message)?;
    Ok(())
}

fn mark_pending_completed(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE pending_queue
         SET sync_status = 'completed', synced_at = ?2, last_error = NULL
         WHERE id = ?1",
        params![id, now_string()],
    )
    .map_err(to_message)?;
    Ok(())
}

fn mark_pending_failed(conn: &Connection, id: i64, error: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE pending_queue
         SET sync_status = 'failed', last_error = ?2
         WHERE id = ?1",
        params![id, error],
    )
    .map_err(to_message)?;
    Ok(())
}

#[cfg(test)]
fn pending_statuses(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT sync_status FROM pending_queue ORDER BY id ASC")
        .map_err(to_message)?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(to_message)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(to_message)
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

fn delete_meta(conn: &Connection, key: &str) -> Result<(), String> {
    conn.execute("DELETE FROM sync_meta WHERE key = ?1", params![key])
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
    unix_now().to_string()
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
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
    fn diagnostic_details_remove_sensitive_values() {
        let sanitized = sanitize_diagnostic_value(json!({
            "task_id": "task-1",
            "notes": "private task note",
            "access_token": "secret-token",
            "nested": { "credential": "secret", "due": "2026-08-12" }
        }));
        assert_eq!(sanitized["task_id"], "task-1");
        assert_eq!(sanitized["nested"]["due"], "2026-08-12");
        assert!(sanitized.get("notes").is_none());
        assert!(sanitized.get("access_token").is_none());
        assert!(sanitized["nested"].get("credential").is_none());
    }

    #[test]
    fn migrate_creates_cache_tables() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");
        let conn = open_database_at(temp_dir.path()).expect("打开测试数据库失败");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('task_lists', 'tasks', 'sync_meta', 'app_settings', 'pending_queue')",
                [],
                |row| row.get(0),
            )
            .expect("读取表数量失败");
        assert_eq!(count, 5);
    }

    #[test]
    fn app_settings_round_trip() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let conn = open_database_at(temp_dir.path()).expect("open test database");

        set_app_setting(&conn, "googleTodoListColors", Some(r#"{"list":2}"#))
            .expect("write setting");
        let settings = read_app_settings(&conn).expect("read settings");
        assert_eq!(
            settings.get("googleTodoListColors").map(String::as_str),
            Some(r#"{"list":2}"#),
        );

        set_app_setting(&conn, "googleTodoListColors", None).expect("delete setting");
        let settings = read_app_settings(&conn).expect("read settings");
        assert!(!settings.contains_key("googleTodoListColors"));
    }

    #[test]
    fn diagnostic_log_keeps_only_the_last_three_days() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let path = temp_dir.path().join(DIAGNOSTIC_LOG_FILE_NAME);
        let now = 1_800_000_000;
        fs::write(
            &path,
            format!(
                "{}\n{}\n",
                json!({ "timestamp": (now - DIAGNOSTIC_LOG_RETENTION_SECONDS - 1).to_string(), "event": "old" }),
                json!({ "timestamp": (now - DIAGNOSTIC_LOG_RETENTION_SECONDS + 1).to_string(), "event": "recent" }),
            ),
        )
        .expect("write diagnostic log");

        prune_diagnostic_log(&path, now).expect("prune diagnostic log");

        let retained = fs::read_to_string(path).expect("read diagnostic log");
        assert!(!retained.contains("\"old\""));
        assert!(retained.contains("\"recent\""));
    }

    #[test]
    fn pending_items_stop_at_the_batch_watermark() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let conn = open_database_at(temp_dir.path()).expect("open test database");
        for task_id in ["task-1", "task-2", "task-3"] {
            enqueue_pending(
                &conn,
                "delete_task",
                None,
                "list-1",
                Some(task_id),
                Some(task_id),
                &Value::Null,
            )
            .expect("enqueue task");
        }

        assert_eq!(max_pending_sequence(&conn).expect("read watermark"), Some(3));
        let batch = pending_items_through(&conn, Some(2)).expect("read batch");
        assert_eq!(batch.iter().map(|item| item.id).collect::<Vec<_>>(), vec![1, 2]);
    }

    #[test]
    fn remote_snapshot_preserves_tasks_with_pending_local_changes() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let mut conn = open_database_at(temp_dir.path()).expect("open test database");
        let local_task = GoogleTaskDto {
            id: "task-1".to_string(),
            task_list_id: "list-1".to_string(),
            title: "Locally edited task".to_string(),
            notes: None,
            due: Some("2026-08-20T00:00:00.000Z".to_string()),
            status: "needsAction".to_string(),
            parent: None,
            position: None,
            completed: false,
            completed_at: None,
        };
        upsert_task(&conn, &local_task).expect("cache local task");
        enqueue_pending(
            &conn,
            "update_task",
            None,
            "list-1",
            Some("task-1"),
            Some("Locally edited task"),
            &json!({
                "task_list_id": "list-1",
                "task_id": "task-1",
                "due": "2026-08-20T00:00:00.000Z"
            }),
        )
        .expect("enqueue local update");
        let remote_task = GoogleTaskDto {
            title: "Stale remote task".to_string(),
            due: Some("2026-08-01T00:00:00.000Z".to_string()),
            ..local_task.clone()
        };
        let lists = vec![GoogleTaskListDto {
            id: "list-1".to_string(),
            title: "Tasks".to_string(),
        }];

        replace_remote_snapshot(&mut conn, &lists, &[remote_task])
            .expect("replace remote snapshot");

        let preserved = read_task(&conn, "task-1")
            .expect("read preserved task")
            .expect("task remains cached");
        assert_eq!(preserved.title, "Locally edited task");
        assert_eq!(preserved.due.as_deref(), Some("2026-08-20T00:00:00.000Z"));
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
            Some("Task 1"),
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
    fn pending_queue_records_sync_status_and_counts_only_unfinished_items() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let conn = open_database_at(temp_dir.path()).expect("open test database");

        enqueue_pending(
            &conn,
            "delete_task",
            None,
            "list-1",
            Some("task-1"),
            Some("Task 1"),
            &Value::Null,
        )
        .expect("enqueue first item");
        enqueue_pending(
            &conn,
            "delete_task",
            None,
            "list-1",
            Some("task-2"),
            Some("Task 2"),
            &Value::Null,
        )
        .expect("enqueue second item");

        let statuses = pending_statuses(&conn).expect("read statuses");
        assert_eq!(statuses, vec!["waiting".to_string(), "waiting".to_string()]);

        mark_pending_syncing(&conn, 1).expect("mark syncing");
        mark_pending_completed(&conn, 1).expect("mark completed");

        let statuses = pending_statuses(&conn).expect("read statuses");
        assert_eq!(
            statuses,
            vec!["completed".to_string(), "waiting".to_string()]
        );

        let snapshot = read_cached_snapshot(&conn, false).expect("read snapshot");
        assert_eq!(snapshot.pending_count, 1);
    }

    #[test]
    fn purge_archived_tasks_removes_old_rows_and_prevents_reimport() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let conn = open_database_at(temp_dir.path()).expect("open test database");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("current unix time")
            .as_secs();
        let old_completed_at = (now - 8 * 86_400).to_string();
        let recent_completed_at = (now - 2 * 86_400).to_string();
        let old_task = GoogleTaskDto {
            id: "old-task".to_string(),
            task_list_id: "list-1".to_string(),
            title: "Old completed task".to_string(),
            notes: None,
            due: None,
            status: "completed".to_string(),
            parent: None,
            position: None,
            completed: true,
            completed_at: Some(old_completed_at),
        };
        let recent_task = GoogleTaskDto {
            id: "recent-task".to_string(),
            completed_at: Some(recent_completed_at),
            ..old_task.clone()
        };
        upsert_task(&conn, &old_task).expect("insert old task");
        upsert_task(&conn, &recent_task).expect("insert recent task");

        let deleted = purge_archived_tasks_before(&conn, now - 7 * 86_400).expect("purge archive");
        assert_eq!(deleted, 1);
        assert_eq!(read_tasks(&conn).expect("read remaining tasks").len(), 1);

        upsert_task(&conn, &old_task).expect("attempt reimport");
        let remaining = read_tasks(&conn).expect("read filtered tasks");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "recent-task");
    }

    #[test]
    fn sync_queue_snapshot_reports_waiting_and_completed_items() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let conn = open_database_at(temp_dir.path()).expect("open test database");
        enqueue_pending(
            &conn,
            "create_task",
            Some("local-1"),
            "list-1",
            None,
            Some("Queued task"),
            &serde_json::json!({ "due": "2026-08-08T00:00:00.000Z" }),
        )
        .expect("enqueue waiting item");
        enqueue_pending(
            &conn,
            "delete_task",
            None,
            "list-1",
            Some("task-2"),
            Some("Task 2"),
            &Value::Null,
        )
        .expect("enqueue completed item");
        mark_pending_syncing(&conn, 2).expect("mark syncing");
        mark_pending_completed(&conn, 2).expect("mark completed");

        let snapshot = read_sync_queue_snapshot(&conn).expect("read sync queue");
        assert_eq!(snapshot.waiting_count, 1);
        assert_eq!(snapshot.completed_count, 1);
        assert_eq!(snapshot.items[0].task_title, "Queued task");
        assert_eq!(snapshot.items[0].queue_position, Some(1));
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
