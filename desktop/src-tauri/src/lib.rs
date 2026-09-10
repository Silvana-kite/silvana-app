#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(installer::Installer::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<installer::Installer>().is_busy() {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            device::device_info,
            device::scan_disks,
            browser::browser_open,
            browser::browser_resize,
            browser::browser_hide,
            browser::browser_action,
            installer::prepare_install,
            installer::start_install,
            installer::get_install_session,
            installer::cancel_install,
            installer::retry_install
        ])
        .run(tauri::generate_context!())
        .expect("error while running Siilvana");
}
mod device;
mod installer;
mod browser;
