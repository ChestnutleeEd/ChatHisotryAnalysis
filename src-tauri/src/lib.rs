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
    #[cfg(feature = "packaged-b5-acceptance")]
    if std::env::var_os("CHAT_HISTORY_ANALYSIS_SYNTHETIC_ROOT").is_none() {
        let root = std::env::temp_dir().join("chat-history-analysis-b5-packaged");
        // This branch is compiled only into the synthetic packaged acceptance
        // app. Production builds never create or use this marker root.
        unsafe { std::env::set_var("CHAT_HISTORY_ANALYSIS_SYNTHETIC_ROOT", root) };
    }
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
                if cfg!(feature = "packaged-b6-acceptance")
                    && std::env::var("CHAT_HISTORY_ANALYSIS_SYNTHETIC_B6_MODE").ok().as_deref()
                        != Some("b6")
                {
                    return;
                }
                let b5_mode = if std::env::args().any(|argument| argument == "--b5-off") {
                    "off"
                } else if std::env::var("CHAT_HISTORY_ANALYSIS_SYNTHETIC_B6_MODE")
                    .ok()
                    .as_deref()
                    == Some("b6")
                {
                    "b6"
                } else if std::env::var("CHAT_HISTORY_ANALYSIS_SYNTHETIC_B5_MODE")
                    .ok()
                    .as_deref()
                    == Some("b5")
                {
                    "b5"
                } else if cfg!(feature = "packaged-b5-acceptance") {
                    "b5"
                } else {
                    "off"
                };
                let smoke_script = format!(
                    "window.__CHAT_HISTORY_ANALYSIS_SYNTHETIC_B5_MODE__ = {b5_mode:?};\n{}",
                    r###"(() => {
                      window.__CHAT_HISTORY_ANALYSIS_SYNTHETIC_SMOKE__ = true;
                      const b5AcceptanceMode = window.__CHAT_HISTORY_ANALYSIS_SYNTHETIC_B5_MODE__ ?? "off";
                      const button = (label) => Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(label));
                      const failureCodes = ["SIDECAR_UNAVAILABLE", "SIDECAR_VERIFICATION_FAILED", "SIDECAR_SPAWN_FAILED", "SIDECAR_START_FAILED", "SIDECAR_HANDSHAKE_TIMEOUT", "PREPROCESSING_STALLED", "SIDECAR_PROTOCOL_MISMATCH", "SIDECAR_PROTOCOL_FAILED", "SIDECAR_EXITED", "SIDECAR_EXITED_UNEXPECTEDLY", "SIDECAR_PROTOCOL_INVALID", "SIDECAR_CRASHED", "DATASET_HANDOFF_INVALID", "DATASET_TRANSPORT_INVALID", "WORKER_RUNTIME_FAILED", "WORKER_TIMEOUT", "MEMORY_PRESSURE", "CLEANUP_REQUIRED", "SESSION_CLEANUP_FAILED", "SESSION_STALE", "SELECTION_STALE", "SOURCE_SET_INVALID", "INVALID_REQUEST", "INVALID_STATE"];
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
                          const expectedCount = b5AcceptanceMode === "b6" ? "年度源：3 个" : "年度源：1 个";
                          const count = document.body.textContent?.includes(expectedCount) === true;
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
                        if (b5AcceptanceMode === "b6") {
                          button("选择年度源")?.click();
                          await waitFor(() => {
                            const start = button("开始分析");
                            return document.body.textContent?.includes("年度源：3 个") === true
                              && start !== undefined
                              && !start.disabled;
                          });
                          await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "reselect-ready" });
                          await new Promise((resolve) => window.setTimeout(resolve, 250));
                        }
                        button("开始分析")?.click();
                        await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "retry-start-clicked" });
                        await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_host_state");
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
                          if (b5AcceptanceMode === "b6") {
                            const b6Checkpoint = (checkpoint) => window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint }).catch(() => undefined);
                            const b6WaitFor = (predicate, deadline = Date.now() + 120000) => new Promise((resolve, reject) => {
                              const tick = () => {
                                if (predicate()) { resolve(true); return; }
                                if (Date.now() > deadline) { reject(new Error("b6 packaged vertical timeout")); return; }
                                window.setTimeout(tick, 50);
                              };
                              tick();
                            });
                            await b6Checkpoint("b6-entered");
                            await new Promise((resolve) => window.setTimeout(resolve, 500));
                            await b6WaitFor(() => document.querySelector('select[name="reportRange"]') instanceof HTMLSelectElement
                              && document.querySelector('.beta-report[aria-busy="true"]') === null
                              && betaWordCloudReady());
                            await new Promise((resolve) => window.setTimeout(resolve, 500));
                            await b6WaitFor(() => document.querySelector('select[name="reportRange"]') instanceof HTMLSelectElement
                              && document.querySelector('.beta-report[aria-busy="true"]') === null
                              && betaWordCloudReady());
                            await b6Checkpoint("b6-stable");
                            const b6HiddenReview = document.querySelector(".beta-hidden-word-review");
                            const b6ClearHidden = Array.from(b6HiddenReview?.querySelectorAll("button") ?? [])
                              .find((candidate) => candidate.textContent?.includes("清空自定义隐藏"));
                            if (b6ClearHidden instanceof HTMLButtonElement && !b6ClearHidden.disabled) {
                              b6ClearHidden.click();
                              await b6WaitFor(() => b6ClearHidden.disabled);
                            }
                            const b6SelectRange = async (value, expectedLabel, checkpoint) => {
                              const select = document.querySelector('select[name="reportRange"]');
                              if (!(select instanceof HTMLSelectElement)) throw new Error("b6 report range unavailable");
                              const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
                              if (setter === undefined) throw new Error("b6 report range setter unavailable");
                              select.focus();
                              setter.call(select, value);
                              const reactPropsKey = Object.keys(select).find((key) => key.startsWith("__reactProps$"));
                              const reactProps = reactPropsKey === undefined ? undefined : select[reactPropsKey];
                              if (typeof reactProps?.onChange === "function") {
                                reactProps.onChange({ currentTarget: select, target: select });
                              } else {
                                select.dispatchEvent(new Event("input", { bubbles: true }));
                                select.dispatchEvent(new Event("change", { bubbles: true }));
                              }
                              const expectedKeyword = value.startsWith("year:") ? value.slice(5) : "all-years";
                              const scopeEvidenceReady = () => {
                                const heading = document.querySelector("#beta-report-heading")?.textContent ?? "";
                                const keywordYear = document.querySelector("#distinctive-keywords")?.getAttribute("data-keyword-year") ?? "";
                                const headingMatches = expectedLabel === null ? heading.includes("–") : heading.includes(expectedLabel);
                                return select.value === value
                                  && document.querySelector('.beta-report[aria-busy="true"]') === null
                                  && betaWordCloudReady()
                                  && headingMatches
                                  && keywordYear === expectedKeyword;
                              };
                              await b6WaitFor(() => scopeEvidenceReady());
                              const heading = document.querySelector("#beta-report-heading")?.textContent ?? "";
                              const keywordYear = document.querySelector("#distinctive-keywords")?.getAttribute("data-keyword-year") ?? "";
                              const headingMatches = expectedLabel === null ? heading.includes("–") : heading.includes(expectedLabel);
                              if (!headingMatches || keywordYear !== expectedKeyword) {
                                throw new Error("b6 stale scope evidence");
                              }
                              const trigger = document.querySelector('[data-testid="beta-share-preview-trigger"]');
                              if (!(trigger instanceof HTMLButtonElement)) throw new Error("b6 share trigger unavailable");
                              trigger.click();
                              await b6WaitFor(() => document.querySelector('[data-testid="beta-share-preview-dialog"][data-state="ready"]') !== null
                                && document.querySelector('[data-testid="beta-share-card-preview"][data-render-state="ready"]') !== null);
                              const card = document.querySelector('[data-testid="beta-share-card-preview"]');
                              const cardText = card?.textContent ?? "";
                              if (expectedLabel !== null && !cardText.includes(expectedLabel)) throw new Error("b6 stale share scope evidence");
                              if (expectedLabel === null && !cardText.includes("范围")) throw new Error("b6 all-years share scope evidence");
                              const close = document.querySelector(".beta-share-preview-close");
                              if (!(close instanceof HTMLButtonElement)) throw new Error("b6 share preview close unavailable");
                              close.click();
                              await b6WaitFor(() => document.querySelector('[data-testid="beta-share-preview-dialog"]')?.hasAttribute("open") !== true);
                              await b6Checkpoint(checkpoint);
                            };
                            const reportRange = document.querySelector('select[name="reportRange"]');
                            const yearValues = reportRange instanceof HTMLSelectElement
                              ? Array.from(reportRange.options).map((option) => option.value).filter((value) => value.startsWith("year:"))
                              : [];
                            if (yearValues.length < 3) throw new Error("b6 fixture has fewer than three represented years");
                            await b6SelectRange("all-years", null, "scope-all-initial");
                            await b6SelectRange(yearValues[0], `${yearValues[0].slice(5)} 年`, "scope-year-a");
                            await b6SelectRange(yearValues[1], `${yearValues[1].slice(5)} 年`, "scope-year-b");
                            await b6SelectRange("all-years", null, "scope-all-restored");
                            const requiredScenes = ["opening", "scale-scene", "rhythm-scene", "balance-scene", "conversation-scene", "vocabulary-scene", "summary-share"];
                            await b6WaitFor(() => requiredScenes.every((id) => document.getElementById(id) !== null));
                            await b6WaitFor(() => document.querySelectorAll('input[name="beta-word-metric"]').length >= 2
                              && ["owner", "other", "both"].every((role) => document.querySelector(`input[name="beta-word-role"][value="${role}"]`) instanceof HTMLInputElement));
                            const metricControls = document.querySelectorAll('input[name="beta-word-metric"]');
                            const roleControls = ["owner", "other", "both"].map((role) => document.querySelector(`input[name="beta-word-role"][value="${role}"]`));
                            metricControls[1].click();
                            await b6WaitFor(() => betaWordCloudReady() && (document.querySelector("#word-cloud")?.textContent ?? "").includes("每万词频率"));
                            for (const control of roleControls) {
                              control.click();
                              await b6WaitFor(() => betaWordCloudReady()
                                && control.checked
                                && document.querySelector("#word-cloud")?.getAttribute("data-word-cloud-year") === "all-years"
                                && document.querySelector("#word-cloud")?.getAttribute("data-word-cloud-role") === control.getAttribute("value"));
                            }
                            const b6CleanToggle = () => {
                              const scoped = document.querySelector('.beta-clean-mode-control input[type="checkbox"]');
                              if (scoped instanceof HTMLInputElement) return scoped;
                              return Array.from(document.querySelectorAll('input[type="checkbox"]'))
                                .find((candidate) => candidate.closest('.beta-vocabulary-control-bar') !== null);
                            };
                            await b6WaitFor(() => b6CleanToggle() instanceof HTMLInputElement);
                            const cleanToggle = b6CleanToggle();
                            if (!(cleanToggle instanceof HTMLInputElement)) throw new Error("b6 clean mode unavailable");
                            if (!cleanToggle.checked) {
                              cleanToggle.click();
                              await b6WaitFor(() => {
                                const currentToggle = b6CleanToggle();
                                return currentToggle instanceof HTMLInputElement && currentToggle.checked;
                              });
                            }
                            const wordListDisclosure = document.querySelector('[data-testid="beta-word-cloud-list-disclosure"]');
                            if (!(wordListDisclosure instanceof HTMLDetailsElement)) throw new Error("b6 word list disclosure unavailable");
                            wordListDisclosure.open = true;
                            await b6WaitFor(() => (document.querySelector("#word-cloud .beta-word-cloud-list")?.textContent ?? "").includes("合成词"));
                            const hiddenDetails = document.querySelector(".beta-hidden-word-review");
                            hiddenDetails?.querySelector("summary")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                            const hiddenInput = hiddenDetails?.querySelector("textarea");
                            if (!(hiddenInput instanceof HTMLTextAreaElement)) throw new Error("b6 hidden-word editor unavailable");
                            const hiddenSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
                            if (hiddenSetter === undefined) throw new Error("b6 hidden-word setter unavailable");
                            hiddenSetter.call(hiddenInput, "合成词");
                            hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
                            const addHidden = Array.from(hiddenDetails?.querySelectorAll("button") ?? []).find((candidate) => candidate.textContent?.includes("添加隐藏词"));
                            if (!(addHidden instanceof HTMLButtonElement)) throw new Error("b6 hidden-word action unavailable");
                            addHidden.click();
                            await b6WaitFor(() => !(document.querySelector("#word-cloud .beta-word-cloud-list")?.textContent ?? "").includes("合成词"));
                            await b6Checkpoint("custom-hidden-ready");
                            const hiddenShareTrigger = document.querySelector('[data-testid="beta-share-preview-trigger"]');
                            if (!(hiddenShareTrigger instanceof HTMLButtonElement)) throw new Error("b6 hidden share trigger unavailable");
                            hiddenShareTrigger.click();
                            await b6WaitFor(() => document.querySelector('[data-testid="beta-share-preview-dialog"][data-state="ready"]') !== null);
                            const hiddenCard = document.querySelector('[data-testid="beta-share-card-preview"]');
                            if ((hiddenCard?.textContent ?? "").includes("合成词")) throw new Error("b6 hidden word returned in share card");
                            const includeVocabulary = document.querySelector('input[name="includeVocabulary"]');
                            if (includeVocabulary instanceof HTMLInputElement && !includeVocabulary.checked && !includeVocabulary.disabled) includeVocabulary.click();
                            await b6WaitFor(() => document.querySelector('[data-testid="beta-share-preview-dialog"][data-vocabulary="on"]') !== null);
                            if ((document.querySelector('[data-testid="beta-share-card-preview"]')?.textContent ?? "").includes("合成词")) throw new Error("b6 hidden word returned with vocabulary opt-in");
                            const hiddenShareClose = document.querySelector(".beta-share-preview-close");
                            if (!(hiddenShareClose instanceof HTMLButtonElement)) throw new Error("b6 hidden share preview close unavailable");
                            hiddenShareClose.click();
                            await b6WaitFor(() => document.querySelector('[data-testid="beta-share-preview-dialog"]')?.hasAttribute("open") !== true);
                            const detailedButton = button("进入详细分析");
                            if (detailedButton === undefined) throw new Error("b6 detailed entry unavailable");
                            detailedButton.click();
                            await b6WaitFor(() => document.querySelector(".dashboard-shell") !== null);
                            await b6Checkpoint("detailed-ready");
                            const appliedSummary = document.querySelector(".dashboard-applied-summary")?.textContent ?? "";
                            const startDate = document.querySelector('input[name="startDate"]');
                            if (!(startDate instanceof HTMLInputElement)) throw new Error("b6 detailed draft unavailable");
                            const dateSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
                            if (dateSetter === undefined) throw new Error("b6 detailed date setter unavailable");
                            dateSetter.call(startDate, "2024-01-01");
                            startDate.dispatchEvent(new Event("input", { bubbles: true }));
                            startDate.dispatchEvent(new Event("change", { bubbles: true }));
                            const applyButton = button("应用筛选");
                            await b6WaitFor(() => applyButton !== undefined && !applyButton.disabled);
                            if ((document.querySelector(".dashboard-applied-summary")?.textContent ?? "") !== appliedSummary || document.querySelector(".dashboard-pending") !== null) throw new Error("b6 detailed draft recomputed early");
                            await b6Checkpoint("detailed-draft-ready");
                            applyButton?.click();
                            await b6WaitFor(() => button("应用筛选")?.disabled === true && document.querySelector(".dashboard-pending") === null);
                            if (!(document.querySelector(".dashboard-applied-summary")?.textContent ?? "").includes("2024-01-01")) throw new Error("b6 detailed apply did not commit");
                            await b6Checkpoint("detailed-apply-ready");
                            const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
                            if (tabs.length !== 8) throw new Error("b6 detailed route count changed");
                            for (const tab of tabs) {
                              if (!(tab instanceof HTMLButtonElement)) throw new Error("b6 detailed route control invalid");
                              tab.click();
                              await b6WaitFor(() => tab.getAttribute("aria-selected") === "true" && (document.querySelector('[role="tabpanel"]')?.textContent ?? "").trim().length > 0);
                            }
                            await b6Checkpoint("detailed-routes-ready");
                            const exportTab = tabs.find((tab) => tab.textContent?.includes("导出"));
                            exportTab?.click();
                            await b6WaitFor(() => button("导出聚合 JSON") !== undefined);
                            await b6Checkpoint("aggregate-export-requested");
                            button("导出聚合 JSON")?.click();
                            await b6WaitFor(() => document.body.textContent?.includes("聚合结果已通过本地保存流程写入。") === true || document.body.textContent?.includes("导出失败") === true);
                            if (document.body.textContent?.includes("聚合结果已通过本地保存流程写入。") !== true) throw new Error("b6 aggregate export failed");
                            await b6Checkpoint("aggregate-export-success");
                            button("年度回顾")?.click();
                            await b6WaitFor(() => betaAnnualRecap() !== null);
                            await b6Checkpoint("b6-pre-share-ready");
                          }
                          if (b5AcceptanceMode === "b5" || b5AcceptanceMode === "b6") {
                            const shareTrigger = document.querySelector('[data-testid="beta-share-preview-trigger"]');
                            if (shareTrigger === null) throw new Error("share preview trigger unavailable");
                            shareTrigger.click();
                            await waitFor(() => {
                              const dialog = document.querySelector('[data-testid="beta-share-preview-dialog"][data-state="ready"]');
                              const card = dialog?.querySelector('[data-testid="beta-share-card-preview"][data-render-state="ready"]');
                              return dialog !== null && card !== null;
                            });
                            await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "share-preview-ready" });
                            const offCard = document.querySelector('[data-testid="beta-share-card-preview"]');
                            const offDigest = offCard?.getAttribute("data-rgba-digest") ?? "";
                            await window.__TAURI_INTERNALS__.invoke("record_b5_render_evidence", {
                              mode: "off",
                              digest: offCard?.getAttribute("data-rgba-digest") ?? "",
                              width: Number(offCard?.getAttribute("data-png-width") ?? "0"),
                              height: Number(offCard?.getAttribute("data-png-height") ?? "0"),
                              bytes: Number(offCard?.getAttribute("data-png-size") ?? "0"),
                              alpha: offCard?.getAttribute("data-alpha") === "255",
                              artwork: offCard?.getAttribute("data-artwork-state") ?? "",
                              font: offCard?.getAttribute("data-font-mode") ?? "",
                              forbidden: offCard?.getAttribute("data-png-forbidden-chunks") ?? "",
                            });
                            await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "native-cancel-requested" });
                            const saveButton = () => document.querySelector('[data-testid="beta-share-preview-save"]');
                            saveButton()?.click();
                            await waitFor(() => document.querySelector('[data-testid="beta-share-preview-dialog"]')?.getAttribute("data-save-state") === "cancelled");
                            await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "native-cancelled" });
                            await waitFor(() => document.querySelector('[data-testid="beta-share-preview-dialog"]')?.getAttribute("data-save-state") === "ready");
                            const vocabularyToggle = document.querySelector('input[name="includeVocabulary"]');
                            if (vocabularyToggle instanceof HTMLInputElement && !vocabularyToggle.checked && !vocabularyToggle.disabled) {
                              vocabularyToggle.click();
                            }
                            await waitFor(() => {
                              const dialog = document.querySelector('[data-testid="beta-share-preview-dialog"][data-vocabulary="on"]');
                              const card = dialog?.querySelector('[data-testid="beta-share-card-preview"][data-render-state="ready"]');
                              const digest = card?.getAttribute("data-rgba-digest") ?? "";
                              return dialog !== null && card !== null && digest.length === 64 && digest !== offDigest;
                            });
                            await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "vocabulary-on" });
                            const onCard = document.querySelector('[data-testid="beta-share-card-preview"]');
                            await window.__TAURI_INTERNALS__.invoke("record_b5_render_evidence", {
                              mode: "on",
                              digest: onCard?.getAttribute("data-rgba-digest") ?? "",
                              width: Number(onCard?.getAttribute("data-png-width") ?? "0"),
                              height: Number(onCard?.getAttribute("data-png-height") ?? "0"),
                              bytes: Number(onCard?.getAttribute("data-png-size") ?? "0"),
                              alpha: onCard?.getAttribute("data-alpha") === "255",
                              artwork: onCard?.getAttribute("data-artwork-state") ?? "",
                              font: onCard?.getAttribute("data-font-mode") ?? "",
                              forbidden: onCard?.getAttribute("data-png-forbidden-chunks") ?? "",
                            });
                            await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "native-save-requested" });
                            await waitFor(() => {
                              const button = saveButton();
                              return button instanceof HTMLButtonElement && !button.disabled;
                            });
                            saveButton()?.click();
                            await waitFor(() => {
                              const dialog = document.querySelector('[data-testid="beta-share-preview-dialog"]');
                              const state = dialog?.getAttribute("data-save-state");
                              return state === "saved" || state === "failed";
                            });
                            if (document.querySelector('[data-testid="beta-share-preview-dialog"]')?.getAttribute("data-save-state") === "failed") {
                              throw new Error("packaged native save failed");
                            }
                            await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "native-save-success" });
                            if (vocabularyToggle instanceof HTMLInputElement && vocabularyToggle.checked) {
                              vocabularyToggle.click();
                            }
                            await waitFor(() => {
                              const dialog = document.querySelector('[data-testid="beta-share-preview-dialog"][data-vocabulary="off"]');
                              const card = dialog?.querySelector('[data-testid="beta-share-card-preview"][data-render-state="ready"]');
                              const digest = card?.getAttribute("data-rgba-digest") ?? "";
                              const button = saveButton();
                              return dialog !== null
                                && card !== null
                                && digest === offDigest
                                && dialog.getAttribute("data-save-state") === "ready"
                                && button instanceof HTMLButtonElement
                                && !button.disabled;
                            });
                            await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "native-save-retry-requested" });
                            saveButton()?.click();
                            await waitFor(() => document.querySelector('[data-testid="beta-share-preview-dialog"]')?.getAttribute("data-save-state") === "saved");
                            await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "native-save-retry-success" });
                            await waitFor(() => {
                              const dialog = document.querySelector('[data-testid="beta-share-preview-dialog"]');
                              const close = document.querySelector('.beta-share-preview-close');
                              return dialog?.getAttribute("data-save-state") === "saved"
                                && dialog?.getAttribute("aria-busy") === "false"
                                && close instanceof HTMLButtonElement
                                && !close.disabled;
                            });
                            const closePreviewButton = document.querySelector('.beta-share-preview-close');
                            if (!(closePreviewButton instanceof HTMLButtonElement)) throw new Error("share preview close button unavailable");
                            closePreviewButton.click();
                            await waitFor(() => {
                              const dialog = document.querySelector('[data-testid="beta-share-preview-dialog"]');
                              return dialog === null || (dialog instanceof HTMLDialogElement && !dialog.open);
                            });
                            await window.__TAURI_INTERNALS__.invoke("record_selection_smoke_checkpoint", { checkpoint: "share-preview-closed" });
                          }
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
                    })()"###,
                );
                let _ = webview.eval(smoke_script);
            }
        });
    #[cfg(feature = "synthetic-dialog-adapter")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        ipc::select_annual_sources,
        ipc::select_verification_sources,
        ipc::record_selection_smoke,
        ipc::record_selection_smoke_checkpoint,
        ipc::record_selection_smoke_host_state,
        ipc::record_b5_render_evidence,
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
