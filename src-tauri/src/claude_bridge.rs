//! Claude Code CLI 桥接：与 Codex 一样调用本机已登录的 CLI，不需要 API Key。
//! 使用非交互模式 `claude -p`，提示词经 stdin 传入，返回最终文本（JSON 编辑方案）。
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, State};

#[derive(Default)]
pub struct ClaudeBridge {
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    path: String,
    version: String,
    logged_in: bool,
    message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    request_id: String,
    message: String,
}

/// 只给一句简短的 ASCII 系统提示，完整的编辑规则随用户提示词经 stdin 传入，避免命令行转义问题。
const SYSTEM_PROMPT: &str = "You are the pixel rig animation editing assistant inside Pixel Rig Studio. Do not use any tools. Reply with exactly one JSON object that follows the instructions in the user message, with no Markdown and no extra text.";

/// Claude 在这个场景里只需要生成文本，禁用所有内置工具。
const DISALLOWED_TOOLS: &[&str] = &[
    "Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "Read", "Glob", "Grep",
    "WebFetch", "WebSearch", "Task", "TodoWrite",
];

fn command(path: &Path) -> Command {
    // Rust 标准库会为 .cmd/.bat 自动走 cmd.exe 并安全转义参数。
    let mut cmd = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

fn resolve_claude(configured: &str) -> Result<PathBuf, String> {
    if !configured.trim().is_empty() {
        let path = PathBuf::from(configured.trim());
        if !path.is_absolute() || !path.is_file() {
            return Err("请填写 Claude Code 可执行文件的完整路径。".into());
        }
        #[cfg(windows)]
        {
            let ext = path
                .extension()
                .and_then(|x| x.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if ext != "exe" && ext != "cmd" {
                return Err("请选择 claude.exe（或 npm 安装生成的 claude.cmd）。".into());
            }
        }
        return Ok(path);
    }
    let names: Vec<&str> = if cfg!(windows) {
        vec!["claude.exe", "claude.cmd"]
    } else {
        vec!["claude"]
    };
    if let Some(paths) = std::env::var_os("PATH") {
        for name in &names {
            for dir in std::env::split_paths(&paths) {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }
    let mut candidates = Vec::new();
    if let Some(home) = home_dir() {
        if cfg!(windows) {
            candidates.push(home.join(".local/bin/claude.exe"));
        } else {
            candidates.push(home.join(".local/bin/claude"));
            candidates.push(home.join(".claude/local/claude"));
        }
    }
    if cfg!(windows) {
        if let Ok(roaming) = std::env::var("APPDATA") {
            candidates.push(PathBuf::from(roaming).join("npm/claude.cmd"));
        }
    }
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "找不到 Claude Code。请安装并登录 Claude Code CLI，或在连接设置中选择 claude.exe。".into()
        })
}

/// 运行一个短命令；超时返回 None，而不是报错。
fn limited_output(path: &Path, args: &[&str], timeout: Duration) -> Result<Option<(bool, String)>, String> {
    let mut child = command(path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 Claude Code：{e}"))?;
    let out = child.stdout.take().unwrap();
    let err = child.stderr.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = out.take(65536).read_to_string(&mut s);
        s
    });
    let errors = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = err.take(65536).read_to_string(&mut s);
        s
    });
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(None);
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    Ok(Some((
        status.success(),
        format!(
            "{}{}",
            reader.join().unwrap_or_default(),
            errors.join().unwrap_or_default()
        )
        .trim()
        .to_string(),
    )))
}

fn has_credentials() -> bool {
    if std::env::var_os("ANTHROPIC_API_KEY").is_some() {
        return true;
    }
    home_dir()
        .map(|home| home.join(".claude/.credentials.json").is_file())
        .unwrap_or(false)
}

