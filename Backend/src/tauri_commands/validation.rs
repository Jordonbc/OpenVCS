use crate::validate;

#[tauri::command]
pub fn validate_git_url(url: String) -> validate::Validation {
    validate::validate_git_url(url)
}

#[tauri::command]
pub fn validate_add_path(path: String) -> validate::Validation {
    validate::validate_add_path(path)
}

#[tauri::command]
pub fn validate_clone_input(url: String, dest: String) -> validate::Validation {
    validate::validate_clone_input(url, dest)
}
