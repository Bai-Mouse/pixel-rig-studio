use serde::Serialize;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
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
pub struct CodexBridge {
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

fn command(path: &Path) -> Command {
    let mut cmd = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

fn resolve_codex(configured: &str) -> Result<PathBuf, String> {
    if !configured.trim().is_empty() {
        let path = PathBuf::from(configured.trim());
        if !path.is_absolute() || !path.is_file() {
            return Err("请填写 Codex 可执行文件的完整路径。".into());
        }
        #[cfg(windows)]
        if path.extension().and_then(|x| x.to_str()) != Some("exe") {
            return Err("请选择 codex.exe，而不是 .cmd 或 .ps1 启动脚本。".into());
        }
        return Ok(path);
    }
    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let dir = PathBuf::from(local).join("OpenAI/Codex/bin");
        let mut entries: Vec<_> = std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .collect();
        entries.sort_by_key(|entry| {
            std::cmp::Reverse(entry.metadata().ok().and_then(|m| m.modified().ok()))
        });
        for entry in entries {
            let candidate = entry.path().join("codex.exe");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    if let Ok(roaming) = std::env::var("APPDATA") {
        for package in ["@openai/codex", "@openai/codex-win32-x64"] {
            let candidate = PathBuf::from(&roaming)
                .join("npm/node_modules")
                .join(package)
                .join("vendor/x86_64-pc-windows-msvc/codex/codex.exe");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err("找不到 Codex。请安装并登录 Codex CLI，或在连接设置中选择 codex.exe。".into())
}

fn limited_output(path: &Path, args: &[&str]) -> Result<(bool, String), String> {
    let mut child = command(path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 Codex：{e}"))?;
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
        if start.elapsed() > Duration::from_secs(15) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Codex 连接检测超时。".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    Ok((
        status.success(),
        format!(
            "{}{}",
            reader.join().unwrap_or_default(),
            errors.join().unwrap_or_default()
        )
        .trim()
        .to_string(),
    ))
}

#[tauri::command]
pub async fn codex_connection_status(executable: String) -> Result<ConnectionStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve_codex(&executable)?;
        let (ok, version) = limited_output(&path, &["--version"])?;
        if !ok {
            return Err("该文件不能作为 Codex CLI 启动。".into());
        }
        let (logged_in, _) = limited_output(&path, &["login", "status"])?;
        Ok(ConnectionStatus {
            path: path.to_string_lossy().to_string(),
            version,
            logged_in,
            message: if logged_in {
                "已连接，可发送请求。"
            } else {
                "尚未登录。请在终端执行下方登录命令，然后重新检测。"
            }
            .into(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn codex_cancel(request_id: String, state: State<'_, CodexBridge>) -> Result<(), String> {
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    request_id: String,
    message: String,
}

struct TempWorkspace(PathBuf);
impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn run_request(
    app: &tauri::AppHandle,
    path: &Path,
    request_id: &str,
    prompt: &str,
    model: &str,
    images: &[Vec<u8>],
    cancelled: &AtomicBool,
) -> Result<String, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temp = TempWorkspace(
        std::env::temp_dir().join(format!("pixel-rig-codex-{}-{nonce}", std::process::id())),
    );
    std::fs::create_dir(&temp.0).map_err(|e| e.to_string())?;
    let schema = temp.0.join("edit.schema.json");
    let result_path = temp.0.join("reply.json");
    std::fs::write(&schema, include_str!("../codex-edit.schema.json"))
        .map_err(|e| e.to_string())?;
    let mut cmd = command(path);
    cmd.args([
        "exec",
        "--ignore-user-config",
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "-c",
        "approval_policy=\"never\"",
        "-c",
        "web_search=\"disabled\"",
        "--disable",
        "shell_tool",
        "--disable",
        "multi_agent",
        "--disable",
        "apps",
        "--disable",
        "plugins",
        "--disable",
        "hooks",
        "--disable",
        "browser_use",
        "--disable",
        "computer_use",
        "--json",
        "--color",
        "never",
        "--output-schema",
    ])
    .arg(&schema)
    .arg("--output-last-message")
    .arg(&result_path)
    .arg("-C")
    .arg(&temp.0);
    if !model.trim().is_empty() {
        cmd.arg("--model").arg(model.trim());
    }
    for (index, bytes) in images.iter().enumerate() {
        let image = temp.0.join(format!("frame-{index}.png"));
        std::fs::write(&image, bytes).map_err(|e| format!("无法写入参考图：{e}"))?;
        cmd.arg("--image").arg(&image);
    }
    cmd.arg("--").arg("-")
        .current_dir(&temp.0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("无法启动 Codex：{e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let handle = app.clone();
    let id = request_id.to_string();
    let stream = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.len() > 2_000_000 {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                let message = match value["type"].as_str() {
                    Some("turn.started") => Some("Codex 正在分析项目…"),
                    Some("item.started") => Some("Codex 正在生成编辑方案…"),
                    _ => None,
                };
                if let Some(message) = message {
                    let _ = handle.emit(
                        "codex-progress",
                        Progress {
                            request_id: id.clone(),
                            message: message.into(),
                        },
                    );
                }
            }
        }
    });
    let errors = std::thread::spawn(move || {
        let mut tail = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            tail.push_str(&line);
            tail.push('\n');
            if tail.len() > 16000 {
                tail = tail
                    .chars()
                    .rev()
                    .take(8000)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect();
            }
        }
        tail
    });
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = stdin.write_all(prompt.as_bytes()) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stream.join();
            let _ = errors.join();
            return Err(format!("无法向 Codex 发送请求：{e}"));
        }
    }
    let start = Instant::now();
    let status = loop {
        if cancelled.load(Ordering::SeqCst) || start.elapsed() > Duration::from_secs(300) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stream.join();
            let _ = errors.join();
            return Err(if cancelled.load(Ordering::SeqCst) {
                "请求已取消。"
            } else {
                "Codex 请求超过 5 分钟，请缩小编辑范围后重试。"
            }
            .into());
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let _ = stream.join();
    let error = errors.join().unwrap_or_default();
    if !status.success() {
        // Do not surface arbitrary logs or credentials in the chat.
        let lower = error.to_lowercase();
        let detail = if lower.contains("auth") || lower.contains("login") || lower.contains("401") {
            "请检查 Codex 登录状态。"
        } else if lower.contains("quota")
            || lower.contains("rate limit")
            || lower.contains("usage limit")
        {
            "Codex 额度或频率受限，请稍后重试。"
        } else if lower.contains("model") {
            "请检查模型名称及账号访问权限，或清空模型设置。"
        } else {
            "请检查网络、Codex 版本和账号状态。"
        };
        return Err(format!("Codex 请求失败。{detail}"));
    }
    let metadata = std::fs::metadata(&result_path).map_err(|_| "Codex 没有返回编辑方案。")?;
    if metadata.len() > 2_000_000 {
        return Err("Codex 返回的方案过大。".into());
    }
    let reply = std::fs::read_to_string(&result_path).map_err(|e| e.to_string())?;
    let _: serde_json::Value =
        serde_json::from_str(&reply).map_err(|_| "Codex 返回的方案不是有效 JSON。")?;
    Ok(reply)
}

#[tauri::command]
pub async fn codex_chat(
    app: tauri::AppHandle,
    state: State<'_, CodexBridge>,
    request_id: String,
    executable: String,
    prompt: String,
    model: String,
    images: Option<Vec<Vec<u8>>>,
) -> Result<String, String> {
    if request_id.len() > 100 || prompt.len() > 2_000_000 || model.len() > 100 {
        return Err("请求数据过大。".into());
    }
    let images = images.unwrap_or_default();
    if images.len() > 6 || images.iter().any(|bytes| bytes.len() > 512_000 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")) {
        return Err("参考图必须是 PNG，每次最多 6 张，每张不超过 512 KB。".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut running = state.running.lock().map_err(|e| e.to_string())?;
        if !running.is_empty() {
            return Err("已有 Codex 请求正在执行。".into());
        }
        running.insert(request_id.clone(), cancelled.clone());
    }
    let id = request_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let path = resolve_codex(&executable)?;
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
