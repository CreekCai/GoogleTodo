use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use keyring::Entry;
use rand::{distributions::Alphanumeric, Rng};
use reqwest::{
    blocking::{Client, RequestBuilder},
    Proxy,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use url::Url;

const TASKS_SCOPE: &str =
    "https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events openid email profile";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const TASKS_API_BASE: &str = "https://tasks.googleapis.com/tasks/v1";
const CALENDAR_API_BASE: &str = "https://www.googleapis.com/calendar/v3";
const KEYRING_SERVICE: &str = "GoogleTodo";
const KEYRING_REFRESH_TOKEN_USER: &str = "google_tasks_refresh_token";
const KEYRING_CLIENT_ID_USER: &str = "google_tasks_client_id";
const KEYRING_CLIENT_SECRET_USER: &str = "google_tasks_client_secret";
const KEYRING_PROXY_CONFIG_USER: &str = "google_tasks_proxy_config";
const KEYRING_USER_PROFILE_USER: &str = "google_tasks_user_profile";
const AUTH_CACHE_FILE: &str = "google_auth_state.json";
const BUILTIN_GOOGLE_CLIENT_ID: Option<&str> = option_env!("GOOGLE_TASKS_CLIENT_ID");
const BUILTIN_GOOGLE_CLIENT_SECRET: Option<&str> = option_env!("GOOGLE_TASKS_CLIENT_SECRET");

pub struct GoogleTasksState {
    auth: Mutex<AuthCache>,
}

struct AuthCache {
    access_token: Option<String>,
    expires_at: Option<Instant>,
}

impl Default for GoogleTasksState {
    fn default() -> Self {
        Self {
            auth: Mutex::new(AuthCache {
                access_token: None,
                expires_at: None,
            }),
        }
    }
}

impl GoogleTasksState {
    pub fn clear_access_cache(&self) -> Result<(), String> {
        let mut auth = self.auth.lock().map_err(to_message)?;
        auth.access_token = None;
        auth.expires_at = None;
        Ok(())
    }
}

#[derive(Debug, Serialize)]
pub struct AuthStatus {
    pub configured: bool,
    pub signed_in: bool,
    pub user_hint: Option<String>,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
    pub user_picture: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleProxyConfig {
    pub mode: String,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleTaskListDto {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleTaskDto {
    pub id: String,
    pub task_list_id: String,
    pub title: String,
    pub notes: Option<String>,
    pub due: Option<String>,
    pub status: String,
    pub parent: Option<String>,
    pub position: Option<String>,
    pub completed: bool,
    pub completed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleCalendarEventDto {
    pub id: String,
    pub calendar_id: String,
    pub calendar_name: String,
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start: String,
    pub end: Option<String>,
    pub all_day: bool,
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleCalendarListDto {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub selected: bool,
    pub primary: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateCalendarEventInput {
    pub calendar_id: String,
    pub event_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub date: Option<String>,
    pub time: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateTaskInput {
    pub task_list_id: String,
    pub title: String,
    pub notes: Option<String>,
    pub due: Option<String>,
    pub parent: Option<String>,
    pub previous: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateTaskInput {
    pub task_list_id: String,
    pub task_id: String,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub due: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MoveTaskInput {
    pub task_list_id: String,
    pub task_id: String,
    pub parent: Option<String>,
    pub previous: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
    id_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StoredUserProfile {
    name: Option<String>,
    email: Option<String>,
    picture: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct StoredAuthState {
    refresh_token: Option<String>,
    profile: Option<StoredUserProfile>,
}

#[derive(Debug, Deserialize)]
struct GoogleUserInfo {
    name: Option<String>,
    email: Option<String>,
    picture: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleIdTokenClaims {
    name: Option<String>,
    email: Option<String>,
    picture: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TaskListsResponse {
    items: Option<Vec<GoogleTaskListItem>>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleTaskListItem {
    id: String,
    title: String,
}

#[derive(Debug, Deserialize)]
struct TasksResponse {
    items: Option<Vec<GoogleTaskItem>>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct GoogleTaskItem {
    id: String,
    title: Option<String>,
    notes: Option<String>,
    due: Option<String>,
    status: Option<String>,
    parent: Option<String>,
    position: Option<String>,
    completed: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CalendarListResponse {
    items: Option<Vec<GoogleCalendarListItem>>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct GoogleCalendarListItem {
    id: String,
    summary: Option<String>,
    #[serde(rename = "summaryOverride")]
    summary_override: Option<String>,
    #[serde(rename = "backgroundColor")]
    background_color: Option<String>,
    hidden: Option<bool>,
    selected: Option<bool>,
    primary: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct CalendarEventsResponse {
    items: Option<Vec<GoogleCalendarEventItem>>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleCalendarEventItem {
    id: String,
    summary: Option<String>,
    description: Option<String>,
    location: Option<String>,
    status: Option<String>,
    start: Option<GoogleCalendarDateTime>,
    end: Option<GoogleCalendarDateTime>,
}

#[derive(Debug, Deserialize)]
struct GoogleCalendarDateTime {
    date: Option<String>,
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
}

#[tauri::command]
pub fn google_auth_status(app: AppHandle) -> Result<AuthStatus, String> {
    let profile = read_user_profile(&app);
    let signed_in = read_refresh_token(&app).is_ok();
    Ok(AuthStatus {
        configured: client_id().is_ok() && client_secret().is_ok(),
        signed_in,
        user_hint: profile.as_ref().and_then(|value| value.email.clone()),
        user_name: profile.as_ref().and_then(|value| value.name.clone()),
        user_email: profile.as_ref().and_then(|value| value.email.clone()),
        user_picture: profile.and_then(|value| value.picture),
    })
}

#[tauri::command]
pub fn google_proxy_config() -> Result<GoogleProxyConfig, String> {
    Ok(read_proxy_config())
}

#[tauri::command]
pub fn google_save_proxy_config(
    state: State<GoogleTasksState>,
    config: GoogleProxyConfig,
) -> Result<GoogleProxyConfig, String> {
    let normalized = normalize_proxy_config(config)?;
    proxy_config_entry()?
        .set_password(&serde_json::to_string(&normalized).map_err(to_message)?)
        .map_err(to_message)?;

    let mut auth = state.auth.lock().map_err(to_message)?;
    auth.access_token = None;
    auth.expires_at = None;
    Ok(normalized)
}

#[tauri::command]
pub fn google_save_client_id(app: AppHandle, client_id: String) -> Result<AuthStatus, String> {
    save_valid_client_id(&client_id)?;
    google_auth_status(app)
}

#[tauri::command]
pub fn google_save_client_credentials(
    app: AppHandle,
    client_id: String,
    client_secret: String,
) -> Result<AuthStatus, String> {
    save_valid_client_id(&client_id)?;
    save_valid_client_secret(&client_secret)?;
    google_auth_status(app)
}

#[tauri::command]
pub fn google_oauth_login(
    app: AppHandle,
    state: State<GoogleTasksState>,
    client_id_override: Option<String>,
    client_secret_override: Option<String>,
) -> Result<AuthStatus, String> {
    let client_id = match client_id_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => {
            save_valid_client_id(value)?;
            value.to_string()
        }
        None => client_id()?,
    };
    let client_secret = match client_secret_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => {
            save_valid_client_secret(value)?;
            value.to_string()
        }
        None => client_secret()?,
    };
    let verifier = random_string(64);
    let challenge = pkce_challenge(&verifier);
    let oauth_state = random_string(32);
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(to_message)?;
    let port = listener.local_addr().map_err(to_message)?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/");

    let mut auth_url = Url::parse(AUTH_URL).map_err(to_message)?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", TASKS_SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", &oauth_state);

    open::that(auth_url.as_str()).map_err(to_message)?;
    let code = wait_for_oauth_code(listener, &oauth_state)?;
    let client = http_client()?;
    let token = exchange_code_for_token(
        &client,
        &client_id,
        &client_secret,
        &redirect_uri,
        &code,
        &verifier,
    )?;

    if let Some(refresh_token) = token.refresh_token.as_deref() {
        save_refresh_token(&app, refresh_token)?;
    }

    let id_token_profile = token.id_token.as_deref().and_then(profile_from_id_token);
    let access_token = token.access_token;
    let profile = match fetch_user_profile(&client, &access_token) {
        Ok(user_info_profile) => Some(StoredUserProfile {
            name: user_info_profile.name.or_else(|| {
                id_token_profile
                    .as_ref()
                    .and_then(|profile| profile.name.clone())
            }),
            email: user_info_profile.email.or_else(|| {
                id_token_profile
                    .as_ref()
                    .and_then(|profile| profile.email.clone())
            }),
            picture: user_info_profile.picture.or_else(|| {
                id_token_profile
                    .as_ref()
                    .and_then(|profile| profile.picture.clone())
            }),
        }),
        Err(_) => id_token_profile,
    };

    let login_profile = profile.clone();
    if let Some(profile) = profile {
        let _ = save_user_profile(&app, &profile);
    }
    update_access_cache(&state, access_token, token.expires_in)?;
    let stored_profile = read_user_profile(&app);
    let profile = login_profile.or(stored_profile);
    Ok(AuthStatus {
        configured: true,
        signed_in: true,
        user_hint: profile.as_ref().and_then(|value| value.email.clone()),
        user_name: profile.as_ref().and_then(|value| value.name.clone()),
        user_email: profile.as_ref().and_then(|value| value.email.clone()),
        user_picture: profile.and_then(|value| value.picture),
    })
}

#[tauri::command]
pub fn google_sign_out(
    app: AppHandle,
    state: State<GoogleTasksState>,
) -> Result<AuthStatus, String> {
    clear_google_auth(&app, &state, true)?;
    google_auth_status(app)
}

#[tauri::command]
pub fn google_forget_invalid_auth(
    app: AppHandle,
    state: State<GoogleTasksState>,
) -> Result<AuthStatus, String> {
    clear_google_auth(&app, &state, true)?;
    google_auth_status(app)
}

#[tauri::command]
pub fn google_task_lists(
    app: AppHandle,
    state: State<GoogleTasksState>,
) -> Result<Vec<GoogleTaskListDto>, String> {
    let token = access_token(&app, &state)?;
    let client = http_client()?;
    let mut page_token: Option<String> = None;
    let mut lists = Vec::new();

    loop {
        let mut request = client
            .get(format!("{TASKS_API_BASE}/users/@me/lists"))
            .bearer_auth(&token)
            .query(&[("maxResults", "1000")]);

        if let Some(next_page_token) = page_token.as_deref() {
            request = request.query(&[("pageToken", next_page_token)]);
        }

        let response: TaskListsResponse = send_json(request, "获取 Google 任务列表失败")?;
        lists.extend(response.items.unwrap_or_default().into_iter().map(|item| {
            GoogleTaskListDto {
                id: item.id,
                title: item.title,
            }
        }));

        page_token = response.next_page_token;
        if page_token.is_none() {
            break;
        }
    }

    Ok(lists)
}

#[tauri::command]
pub fn google_tasks(
    app: AppHandle,
    state: State<GoogleTasksState>,
    task_list_id: String,
) -> Result<Vec<GoogleTaskDto>, String> {
    let token = access_token(&app, &state)?;
    let client = http_client()?;
    let mut page_token: Option<String> = None;
    let mut tasks = Vec::new();

    loop {
        let url = format!(
            "{TASKS_API_BASE}/lists/{}/tasks",
            encode_path_segment(&task_list_id)
        );
        let mut request = client.get(url).bearer_auth(&token).query(&[
            ("showCompleted", "true"),
            ("showHidden", "true"),
            ("maxResults", "100"),
        ]);

        if let Some(next_page_token) = page_token.as_deref() {
            request = request.query(&[("pageToken", next_page_token)]);
        }

        let response: TasksResponse = send_json(request, "获取 Google 任务失败")?;
        tasks.extend(
            response
                .items
                .unwrap_or_default()
                .into_iter()
                .map(|task| map_task(task, &task_list_id)),
        );

        page_token = response.next_page_token;
        if page_token.is_none() {
            break;
        }
    }

    Ok(tasks)
}

#[tauri::command]
pub async fn google_calendar_events(
    app: AppHandle,
    month: String,
    calendar_ids: Option<Vec<String>>,
) -> Result<Vec<GoogleCalendarEventDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<GoogleTasksState>();
        google_calendar_events_blocking(app.clone(), state, month, calendar_ids)
    })
    .await
    .map_err(to_message)?
}

pub fn google_calendar_events_blocking(
    app: AppHandle,
    state: State<GoogleTasksState>,
    month: String,
    calendar_ids: Option<Vec<String>>,
) -> Result<Vec<GoogleCalendarEventDto>, String> {
    let token = access_token(&app, &state)?;
    let client = http_client()?;
    let (time_min, time_max) = month_bounds(&month)?;
    let calendars = fetch_calendar_list(&client, &token)?;
    let mut events = Vec::new();
    let requested_calendar_ids = calendar_ids.as_ref();

    if requested_calendar_ids.is_some_and(|ids| ids.is_empty()) {
        return Ok(events);
    }

    for calendar in calendars {
        let include_calendar = match requested_calendar_ids {
            Some(ids) => ids.iter().any(|id| id == &calendar.id),
            None => !calendar.hidden.unwrap_or(false) && calendar.selected != Some(false),
        };

        if !include_calendar {
            continue;
        }

        let calendar_name = calendar
            .summary_override
            .clone()
            .or(calendar.summary.clone())
            .unwrap_or_else(|| "Google Calendar".to_string());
        let calendar_color = calendar.background_color.clone();
        let mut page_token: Option<String> = None;

        loop {
            let url = format!(
                "{CALENDAR_API_BASE}/calendars/{}/events",
                encode_path_segment(&calendar.id)
            );
            let mut request = client.get(&url).bearer_auth(&token).query(&[
                ("singleEvents", "true"),
                ("orderBy", "startTime"),
                ("showDeleted", "false"),
                ("maxResults", "250"),
                ("timeMin", time_min.as_str()),
                ("timeMax", time_max.as_str()),
            ]);

            if let Some(next_page_token) = page_token.as_deref() {
                request = request.query(&[("pageToken", next_page_token)]);
            }

            let response: CalendarEventsResponse =
                send_json(request, "获取 Google Calendar 日程失败")?;

            for event in response.items.unwrap_or_default() {
                if event.status.as_deref() == Some("cancelled") {
                    continue;
                }
                if let Some(mapped) = map_calendar_event(
                    event,
                    &calendar.id,
                    &calendar_name,
                    calendar_color.as_deref(),
                ) {
                    events.push(mapped);
                }
            }

            page_token = response.next_page_token;
            if page_token.is_none() {
                break;
            }
        }
    }

    events.sort_by(|first, second| {
        first
            .start
            .cmp(&second.start)
            .then_with(|| first.title.cmp(&second.title))
    });

    Ok(events)
}

#[tauri::command]
pub async fn google_calendar_lists(
    app: AppHandle,
) -> Result<Vec<GoogleCalendarListDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<GoogleTasksState>();
        google_calendar_lists_blocking(app.clone(), state)
    })
    .await
    .map_err(to_message)?
}

pub fn google_calendar_lists_blocking(
    app: AppHandle,
    state: State<GoogleTasksState>,
) -> Result<Vec<GoogleCalendarListDto>, String> {
    let token = access_token(&app, &state)?;
    let client = http_client()?;
    let calendars = fetch_calendar_list(&client, &token)?;

    Ok(calendars
        .into_iter()
        .filter(|calendar| !calendar.hidden.unwrap_or(false))
        .map(|calendar| {
            let name = calendar
                .summary_override
                .clone()
                .or(calendar.summary.clone())
                .unwrap_or_else(|| "Google Calendar".to_string());

            GoogleCalendarListDto {
                id: calendar.id,
                name,
                color: calendar.background_color,
                selected: calendar.selected != Some(false),
                primary: calendar.primary.unwrap_or(false),
            }
        })
        .collect())
}

#[tauri::command]
pub async fn google_update_calendar_event(
    app: AppHandle,
    input: UpdateCalendarEventInput,
) -> Result<GoogleCalendarEventDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<GoogleTasksState>();
        google_update_calendar_event_blocking(app.clone(), state, input)
    })
    .await
    .map_err(to_message)?
}

pub fn google_update_calendar_event_blocking(
    app: AppHandle,
    state: State<GoogleTasksState>,
    input: UpdateCalendarEventInput,
) -> Result<GoogleCalendarEventDto, String> {
    let token = access_token(&app, &state)?;
    let client = http_client()?;
    let url = calendar_event_url(&input.calendar_id, &input.event_id);
    let mut body: Value = get_json(&client, &url, &token, "读取 Google Calendar 日程失败")?;

    if let Some(title) = input.title {
        body["summary"] = json!(title);
    }
    if let Some(description) = input.description {
        body["description"] = json!(description);
    }

    if input.date.is_some() || input.time.is_some() {
        apply_calendar_event_time(&mut body, input.date.as_deref(), input.time.as_deref())?;
    }

    let updated: GoogleCalendarEventItem = send_json(
        client.put(url).bearer_auth(&token).json(&body),
        "更新 Google Calendar 日程失败",
    )?;

    let calendar_name = body
        .get("organizer")
        .and_then(|organizer| organizer.get("displayName"))
        .and_then(Value::as_str)
        .unwrap_or("Google Calendar");

    map_calendar_event(updated, &input.calendar_id, calendar_name, None)
        .ok_or_else(|| "Google Calendar 日程更新成功，但响应缺少开始时间".to_string())
}

#[tauri::command]
pub async fn google_delete_calendar_event(
    app: AppHandle,
    calendar_id: String,
    event_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<GoogleTasksState>();
        google_delete_calendar_event_blocking(app.clone(), state, calendar_id, event_id)
    })
    .await
    .map_err(to_message)?
}

pub fn google_delete_calendar_event_blocking(
    app: AppHandle,
    state: State<GoogleTasksState>,
    calendar_id: String,
    event_id: String,
) -> Result<(), String> {
    let token = access_token(&app, &state)?;
    let client = http_client()?;
    send_empty(
        client
            .delete(calendar_event_url(&calendar_id, &event_id))
            .bearer_auth(token),
        "删除 Google Calendar 日程失败",
    )
}

#[tauri::command]
pub fn google_create_task(
    app: AppHandle,
    state: State<GoogleTasksState>,
    input: CreateTaskInput,
) -> Result<GoogleTaskDto, String> {
    let token = access_token(&app, &state)?;
    let client = http_client()?;
    let url = format!(
        "{TASKS_API_BASE}/lists/{}/tasks",
        encode_path_segment(&input.task_list_id)
    );
    let mut body = json!({ "title": input.title });

    if let Some(notes) = input.notes {
        body["notes"] = json!(notes);
    }
    if let Some(due) = normalize_due(input.due.as_deref()) {
        body["due"] = json!(due);
    }

    let mut query = Vec::new();
    if let Some(parent) = input.parent.as_deref().filter(|value| !value.is_empty()) {
        query.push(("parent", parent.to_string()));
    }
    if let Some(previous) = input.previous.as_deref().filter(|value| !value.is_empty()) {
        query.push(("previous", previous.to_string()));
    }

    let task: GoogleTaskItem = send_json(
        client
            .post(url)
            .bearer_auth(&token)
            .query(&query)
            .json(&body),
        "新增 Google 任务失败",
    )?;

    Ok(map_task(task, &input.task_list_id))
}

#[tauri::command]
pub fn google_update_task(
    app: AppHandle,
    state: State<GoogleTasksState>,
    input: UpdateTaskInput,
) -> Result<GoogleTaskDto, String> {
    let token = access_token(&app, &state)?;
    let client = http_client()?;
    let url = task_url(&input.task_list_id, &input.task_id);
    let current: Value = get_json(&client, &url, &token, "读取 Google 任务详情失败")?;
    let mut body = current.as_object().cloned().unwrap_or_default();

    if let Some(title) = input.title {
        body.insert("title".to_string(), json!(title));
    }
    if let Some(notes) = input.notes {
        body.insert("notes".to_string(), json!(notes));
    }
    if input.due.is_some() {
        match normalize_due(input.due.as_deref()) {
            Some(due) => {
                body.insert("due".to_string(), json!(due));
            }
            None => {
                body.insert("due".to_string(), Value::Null);
            }
        }
    }
    if let Some(status) = input.status {
        body.insert("status".to_string(), json!(status));
    }

    let task: GoogleTaskItem = send_json(
        client.put(url).bearer_auth(&token).json(&body),
        "更新 Google 任务失败",
    )?;

    Ok(map_task(task, &input.task_list_id))
}

#[tauri::command]
pub fn google_delete_task(
    app: AppHandle,
    state: State<GoogleTasksState>,
    task_list_id: String,
    task_id: String,
) -> Result<(), String> {
    let token = access_token(&app, &state)?;
    let client = http_client()?;
    send_empty(
        client
            .delete(task_url(&task_list_id, &task_id))
            .bearer_auth(token),
        "删除 Google 任务失败",
    )
}

#[tauri::command]
pub fn google_move_task(
    app: AppHandle,
    state: State<GoogleTasksState>,
    input: MoveTaskInput,
) -> Result<GoogleTaskDto, String> {
    let token = access_token(&app, &state)?;
    let client = http_client()?;
    let url = format!("{}/move", task_url(&input.task_list_id, &input.task_id));
    let mut query = Vec::new();
    if let Some(parent) = input.parent.as_deref().filter(|value| !value.is_empty()) {
        query.push(("parent", parent.to_string()));
    }
    if let Some(previous) = input.previous.as_deref().filter(|value| !value.is_empty()) {
        query.push(("previous", previous.to_string()));
    }

    let task: GoogleTaskItem = send_json(
        client.post(url).bearer_auth(token).query(&query),
        "移动 Google 任务失败",
    )?;

    Ok(map_task(task, &input.task_list_id))
}

fn client_id() -> Result<String, String> {
    if let Some(client_id) = env::var("GOOGLE_TASKS_CLIENT_ID")
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
    {
        return Ok(client_id);
    }

    client_id_entry()?
        .get_password()
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            BUILTIN_GOOGLE_CLIENT_ID
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .ok_or_else(|| "请先配置 Google OAuth Client ID".to_string())
}

fn client_secret() -> Result<String, String> {
    if let Some(client_secret) = env::var("GOOGLE_TASKS_CLIENT_SECRET")
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
    {
        return Ok(client_secret);
    }

    client_secret_entry()?
        .get_password()
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            BUILTIN_GOOGLE_CLIENT_SECRET
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .ok_or_else(|| "请先配置 Google OAuth Client Secret".to_string())
}

fn refresh_token_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_REFRESH_TOKEN_USER).map_err(to_message)
}

fn client_id_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_CLIENT_ID_USER).map_err(to_message)
}

fn client_secret_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_CLIENT_SECRET_USER).map_err(to_message)
}

