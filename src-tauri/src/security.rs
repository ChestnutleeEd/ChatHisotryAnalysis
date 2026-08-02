//! Renderer boundary policy.  These predicates are deliberately independent
//! of CSP so the native webview remains fail-closed if a page or dropped file
//! attempts to navigate.

pub const MAIN_WINDOW_LABEL: &str = "main";

pub fn trusted_main_window_label(label: &str) -> bool {
    label == MAIN_WINDOW_LABEL
}

pub fn allow_navigation(url: &tauri::Url) -> bool {
    let bundled = url.scheme() == "tauri" && url.host_str() == Some("localhost");
    let development = cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(5173);
    bundled || development
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_declared_main_window_is_trusted() {
        assert!(trusted_main_window_label("main"));
        assert!(!trusted_main_window_label("other"));
        assert!(!trusted_main_window_label("main-evil"));
    }

    #[test]
    fn navigation_policy_rejects_external_file_and_drop_urls() {
        assert!(allow_navigation(
            &"tauri://localhost/index.html".parse().unwrap()
        ));
        assert!(!allow_navigation(
            &"https://example.invalid/".parse().unwrap()
        ));
        assert!(!allow_navigation(
            &"file:///tmp/synthetic.json".parse().unwrap()
        ));
        assert!(!allow_navigation(
            &"chat-analysis-dataset://ses/chunk/1".parse().unwrap()
        ));
    }
}
