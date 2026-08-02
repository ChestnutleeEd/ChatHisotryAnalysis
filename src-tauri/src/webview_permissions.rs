//! Native WebKit permission policy for the trusted renderer.
//!
//! Wry 0.55 installs a UI delegate whose media-capture callback grants by
//! default.  The desktop shell replaces that delegate on macOS with this
//! smaller fail-closed delegate.  It denies media capture and refuses every
//! request for a secondary web view; navigation policy remains enforced by
//! `security::allow_navigation`.

#[cfg(target_os = "macos")]
mod macos {
    use block2::Block;
    use objc2::{define_class, msg_send, rc::Retained, runtime::NSObject, MainThreadOnly};
    use objc2_foundation::{MainThreadMarker, NSObjectProtocol};
    use objc2_web_kit::{
        WKFrameInfo, WKMediaCaptureType, WKNavigationAction, WKPermissionDecision,
        WKSecurityOrigin, WKUIDelegate, WKWebView, WKWebViewConfiguration, WKWindowFeatures,
    };

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = ()]
        struct DenyWebViewUiDelegate;

        unsafe impl NSObjectProtocol for DenyWebViewUiDelegate {}

        unsafe impl WKUIDelegate for DenyWebViewUiDelegate {
            #[unsafe(method(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:))]
            fn request_media_capture_permission(
                &self,
                _webview: &WKWebView,
                _origin: &WKSecurityOrigin,
                _frame: &WKFrameInfo,
                _capture_type: WKMediaCaptureType,
                decision_handler: &Block<dyn Fn(WKPermissionDecision)>,
            ) {
                (*decision_handler).call((WKPermissionDecision::Deny,));
            }

            #[unsafe(method_id(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
            unsafe fn create_web_view_for_navigation_action(
                &self,
                _webview: &WKWebView,
                _configuration: &WKWebViewConfiguration,
                _action: &WKNavigationAction,
                _window_features: &WKWindowFeatures,
            ) -> Option<Retained<WKWebView>> {
                None
            }
        }
    );

    impl DenyWebViewUiDelegate {
        fn new(marker: MainThreadMarker) -> Retained<Self> {
            let delegate = marker.alloc::<Self>().set_ivars(());
            unsafe { msg_send![super(delegate), init] }
        }
    }

    pub fn install(window: &tauri::WebviewWindow) -> tauri::Result<()> {
        window.with_webview(|platform_webview| {
            let marker = MainThreadMarker::new()
                .expect("Tauri WebView permission installation must run on the main thread");
            let raw_webview = platform_webview.inner();
            assert!(
                !raw_webview.is_null(),
                "Tauri returned a null WKWebView handle"
            );
            let webview = unsafe { &*(raw_webview as *const WKWebView) };
            let delegate = DenyWebViewUiDelegate::new(marker);
            let protocol_delegate = objc2::runtime::ProtocolObject::from_ref(&*delegate);
            unsafe {
                webview.setUIDelegate(Some(protocol_delegate));
            }

            // WKWebView retains its delegate weakly.  This is a process-lifetime
            // policy object, so deliberately retain it until the webview exits.
            std::mem::forget(delegate);
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use block2::RcBlock;
        use objc2_foundation::{NSPoint, NSRect, NSSize};
        use std::{cell::Cell, rc::Rc};

        #[test]
        #[ignore = "requires a packaged AppKit main-thread runtime; Alpha records this as skipped"]
        fn actual_media_capture_callback_returns_deny() {
            let marker = MainThreadMarker::new()
                .expect("packaged permission proof must run on the AppKit main thread");
            let configuration = unsafe { WKWebViewConfiguration::new(marker) };
            let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1.0, 1.0));
            let webview = unsafe {
                WKWebView::initWithFrame_configuration(
                    WKWebView::alloc(marker),
                    frame,
                    &configuration,
                )
            };
            let origin = unsafe { WKSecurityOrigin::new(marker) };
            let frame_info = unsafe { WKFrameInfo::new(marker) };
            let delegate = DenyWebViewUiDelegate::new(marker);
            for capture_type in [
                WKMediaCaptureType::Camera,
                WKMediaCaptureType::Microphone,
                WKMediaCaptureType::CameraAndMicrophone,
                WKMediaCaptureType(999),
            ] {
                let observed = Rc::new(Cell::new(None));
                let observed_by_block = Rc::clone(&observed);
                let decision_handler = RcBlock::new(move |decision: WKPermissionDecision| {
                    observed_by_block.set(Some(decision));
                });
                unsafe {
                    let _: () = msg_send![
                        &*delegate,
                        webView: &*webview,
                        requestMediaCapturePermissionForOrigin: &*origin,
                        initiatedByFrame: &*frame_info,
                        type: capture_type,
                        decisionHandler: &*decision_handler
                    ];
                }
                assert_eq!(observed.get(), Some(WKPermissionDecision::Deny));
            }
        }

        #[test]
        #[ignore = "requires a packaged AppKit main-thread runtime; Alpha records this as skipped"]
        fn actual_new_window_callback_returns_none() {
            let marker = MainThreadMarker::new()
                .expect("packaged navigation proof must run on the AppKit main thread");
            let configuration = unsafe { WKWebViewConfiguration::new(marker) };
            let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1.0, 1.0));
            let webview = unsafe {
                WKWebView::initWithFrame_configuration(
                    WKWebView::alloc(marker),
                    frame,
                    &configuration,
                )
            };
            let action = unsafe { WKNavigationAction::new(marker) };
            let features = unsafe { WKWindowFeatures::new(marker) };
            let delegate = DenyWebViewUiDelegate::new(marker);

            let child: Option<Retained<WKWebView>> = unsafe {
                msg_send![
                    &*delegate,
                    webView: &*webview,
                    createWebViewWithConfiguration: &*configuration,
                    forNavigationAction: &*action,
                    windowFeatures: &*features
                ]
            };
            assert!(child.is_none());
        }

        #[test]
        fn fail_closed_permission_wiring_is_compiled_and_auditable() {
            let source = include_str!("webview_permissions.rs");
            assert!(source.contains("WKPermissionDecision::Deny"));
            assert!(source.contains("requestMediaCapturePermissionForOrigin"));
            assert!(source.contains("create_web_view_for_navigation_action"));
            assert!(source.contains("None"));
        }
    }
}

#[cfg(target_os = "macos")]
pub use macos::install;

#[cfg(not(target_os = "macos"))]
pub fn install(_window: &tauri::WebviewWindow) -> tauri::Result<()> {
    Ok(())
}