fn proxy_config_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_PROXY_CONFIG_USER).map_err(to_message)
}

fn user_profile_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER_PROFILE_USER).map_err(to_message)
}

fn auth_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(to_message)?;
    fs::create_dir_all(&dir).map_err(to_message)?;
    Ok(dir.join(AUTH_CACHE_FILE))
}

fn read_stored_auth_state(app: &AppHandle) -> Option<StoredAuthState> {
    let path = auth_state_path(app).ok()?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_stored_auth_state(app: &AppHandle, state: &StoredAuthState) -> Result<(), String> {
    let path = auth_state_path(app)?;
    let content = serde_json::to_string(state).map_err(to_message)?;
    fs::write(path, content).map_err(to_message)
}

fn clear_stored_auth_state(app: &AppHandle) -> Result<(), String> {
    let path = auth_state_path(app)?;
    if path.exists() {
        fs::remove_file(path).map_err(to_message)?;
    }
    Ok(())
}

fn read_user_profile(app: &AppHandle) -> Option<StoredUserProfile> {
    user_profile_entry()
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .and_then(|value| serde_json::from_str(&value).ok())
        .or_else(|| read_stored_auth_state(app).and_then(|state| state.profile))
}

fn save_user_profile(app: &AppHandle, profile: &StoredUserProfile) -> Result<(), String> {
    user_profile_entry()?
        .set_password(&serde_json::to_string(profile).map_err(to_message)?)
        .map_err(to_message)?;

    let mut state = read_stored_auth_state(app).unwrap_or_default();
    state.profile = Some(profile.clone());
    write_stored_auth_state(app, &state)
}

fn save_client_id(client_id: &str) -> Result<(), String> {
    client_id_entry()?
        .set_password(client_id)
        .map_err(to_message)
}

fn save_client_secret(client_secret: &str) -> Result<(), String> {
    client_secret_entry()?
        .set_password(client_secret)
        .map_err(to_message)
}

fn save_valid_client_id(client_id: &str) -> Result<(), String> {
    let trimmed = client_id.trim();
    if trimmed.is_empty() {
        return Err("Client ID 不能为空".to_string());
    }
    if !trimmed.ends_with(".apps.googleusercontent.com") {
        return Err("Client ID 格式看起来不正确，请确认复制的是 Desktop App Client ID".to_string());
    }
    save_client_id(trimmed)
}

fn save_valid_client_secret(client_secret: &str) -> Result<(), String> {
    let trimmed = client_secret.trim();
    if trimmed.is_empty() {
        return Err("Client Secret 不能为空".to_string());
    }
    save_client_secret(trimmed)
}

fn read_refresh_token(app: &AppHandle) -> Result<String, String> {
    refresh_token_entry()?
        .get_password()
        .map_err(to_message)
        .or_else(|_| {
            read_stored_auth_state(app)
                .and_then(|state| state.refresh_token)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "未找到已保存的 Google refresh token".to_string())
        })
}

