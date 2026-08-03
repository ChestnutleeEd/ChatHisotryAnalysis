use tauri::Manager;

pub mod analytics_results;
pub mod dataset_handoff;
pub mod dataset_transport;
pub mod desktop_selection;
pub mod export;
pub mod export_schema;
pub mod ipc;
pub mod lifecycle;
pub mod privacy_log;
pub mod secure_storage;
pub mod security;
pub mod session_supervisor;
pub mod trust_anchor;
pub mod webview_permissions;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        })
        .invoke_handler(tauri::generate_handler![
            ipc::select_annual_sources,
            ipc::select_verification_sources,
            ipc::start_analysis,
            ipc::cancel_analysis,
            ipc::retry_analysis,
            ipc::discard_session,
            ipc::prepare_aggregate_result,
            ipc::cancel_aggregate_result,
            ipc::commit_worker_result,
            ipc::acknowledge_worker_stop,
            ipc::export_aggregate,
            ipc::request_application_close,
            dataset_transport::open_dataset_stream,
            dataset_transport::receive_dataset_chunk,
            dataset_transport::complete_dataset_stream,
            dataset_transport::cancel_dataset_stream,
            dataset_transport::close_dataset_stream,
        ])
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
