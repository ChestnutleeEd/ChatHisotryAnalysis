use tauri::Manager;

pub mod analytics_results;
pub mod dataset_handoff;
pub mod dataset_transport;
pub mod desktop_selection;
pub mod export;
pub mod export_schema;
pub mod ipc;
pub mod lifecycle;
pub mod presentation_save;
pub mod privacy_log;
pub mod secure_storage;
pub mod security;
pub mod session_supervisor;
pub mod trust_anchor;
pub mod webview_permissions;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(ipc::IpcCoreState::default())
        .manage(dataset_transport::DatasetTransportState::default())
        .setup(|app| {
            trust_anchor::verify_embedded_anchor()
                .map_err(|code| std::io::Error::new(std::io::ErrorKind::InvalidData, code))?;
            let cache_root = app
                .path()
                .app_cache_dir()
                .map_err(|_| std::io::Error::new(std::io::ErrorKind::NotFound, "cache"))?;
            let recovery =
                session_supervisor::recover_startup_sessions(&cache_root).map_err(|error| {
                    std::io::Error::new(std::io::ErrorKind::PermissionDenied, error)
                })?;
            app.state::<ipc::IpcCoreState>()
                .set_startup_cleanup_required(recovery.cleanup_required);
            let transport = app
                .state::<dataset_transport::DatasetTransportState>()
                .inner()
                .clone();
            if let Ok(resource_dir) = app.path().resource_dir() {
                let bundle_root = resource_dir.join(trust_anchor::SIDECAR_BUNDLE_DIRECTORY);
                if trust_anchor::verify_sidecar_bundle(&bundle_root).is_ok() {
                    transport.mark_sidecar_verified();
                }
            }
            let window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == security::MAIN_WINDOW_LABEL)
                .ok_or_else(|| {
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "missing main window configuration",
                    )
                })?;
            let window = tauri::webview::WebviewWindowBuilder::from_config(app, window_config)?
                .on_navigation(security::allow_navigation)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            webview_permissions::install(&window)?;
            let app_handle = app.handle().clone();
            let close_window = window.clone();
            window.on_window_event({
                let transport = transport.clone();
                move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let state = app_handle.state::<ipc::IpcCoreState>();
                        transport.close_window(security::MAIN_WINDOW_LABEL);
                        if state.prepare_application_close() {
                            let _ = close_window.close();
                        }
                        return;
                    }
                    if matches!(event, tauri::WindowEvent::Destroyed) {
                        transport.close_window(security::MAIN_WINDOW_LABEL);
                        app_handle
                            .state::<ipc::IpcCoreState>()
                            .renderer_disconnected(security::MAIN_WINDOW_LABEL);
                    }
                }
            });
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                webview
                    .app_handle()
                    .state::<dataset_transport::DatasetTransportState>()
                    .close_window(webview.label());
                webview
                    .app_handle()
                    .state::<ipc::IpcCoreState>()
                    .renderer_disconnected(webview.label());
            }
            #[cfg(feature = "synthetic-dialog-adapter")]
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = webview.eval(
                    r#"(() => {
                      window.__CHAT_HISTORY_ANALYSIS_SYNTHETIC_SMOKE__ = true;
                      const button = (label) => Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(label));
                      const failureCodes = ["SIDECAR_UNAVAILABLE", "SIDECAR_VERIFICATION_FAILED", "SIDECAR_SPAWN_FAILED", "SIDECAR_START_FAILED", "SIDECAR_HANDSHAKE_TIMEOUT", "PREPROCESSING_STALLED", "SIDECAR_PROTOCOL_FAILED", "SIDECAR_EXITED_UNEXPECTEDLY", "SIDECAR_PROTOCOL_INVALID", "SIDECAR_CRASHED", "DATASET_HANDOFF_INVALID", "DATASET_TRANSPORT_INVALID", "WORKER_RUNTIME_FAILED", "WORKER_TIMEOUT", "INVALID_REQUEST", "INVALID_STATE"];
                      const visibleFailureCode = () => failureCodes.find((code) => document.body.textContent?.includes(code));
                      const betaHome = () => document.querySelector('[data-beta-mode="home"]');
                      const betaAnnualRecap = () => document.querySelector('[data-beta-mode="annual-recap"]');
                      const betaCoreSectionIds = ["opening", "messages", "active-days", "longest-streak", "peak-month", "peak-weekday", "peak-hour", "sender-share", "message-length", "message-types", "sessions", "replies", "frequent-words", "distinctive-keywords", "word-cloud"];
                      const betaCoreReady = () => betaAnnualRecap() !== null && betaCoreSectionIds.every((id) => document.getElementById(id) !== null);
                      const betaWordCloudReady = () => document.querySelector('[data-testid="beta-word-cloud-canvas"][data-layout-state="ready"]') !== null;
                      const waitFor = (predicate, deadline = Date.now() + 120000) => new Promise((resolve, reject) => {
                        const tick = () => {
                          if (predicate()) { resolve(true); return; }
                          if (Date.now() > deadline) { reject(new Error("selection smoke timeout")); return; }
                          window.setTimeout(tick, 50);
                        };
                        tick();
                      });
                      (async () => {
                        await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "page-loaded" });
                        const onboarding = button("继续到文件选择");
                        if (onboarding !== undefined) onboarding.click();
                        await waitFor(() => button("选择年度源") !== undefined);
                        await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "onboarding-ready" });
                        button("选择年度源")?.click();
                        await waitFor(() => {
                          const count = document.body.textContent?.includes("年度源：1 个") === true;
                          const start = button("开始分析");
                          return count && start !== undefined && !start.disabled;
                        });
                        await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "selection-ready" });
                        await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "resolution" });
                        button("开始分析")?.click();
                        await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "start-clicked" });
                        await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: document.body.textContent?.includes("正在验证、合并、排序和去重") === true || document.body.textContent?.includes("正在验证并整理源文件") === true || document.body.textContent?.includes("正在等待本地预处理响应") === true ? "start-status-visible" : "start-status-missing" });
                        await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_host_state");
                        await waitFor(() => {
                          const cancel = button("取消");
                          return cancel !== undefined && !cancel.disabled;
                        });
                        await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "cancel-available" });
                        button("取消")?.click();
                        await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "cancel-clicked" });
                        await waitFor(() => {
                          const start = button("开始分析");
                          return start !== undefined && !start.disabled;
                        });
                        await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "cancelled-ready" });
                        button("开始分析")?.click();
                        await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "retry-start-clicked" });
                        await waitFor(() => document.querySelector(".dashboard-shell") !== null || betaHome() !== null || visibleFailureCode() !== undefined || document.body.textContent?.includes("本地统计未完成") === true);
                        const failureCode = visibleFailureCode();
                        if (document.querySelector(".dashboard-shell") !== null) {
                          await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "dashboard-ready" });
                        } else if (betaHome() !== null) {
                          await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "home-ready" });
                          button("查看年度聊天报告")?.click();
                          await waitFor(() => betaCoreReady() || visibleFailureCode() !== undefined || document.body.textContent?.includes("本地统计未完成") === true);
                          if (!betaCoreReady()) {
                            const checkpoint = visibleFailureCode() ?? (document.body.textContent?.includes("本地统计未完成") === true ? "worker-error-visible" : "error");
                            await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint });
                            throw new Error("selection smoke annual recap workflow failed");
                          }
                          await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "annual-recap-ready" });
                          await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "core-sections-ready" });
                          await waitFor(() => betaWordCloudReady() || visibleFailureCode() !== undefined);
                          if (!betaWordCloudReady()) {
                            const checkpoint = visibleFailureCode() ?? "error";
                            await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint });
                            throw new Error("selection smoke word cloud workflow failed");
                          }
                          await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "word-evidence-ready" });
                          await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "word-cloud-ready" });
                        } else {
                          const checkpoint = failureCode ?? (document.body.textContent?.includes("本地统计未完成") === true ? "worker-error-visible" : "error");
                          await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint });
                          throw new Error("selection smoke workflow failed");
                        }
                        await window.__TAURI_INTERNALS__.invoke("record_selection_smoke");
                        button("退出应用")?.click();
                        await waitFor(() => button("退出并清理") !== undefined);
                        button("退出并清理")?.click();
                      })().catch(() => window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "error" }).catch(() => undefined));
                    })()"#,
                );
            }
        });
    #[cfg(feature = "synthetic-dialog-adapter")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        ipc::select_annual_sources,
        ipc::select_verification_sources,
        ipc::record_selection_smoke,
        ipc::record_selection_smoke_checkpoint,
        ipc::record_selection_smoke_host_state,
        ipc::start_analysis,
        ipc::cancel_analysis,
        ipc::get_analysis_status,
        ipc::retry_analysis,
        ipc::discard_session,
        ipc::prepare_aggregate_result,
        ipc::cancel_aggregate_result,
        ipc::commit_worker_result,
        ipc::acknowledge_worker_stop,
        ipc::export_aggregate,
        presentation_save::prepare_presentation_png,
        presentation_save::cancel_presentation_png,
        presentation_save::save_presentation_png,
        ipc::request_application_close,
        dataset_transport::open_dataset_stream,
        dataset_transport::receive_dataset_chunk,
        dataset_transport::complete_dataset_stream,
        dataset_transport::cancel_dataset_stream,
        dataset_transport::close_dataset_stream,
    ]);
    #[cfg(not(feature = "synthetic-dialog-adapter"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        ipc::select_annual_sources,
        ipc::select_verification_sources,
        ipc::start_analysis,
        ipc::cancel_analysis,
        ipc::get_analysis_status,
        ipc::retry_analysis,
        ipc::discard_session,
        ipc::prepare_aggregate_result,
        ipc::cancel_aggregate_result,
        ipc::commit_worker_result,
        ipc::acknowledge_worker_stop,
        ipc::export_aggregate,
        presentation_save::prepare_presentation_png,
        presentation_save::cancel_presentation_png,
        presentation_save::save_presentation_png,
        ipc::request_application_close,
        dataset_transport::open_dataset_stream,
        dataset_transport::receive_dataset_chunk,
        dataset_transport::complete_dataset_stream,
        dataset_transport::cancel_dataset_stream,
        dataset_transport::close_dataset_stream,
    ]);
    builder
        .build(tauri::generate_context!())
        .expect("error while building Chat History Analysis")
        .run(|app_handle, event| match event {
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                api.prevent_exit();
                app_handle
                    .state::<dataset_transport::DatasetTransportState>()
                    .close_window(security::MAIN_WINDOW_LABEL);
                if app_handle
                    .state::<ipc::IpcCoreState>()
                    .prepare_application_close()
                {
                    app_handle.exit(code.unwrap_or(0));
                }
            }
            tauri::RunEvent::Exit => {
                app_handle.state::<ipc::IpcCoreState>().shutdown();
            }
            _ => {}
        });
}