fn save_refresh_token(app: &AppHandle, refresh_token: &str) -> Result<(), String> {
    refresh_token_entry()?
        .set_password(refresh_token)
        .map_err(to_message)?;

    let mut state = read_stored_auth_state(app).unwrap_or_default();
    state.refresh_token = Some(refresh_token.to_string());
    write_stored_auth_state(app, &state)
}

fn access_token(app: &AppHandle, state: &State<GoogleTasksState>) -> Result<String, String> {
    {
        let auth = state.auth.lock().map_err(to_message)?;
        if let (Some(token), Some(expires_at)) = (&auth.access_token, auth.expires_at) {
            if Instant::now() + Duration::from_secs(60) < expires_at {
                return Ok(token.clone());
            }
        }
    }

    let client_id = client_id()?;
    let client_secret = client_secret()?;
    let refresh_token = read_refresh_token(app)?;
    let client = http_client()?;
    let token = match refresh_access_token(&client, &client_id, &client_secret, &refresh_token) {
        Ok(token) => token,
        Err(error) => {
            if is_invalid_grant_error(&error) {
                let _ = clear_google_auth(app, state, true);
                return Err(format!(
                    "Google authorization expired or was revoked. Please sign in again. Details: {error}"
                ));
            }
            return Err(error);
        }
    };
    let access_token = token.access_token.clone();
    update_access_cache(state, token.access_token, token.expires_in)?;
    Ok(access_token)
}

