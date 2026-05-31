# Google Todo

这是一个 Windows PC 桌面软件原型，用于显示和管理 Google Tasks。项目使用 Tauri 2 + React + TypeScript + Tailwind CSS，不使用 Electron。

## 当前阶段

- 第 1 阶段：已完成本地假数据三栏 UI 原型。
- 第 2 阶段：已接入 Google Tasks API、OAuth Desktop App 登录、PKCE、本地 loopback 回调。
- 第 3 阶段：已加入 SQLite 本地缓存、启动优先读缓存、后台同步、离线 pending queue。

## 本地缓存与同步

- SQLite 数据库保存到应用数据目录，不写入代码仓库。
- 缓存表包含 `task_lists`、`tasks`、`sync_meta`、`pending_queue`。
- `sync_meta.lastSyncedAt` 保存最近一次成功同步时间。
- 应用启动时先显示 SQLite 缓存；如果已登录，再后台同步 Google Tasks。
- 离线时新增、修改、删除、移动任务会先更新本地缓存，并写入 `pending_queue`。
- 下次联网同步时，会先提交 pending queue，再拉取 Google 最新数据刷新缓存。

## Google API 错误处理

- `401` 或 `invalid_grant`：清理内存 access token 后重试一次；仍失败则提示重新登录。
- `403`：提示权限不足，请检查 OAuth scope 和测试用户/授权账号。
- `404`：提示 Google 上的任务或列表不存在，本地缓存仍保留可查看。
- 网络错误：进入离线模式，继续显示本地缓存，写操作进入 pending queue。

## 常用命令

安装依赖：

```powershell
npm install
```

运行桌面应用：

```powershell
cd C:\Users\creek\Documents\GoogleTodo
npm run tauri dev
```

检查前端构建：

```powershell
npm run build
```

运行后端测试：

```powershell
cd C:\Users\creek\Documents\GoogleTodo\src-tauri
C:\Users\creek\.cargo\bin\cargo.exe test
```

检查 Rust/Tauri 后端：

```powershell
cd C:\Users\creek\Documents\GoogleTodo\src-tauri
C:\Users\creek\.cargo\bin\cargo.exe check
```

## 手动验证方法

启动缓存验证：

- 先正常登录并同步一次。
- 关闭应用。
- 重新运行 `npm run tauri dev`。
- 应用应先显示上次同步的任务缓存，然后顶部状态显示后台同步结果。

离线查看验证：

- 成功同步一次后，断开网络或在设置里把代理改成不可用端口。
- 重启应用。
- 应用仍应显示上次缓存的 Google Tasks。
- 顶部状态应提示离线或同步失败。

离线写入验证：

- 离线时新增一个任务。
- 任务应立刻出现在列表里，状态文案显示等待同步。
- 恢复网络后点击顶部同步按钮。
- pending queue 会先提交到 Google，然后刷新缓存。
- 打开 Google Tasks 网页端，确认新任务出现。

错误处理验证：

- 用错误代理端口验证网络错误进入离线模式。
- 移除测试用户或 scope 后验证 `403` 权限提示。
- 删除 Google 网页端某个任务后，再尝试在本地更新它，验证 `404` 提示。
- 撤销应用授权后重新同步，验证需要重新登录。

## 自动测试

当前 Rust 单元测试覆盖：

- SQLite 表结构迁移。
- 本地缓存快照读取。
- pending queue 计数。
- Google API 常见错误分类。

运行：

```powershell
cd C:\Users\creek\Documents\GoogleTodo\src-tauri
C:\Users\creek\.cargo\bin\cargo.exe test
```

## Google 登录说明

开发阶段首次登录需要粘贴一次 Google Cloud Console 中 Desktop App OAuth 客户端的 `Client ID` 和 `Client Secret`。它们只传给 Tauri/Rust 后端，并保存到 Windows 凭据存储。

正式产品版本可以把 OAuth 客户端配置放到应用发布配置中，普通用户只需要点击登录、选择 Google 账号并授权。