#[tauri::command]
pub async fn claude_connection_status(executable: String) -> Result<ConnectionStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve_claude(&executable)?;
        let (ok, version) = limited_output(&path, &["--version"], Duration::from_secs(20))?
            .ok_or("Claude Code 连接检测超时。")?;
        if !ok {
            return Err("该文件不能作为 Claude Code CLI 启动。".into());
        }
        // 新版 CLI 提供 `claude auth status`；旧版没有时退回检查本机凭据文件。
        let logged_in = matches!(
            limited_output(&path, &["auth", "status"], Duration::from_secs(15)),
            Ok(Some((true, _)))
        ) || has_credentials();
        Ok(ConnectionStatus {
            path: path.to_string_lossy().to_string(),
            version,
            logged_in,
            message: if logged_in {
                "已连接，可发送请求。"
            } else {
                "尚未检测到登录。请在终端执行下方命令完成登录，然后重新检测。"
            }
            .into(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn claude_cancel(request_id: String, state: State<'_, ClaudeBridge>) -> Result<(), String> {
    if let Some(cancelled) = state
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .get(&request_id)
    {
        cancelled.store(true, Ordering::SeqCst);
    }
    Ok(())
}

struct TempWorkspace(PathBuf);
impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// 截取原始报错的末尾一段显示给用户，并遮掉看起来像密钥的内容。
fn error_detail(text: &str) -> String {
    let cleaned: String = text
        .split_whitespace()
        .map(|word| if word.contains("sk-ant") || word.len() > 60 { "***" } else { word })
        .collect::<Vec<_>>()
        .join(" ");
    let chars: Vec<char> = cleaned.chars().collect();
    let start = chars.len().saturating_sub(400);
    chars[start..].iter().collect()
}

fn friendly_error(text: &str) -> &'static str {
    let lower = text.to_lowercase();
    if lower.contains("login") || lower.contains("auth") || lower.contains("401") || lower.contains("api key") {
        "请检查 Claude Code 登录状态（在终端运行 claude 并执行 /login）。"
    } else if lower.contains("limit") || lower.contains("quota") || lower.contains("429") || lower.contains("overloaded") {
        "Claude 额度或频率受限，请稍后重试。"
    } else if lower.contains("model") {
        "请检查模型名称及账号访问权限，或清空模型设置。"
    } else {
        "请检查网络、Claude Code 版本和账号状态。"
    }
}

fn run_request(
    app: &tauri::AppHandle,
    path: &Path,
    request_id: &str,
    prompt: &str,
    model: &str,
    images: &[String],
    cancelled: &AtomicBool,
) -> Result<String, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    // 在空的临时目录里运行，CLI 读不到任何项目文件或 CLAUDE.md。
    let temp = TempWorkspace(
        std::env::temp_dir().join(format!("pixel-rig-claude-{}-{nonce}", std::process::id())),
    );
    std::fs::create_dir(&temp.0).map_err(|e| e.to_string())?;
    let mut cmd = command(path);
    // 不读取 ~/.claude/settings.json 等用户配置：CC Switch 之类的工具会在那里把服务商、模型改成第三方，
    // 这里固定使用 claude.ai 账号登录。临时目录里没有项目配置，等于不加载任何配置。
    cmd.args([
        "-p",
        "--setting-sources",
        "project,local",
        "--strict-mcp-config",
        "--tools",
        "",
        "--system-prompt",
        SYSTEM_PROMPT,
    ]);
    cmd.arg("--disallowedTools").args(DISALLOWED_TOOLS);
    let input = if images.is_empty() {
        cmd.args(["--output-format", "json"]);
        prompt.to_string()
    } else {
        cmd.args(["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]);
        let mut content = vec![serde_json::json!({ "type": "text", "text": prompt })];
        for image in images {
            content.push(serde_json::json!({
                "type": "image",
                "source": { "type": "base64", "media_type": "image/png", "data": image },
            }));
        }
        format!("{}\n", serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": content },
            "parent_tool_use_id": null,
            "session_id": "",
        }))
    };
    if !model.trim().is_empty() {
        cmd.arg("--model").arg(model.trim());
    }
    cmd.current_dir(&temp.0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("无法启动 Claude Code：{e}"))?;
    let _ = app.emit(
        "codex-progress",
        Progress {
            request_id: request_id.to_string(),
            message: "Claude 正在生成编辑方案…".into(),
        },
    );
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.take(4_000_000).read_to_string(&mut s);
        s
    });
    let errors = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.take(65536).read_to_string(&mut s);
        s
    });
    if let Some(mut stdin) = child.stdin.take() {
        // 写完后 drop stdin，让 CLI 读到 EOF。
        if let Err(e) = stdin.write_all(input.as_bytes()) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            let _ = errors.join();
            return Err(format!("无法向 Claude Code 发送请求：{e}"));
        }
    }
    let start = Instant::now();
    let status = loop {
        if cancelled.load(Ordering::SeqCst) || start.elapsed() > Duration::from_secs(300) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            let _ = errors.join();
            return Err(if cancelled.load(Ordering::SeqCst) {
                "请求已取消。"
            } else {
                "Claude 请求超过 5 分钟，请缩小编辑范围后重试。"
            }
            .into());
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let output = reader.join().unwrap_or_default();
    let error = errors.join().unwrap_or_default();
    // --output-format json 输出一个结果对象：{"type":"result","is_error":false,"result":"..."}
    let parsed: Option<serde_json::Value> = output
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line.trim()).ok())
        .find(|value| value["type"] == "result");
    let Some(value) = parsed else {
        if !images.is_empty() {
            return Err(format!("Claude 未返回图片编辑方案。{}", friendly_error(&error)));
        }
        let raw = format!("{output} {error}");
        return Err(format!("Claude 请求失败。{}\n原始信息：{}", friendly_error(&raw), error_detail(&raw)));
    };
    let result = value["result"].as_str().unwrap_or("").to_string();
    let is_error = value["is_error"].as_bool().unwrap_or(false) || !status.success();
    if is_error {
        let subtype = value["subtype"].as_str().unwrap_or("");
        if subtype == "error_max_turns" {
            return Err("Claude 试图调用工具而没有直接给出方案，请重试。".into());
        }
        let raw = format!("{result} {error}");
        return Err(format!("Claude 请求失败。{}\n原始信息：{}", friendly_error(&raw), error_detail(&raw)));
    }
    if result.trim().is_empty() {
        return Err("Claude 没有返回编辑方案。".into());
    }
    if result.len() > 2_000_000 {
        return Err("Claude 返回的方案过大。".into());
    }
    Ok(result)
}

#[tauri::command]
pub async fn claude_chat(
    app: tauri::AppHandle,
    state: State<'_, ClaudeBridge>,
    request_id: String,
    executable: String,
    prompt: String,
    model: String,
    images: Option<Vec<String>>,
) -> Result<String, String> {
    if request_id.len() > 100 || prompt.len() > 2_000_000 || model.len() > 100 {
        return Err("请求数据过大。".into());
    }
    let images = images.unwrap_or_default();
    if images.len() > 6 || images.iter().any(|data| data.len() > 690_000 || !data.starts_with("iVBORw0KGgo")) {
        return Err("参考图必须是 PNG，每次最多 6 张，每张不超过 512 KB。".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut running = state.running.lock().map_err(|e| e.to_string())?;
        if !running.is_empty() {
            return Err("已有 Claude 请求正在执行。".into());
        }
        running.insert(request_id.clone(), cancelled.clone());
    }
    let id = request_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let path = resolve_claude(&executable)?;
        run_request(&app, &path, &id, &prompt, &model, &images, &cancelled)
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|value| value);
    state
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&request_id);
    result
}