fn clear_google_auth(
    app: &AppHandle,
    state: &State<GoogleTasksState>,
    clear_profile: bool,
) -> Result<(), String> {
    match refresh_token_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(error) => return Err(to_message(error)),
    }
    if clear_profile {
        match user_profile_entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(to_message(error)),
        }
    }

    let mut auth = state.auth.lock().map_err(to_message)?;
    auth.access_token = None;
    auth.expires_at = None;
    clear_stored_auth_state(app)
}

fn is_invalid_grant_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("invalid_grant") || lower.contains("token has been expired or revoked")
}

fn update_access_cache(
    state: &State<GoogleTasksState>,
    access_token: String,
    expires_in: Option<u64>,
) -> Result<(), String> {
    let mut auth = state.auth.lock().map_err(to_message)?;
    auth.access_token = Some(access_token);
    auth.expires_at = Some(Instant::now() + Duration::from_secs(expires_in.unwrap_or(3600)));
    Ok(())
}

fn exchange_code_for_token(
    client: &Client,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code: &str,
    verifier: &str,
) -> Result<TokenResponse, String> {
    send_json(
        client.post(TOKEN_URL).form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ]),
        "换取 Google token 失败",
    )
}

fn refresh_access_token(
    client: &Client,
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<TokenResponse, String> {
    send_json(
        client.post(TOKEN_URL).form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ]),
        "刷新 Google token 失败",
    )
}

