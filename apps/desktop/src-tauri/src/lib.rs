use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, State,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";
const TRAY_ID: &str = "inkade-tray";
const TRAY_MENU_SHOW: &str = "tray_show_main";
const TRAY_MENU_CAPTURE: &str = "tray_quick_capture";
const TRAY_MENU_WAITING: &str = "tray_waiting_status";
const TRAY_MENU_QUIT: &str = "tray_quit";

pub struct DesktopShellState {
    pub active_shortcut: Mutex<String>,
    pub waiting_count: Mutex<u32>,
    pub waiting_item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

impl Default for DesktopShellState {
    fn default() -> Self {
        Self {
            active_shortcut: Mutex::new(DEFAULT_SHORTCUT.to_string()),
            waiting_count: Mutex::new(0),
            waiting_item: Mutex::new(None),
        }
    }
}

fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn toggle_quick_capture_inner<R: Runtime>(app: &AppHandle<R>, forced: Option<bool>) -> bool {
    let Some(window) = app.get_webview_window("quick-capture") else {
        return false;
    };
    let is_visible = window.is_visible().unwrap_or(false);
    let target_visible = forced.unwrap_or(!is_visible);

    if target_visible {
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let _ = window.hide();
    }
    target_visible
}

fn dispatch_deep_link<R: Runtime>(app: &AppHandle<R>, raw_url: &str) {
    focus_main_window(app);
    let _ = app.emit("inkade://deep-link", raw_url.to_string());
}

#[tauri::command]
fn toggle_quick_capture(app: AppHandle, visible: Option<bool>) -> bool {
    toggle_quick_capture_inner(&app, visible)
}

#[tauri::command]
fn navigate_main_window(app: AppHandle, path: String) {
    focus_main_window(&app);
    let _ = app.emit("inkade://navigate", path);
}

#[tauri::command]
fn update_tray_attention(
    app: AppHandle,
    state: State<'_, DesktopShellState>,
    waiting_count: u32,
) -> Result<(), String> {
    if let Ok(mut guard) = state.waiting_count.lock() {
        *guard = waiting_count;
    }

    if let Ok(guard) = state.waiting_item.lock() {
        if let Some(item) = guard.as_ref() {
            item.set_text(format!("Waiting Input: {waiting_count}"))
                .map_err(|err| err.to_string())?;
        }
    }

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let tooltip = if waiting_count > 0 {
            format!("Inkade · {waiting_count} waiting input")
        } else {
            "Inkade".to_string()
        };
        let _ = tray.set_tooltip(Some(tooltip));
        #[cfg(target_os = "macos")]
        {
            let title = if waiting_count > 99 {
                Some("99+".to_string())
            } else if waiting_count > 0 {
                Some(waiting_count.to_string())
            } else {
                None
            };
            let _ = tray.set_title(title);
        }
    }

    Ok(())
}

#[tauri::command]
fn send_desktop_notification(
    app: AppHandle,
    title: String,
    body: String,
    deep_link: Option<String>,
) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|err| err.to_string())?;

    if let Some(link) = deep_link {
        let _ = app.emit("inkade://notification-dispatched", link);
    }
    Ok(())
}

#[tauri::command]
fn register_quick_capture_shortcut(
    app: AppHandle,
    state: State<'_, DesktopShellState>,
    accelerator: String,
) -> Result<(), String> {
    let next_shortcut: Shortcut = accelerator
        .parse()
        .map_err(|err| format!("Invalid shortcut '{accelerator}': {err}"))?;

    if let Ok(mut guard) = state.active_shortcut.lock() {
        if let Ok(prev) = guard.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(prev);
        }
        *guard = accelerator;
    }

    app.global_shortcut()
        .register(next_shortcut)
        .map_err(|err| err.to_string())
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, TRAY_MENU_SHOW, "Show Inkade", true, None::<&str>)?;
    let capture_item = MenuItem::with_id(
        app,
        TRAY_MENU_CAPTURE,
        "Quick Capture",
        true,
        Some(DEFAULT_SHORTCUT),
    )?;
    let waiting_item =
        MenuItem::with_id(app, TRAY_MENU_WAITING, "Waiting Input: 0", false, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, TRAY_MENU_QUIT, "Quit Inkade", true, None::<&str>)?;

    if let Some(state) = app.try_state::<DesktopShellState>() {
        if let Ok(mut guard) = state.waiting_item.lock() {
            *guard = Some(waiting_item.clone());
        }
    }

    let menu = Menu::with_items(
        app,
        &[&show_item, &capture_item, &waiting_item, &sep, &quit_item],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Inkade")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            TRAY_MENU_SHOW => focus_main_window(app),
            TRAY_MENU_CAPTURE => {
                toggle_quick_capture_inner(app, Some(true));
            }
            TRAY_MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DesktopShellState::default())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            focus_main_window(app);
            for arg in argv {
                if arg.starts_with("inkade://") {
                    dispatch_deep_link(app, &arg);
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_quick_capture_inner(app, None);
                    }
                })
                .build(),
        )
        .setup(|app| {
            setup_tray(app)?;

            let default_shortcut: Shortcut = DEFAULT_SHORTCUT
                .parse()
                .map_err(|err| format!("Failed to parse default shortcut: {err}"))?;
            let _ = app.global_shortcut().register(default_shortcut);

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    dispatch_deep_link(&handle, url.as_str());
                }
            });

            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    dispatch_deep_link(app.handle(), url.as_str());
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            toggle_quick_capture,
            navigate_main_window,
            update_tray_attention,
            send_desktop_notification,
            register_quick_capture_shortcut,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Inkade desktop shell");
}