fn fetch_calendar_list(
    client: &Client,
    token: &str,
) -> Result<Vec<GoogleCalendarListItem>, String> {
    let mut page_token: Option<String> = None;
    let mut calendars = Vec::new();

    loop {
        let mut request = client
            .get(format!("{CALENDAR_API_BASE}/users/me/calendarList"))
            .bearer_auth(token)
            .query(&[
                ("showHidden", "false"),
                ("minAccessRole", "reader"),
                ("maxResults", "100"),
            ]);

        if let Some(next_page_token) = page_token.as_deref() {
            request = request.query(&[("pageToken", next_page_token)]);
        }

        let response: CalendarListResponse = send_json(request, "获取 Google Calendar 列表失败")?;
        calendars.extend(response.items.unwrap_or_default());
        page_token = response.next_page_token;
        if page_token.is_none() {
            break;
        }
    }

    Ok(calendars)
}

fn http_client() -> Result<Client, String> {
    let config = read_proxy_config();
    let mut builder = Client::builder();

    match config.mode.as_str() {
        "system" => {}
        "none" => {
            builder = builder.no_proxy();
        }
        "custom" => {
            let proxy_url = normalize_proxy_url(&config.url)?;
            builder = builder.proxy(Proxy::all(&proxy_url).map_err(to_message)?);
        }
        _ => {}
    }

    builder
        .build()
        .map_err(|error| format!("创建网络客户端失败：{error}"))
}

fn read_proxy_config() -> GoogleProxyConfig {
    match proxy_config_entry().and_then(|entry| entry.get_password().map_err(to_message)) {
        Ok(value) => serde_json::from_str(&value).unwrap_or_else(|_| default_proxy_config()),
        Err(_) => default_proxy_config(),
    }
}

fn default_proxy_config() -> GoogleProxyConfig {
    GoogleProxyConfig {
        mode: "system".to_string(),
        url: String::new(),
    }
}

fn normalize_proxy_config(config: GoogleProxyConfig) -> Result<GoogleProxyConfig, String> {
    let mode = config.mode.trim();
    let url = config.url.trim();
    match mode {
        "system" | "none" => Ok(GoogleProxyConfig {
            mode: mode.to_string(),
            url: String::new(),
        }),
        "custom" => Ok(GoogleProxyConfig {
            mode: "custom".to_string(),
            url: normalize_proxy_url(url)?,
        }),
        _ => Err("代理模式不正确".to_string()),
    }
}

fn normalize_proxy_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("请填写 HTTP 代理地址，例如 http://127.0.0.1:7890".to_string());
    }

    let normalized = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };

    Url::parse(&normalized)
        .map_err(|_| "代理地址格式不正确，例如 http://127.0.0.1:7890".to_string())?;
    Ok(normalized)
}

fn send_json<T: for<'de> Deserialize<'de>>(
    request: RequestBuilder,
    context: &str,
) -> Result<T, String> {
    let response = request
        .send()
        .map_err(|error| format!("{context}：无法连接 Google 服务：{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("{context}：无法读取 Google 响应：{error}"))?;

    if !status.is_success() {
        return Err(format!("{context}：HTTP {status}，{body}"));
    }

    serde_json::from_str(&body).map_err(|error| format!("{context}：响应解析失败：{error}"))
}

fn send_empty(request: RequestBuilder, context: &str) -> Result<(), String> {
    let response = request
        .send()
        .map_err(|error| format!("{context}：无法连接 Google 服务：{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("{context}：无法读取 Google 响应：{error}"))?;

    if !status.is_success() {
        return Err(format!("{context}：HTTP {status}，{body}"));
    }

    Ok(())
}

fn wait_for_oauth_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    let (mut stream, _) = listener.accept().map_err(to_message)?;
    let mut buffer = [0; 4096];
    let size = stream.read(&mut buffer).map_err(to_message)?;
    let request = String::from_utf8_lossy(&buffer[..size]);
    let request_line = request
        .lines()
        .next()
        .ok_or_else(|| "未收到 OAuth 回调请求".to_string())?;
    let path = request_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "OAuth 回调请求格式不正确".to_string())?;
    let callback_url = Url::parse(&format!("http://127.0.0.1{path}")).map_err(to_message)?;
    let params: HashMap<String, String> = callback_url.query_pairs().into_owned().collect();

    let response_body = "<html><body><h2>Google Tasks 登录完成</h2><p>可以关闭这个浏览器窗口，回到桌面应用继续使用。</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
        response_body.as_bytes().len(),
        response_body
    );
    stream.write_all(response.as_bytes()).map_err(to_message)?;

    if let Some(error) = params.get("error") {
        return Err(format!("Google 登录被取消或失败：{error}"));
    }

    if params.get("state").map(String::as_str) != Some(expected_state) {
        return Err("OAuth state 校验失败，请重新登录".to_string());
    }

    params
        .get("code")
        .cloned()
        .ok_or_else(|| "OAuth 回调缺少授权 code".to_string())
}

fn get_json<T: for<'de> Deserialize<'de>>(
    client: &Client,
    url: &str,
    token: &str,
    context: &str,
) -> Result<T, String> {
    send_json(client.get(url).bearer_auth(token), context)
}

fn fetch_user_profile(client: &Client, token: &str) -> Result<StoredUserProfile, String> {
    let user_info: GoogleUserInfo = get_json(
        client,
        "https://openidconnect.googleapis.com/v1/userinfo",
        token,
        "读取 Google 账户信息失败",
    )?;
    Ok(StoredUserProfile {
        name: user_info.name,
        email: user_info.email,
        picture: user_info.picture,
    })
}

fn profile_from_id_token(id_token: &str) -> Option<StoredUserProfile> {
    let payload = id_token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let claims: GoogleIdTokenClaims = serde_json::from_slice(&decoded).ok()?;
    if claims.name.is_none() && claims.email.is_none() && claims.picture.is_none() {
        return None;
    }
    Some(StoredUserProfile {
        name: claims.name,
        email: claims.email,
        picture: claims.picture,
    })
}

fn task_url(task_list_id: &str, task_id: &str) -> String {
    format!(
        "{TASKS_API_BASE}/lists/{}/tasks/{}",
        encode_path_segment(task_list_id),
        encode_path_segment(task_id)
    )
}

fn calendar_event_url(calendar_id: &str, event_id: &str) -> String {
    format!(
        "{CALENDAR_API_BASE}/calendars/{}/events/{}",
        encode_path_segment(calendar_id),
        encode_path_segment(event_id)
    )
}

fn map_task(task: GoogleTaskItem, task_list_id: &str) -> GoogleTaskDto {
    let status = task.status.unwrap_or_else(|| "needsAction".to_string());
    let completed_at = task.completed;
    GoogleTaskDto {
        id: task.id,
        task_list_id: task_list_id.to_string(),
        title: task.title.unwrap_or_default(),
        notes: task.notes,
        due: task.due,
        parent: task.parent,
        position: task.position,
        completed: status == "completed",
        completed_at,
        status,
    }
}

fn map_calendar_event(
    event: GoogleCalendarEventItem,
    calendar_id: &str,
    calendar_name: &str,
    calendar_color: Option<&str>,
) -> Option<GoogleCalendarEventDto> {
    let start = event.start?;
    let (start_value, all_day) = if let Some(date) = start.date {
        (date, true)
    } else {
        (start.date_time?, false)
    };

    let end = event.end.and_then(|value| value.date_time.or(value.date));

    Some(GoogleCalendarEventDto {
        id: event.id,
        calendar_id: calendar_id.to_string(),
        calendar_name: calendar_name.to_string(),
        title: event
            .summary
            .unwrap_or_else(|| "Untitled event".to_string()),
        description: event.description,
        location: event.location,
        start: start_value,
        end,
        all_day,
        color: calendar_color.map(str::to_string),
    })
}

fn normalize_due(due: Option<&str>) -> Option<String> {
    let value = due?.trim();
    if value.is_empty() {
        return None;
    }
    if value.contains('T') {
        return Some(value.to_string());
    }
    Some(format!("{value}T00:00:00.000Z"))
}

fn apply_calendar_event_time(
    body: &mut Value,
    date: Option<&str>,
    time: Option<&str>,
) -> Result<(), String> {
    let current_start = body.get("start").cloned().unwrap_or(Value::Null);
    let current_date = current_start
        .get("date")
        .and_then(Value::as_str)
        .or_else(|| {
            current_start
                .get("dateTime")
                .and_then(Value::as_str)
                .and_then(|value| value.get(0..10))
        })
        .unwrap_or("1970-01-01");
    let next_date = date
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(current_date);

    if !is_iso_date(next_date) {
        return Err("日程日期格式不正确，应为 YYYY-MM-DD".to_string());
    }

    match time.filter(|value| !value.trim().is_empty()) {
        Some(next_time) => {
            if !is_hhmm_time(next_time) {
                return Err("日程时间格式不正确，应为 HH:MM".to_string());
            }
            let timezone = current_start
                .get("timeZone")
                .and_then(Value::as_str)
                .unwrap_or("Asia/Shanghai");
            let (end_date, end_time) = add_minutes_to_date_time(next_date, next_time, 30)?;
            body["start"] = json!({
                "dateTime": format!("{next_date}T{next_time}:00"),
                "timeZone": timezone,
            });
            body["end"] = json!({
                "dateTime": format!("{end_date}T{end_time}:00"),
                "timeZone": timezone,
            });
        }
        None => {
            body["start"] = json!({ "date": next_date });
            body["end"] = json!({ "date": next_iso_date(next_date)? });
        }
    }

    Ok(())
}

fn is_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.len() == 10
        && bytes.get(4) == Some(&b'-')
        && bytes.get(7) == Some(&b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

fn is_hhmm_time(value: &str) -> bool {
    let mut parts = value.split(':');
    let hour = parts.next().and_then(|part| part.parse::<u32>().ok());
    let minute = parts.next().and_then(|part| part.parse::<u32>().ok());
    parts.next().is_none()
        && hour.is_some_and(|value| value < 24)
        && minute.is_some_and(|value| value < 60)
}

fn add_minutes_to_date_time(
    date: &str,
    time: &str,
    minutes_to_add: u32,
) -> Result<(String, String), String> {
    let mut time_parts = time.split(':');
    let hour = time_parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .ok_or_else(|| "日程时间格式不正确".to_string())?;
    let minute = time_parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .ok_or_else(|| "日程时间格式不正确".to_string())?;
    let total = hour * 60 + minute + minutes_to_add;
    let next_day = total >= 24 * 60;
    let next_total = total % (24 * 60);
    let end_date = if next_day {
        next_iso_date(date)?
    } else {
        date.to_string()
    };
    let end_time = format!("{:02}:{:02}", next_total / 60, next_total % 60);
    Ok((end_date, end_time))
}

fn next_iso_date(date: &str) -> Result<String, String> {
    let year = date
        .get(0..4)
        .and_then(|part| part.parse::<i32>().ok())
        .ok_or_else(|| "日程日期格式不正确".to_string())?;
    let month = date
        .get(5..7)
        .and_then(|part| part.parse::<u32>().ok())
        .ok_or_else(|| "日程日期格式不正确".to_string())?;
    let day = date
        .get(8..10)
        .and_then(|part| part.parse::<u32>().ok())
        .ok_or_else(|| "日程日期格式不正确".to_string())?;

    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => return Err("日程日期月份不正确".to_string()),
    };

    let (next_year, next_month, next_day) = if day < days_in_month {
        (year, month, day + 1)
    } else if month == 12 {
        (year + 1, 1, 1)
    } else {
        (year, month + 1, 1)
    };

    Ok(format!("{next_year:04}-{next_month:02}-{next_day:02}"))
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn month_bounds(month: &str) -> Result<(String, String), String> {
    let mut parts = month.split('-');
    let year = parts
        .next()
        .ok_or_else(|| "月份格式不正确，应为 YYYY-MM".to_string())?
        .parse::<i32>()
        .map_err(to_message)?;
    let month = parts
        .next()
        .ok_or_else(|| "月份格式不正确，应为 YYYY-MM".to_string())?
        .parse::<u32>()
        .map_err(to_message)?;

    if !(1..=12).contains(&month) {
        return Err("月份必须在 01 到 12 之间".to_string());
    }

    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };

    Ok((
        format!("{year:04}-{month:02}-01T00:00:00Z"),
        format!("{next_year:04}-{next_month:02}-01T00:00:00Z"),
    ))
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn random_string(length: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}

fn encode_path_segment(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn to_message(error: impl std::fmt::Display) -> String {
    error.to_string()
}
