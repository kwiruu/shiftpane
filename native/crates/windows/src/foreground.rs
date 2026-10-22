//! The app in front and its window title, for the active-window source. A widget gets this only
//! when its manifest declares that source and the user agreed to it when installing.

use std::ffi::c_void;
use std::ptr::null_mut;

use shiftpane_core::protocol::ActiveWindow;
use windows_sys::Win32::Foundation::CloseHandle;
use windows_sys::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
};

use crate::plan;
use crate::stats::to_wide;

/// Longest app name or title passed on; a widget shows one line of each.
const MAX_TEXT_CHARS: usize = 200;

pub fn active() -> ActiveWindow {
    // SAFETY: no arguments; may return null when no window is in front.
    let window = unsafe { GetForegroundWindow() };
    if window.is_null() {
        return ActiveWindow::default();
    }
    let mut pid = 0_u32;
    // SAFETY: `window` is a window handle (it may have closed since; the call then fails).
    unsafe { GetWindowThreadProcessId(window, &raw mut pid) };
    let path = image_path(pid);
    let app = path
        .as_deref()
        .and_then(|path| plan::exe_app_name(path, file_description(path).as_deref()));
    ActiveWindow {
        app: app.as_deref().map(short),
        title: title(window).as_deref().map(short),
    }
}

fn short(text: &str) -> String {
    text.chars().take(MAX_TEXT_CHARS).collect()
}

fn title(window: *mut c_void) -> Option<String> {
    // SAFETY: `window` is a window handle; a stale one reads as an empty title.
    let length = unsafe { GetWindowTextLengthW(window) };
    let capacity = usize::try_from(length).ok()?.checked_add(1)?;
    let mut buffer = vec![0_u16; capacity];
    // SAFETY: `buffer` holds `capacity` UTF-16 units.
    let copied =
        unsafe { GetWindowTextW(window, buffer.as_mut_ptr(), i32::try_from(capacity).ok()?) };
    let text = String::from_utf16_lossy(&buffer[..usize::try_from(copied).ok()?]);
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

fn image_path(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    // SAFETY: asks only for what the limited-information right allows.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return None;
    }
    let mut buffer = vec![0_u16; 1024];
    let mut size = u32::try_from(buffer.len()).unwrap_or(0);
    // SAFETY: `buffer` holds `size` units; `process` was opened above.
    let ok = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            buffer.as_mut_ptr(),
            &raw mut size,
        )
    };
    // SAFETY: closes the handle opened above, once.
    unsafe { CloseHandle(process) };
    (ok != 0).then(|| String::from_utf16_lossy(&buffer[..usize::try_from(size).unwrap_or(0)]))
}

/// The executable's file description ("Visual Studio Code"), from its version resource.
fn file_description(path: &str) -> Option<String> {
    let wide = to_wide(path);
    // SAFETY: `wide` is NUL-terminated; the handle argument may be null.
    let size = unsafe { GetFileVersionInfoSizeW(wide.as_ptr(), null_mut()) };
    if size == 0 {
        return None;
    }
    let mut data = vec![0_u8; usize::try_from(size).ok()?];
    // SAFETY: `data` holds `size` bytes.
    if unsafe { GetFileVersionInfoW(wide.as_ptr(), 0, size, data.as_mut_ptr().cast()) } == 0 {
        return None;
    }
    let language = query(&data, r"\VarFileInfo\Translation").and_then(|(pointer, bytes)| {
        (bytes >= 4).then(|| {
            // SAFETY: the translation table holds at least one (language, code page) pair.
            unsafe {
                let pair = pointer.cast::<u16>();
                (*pair, *pair.add(1))
            }
        })
    });
    let tables = language
        .map(|(lang, page)| format!("{lang:04x}{page:04x}"))
        .into_iter()
        .chain(["040904b0".to_owned(), "040904e4".to_owned()]);
    for table in tables {
        if let Some((pointer, chars)) =
            query(&data, &format!(r"\StringFileInfo\{table}\FileDescription"))
        {
            // SAFETY: a string value is `chars` UTF-16 units, the last one NUL, inside `data`.
            let text = unsafe {
                std::slice::from_raw_parts(pointer.cast::<u16>(), usize::try_from(chars).ok()?)
            };
            let text = String::from_utf16_lossy(text);
            let trimmed = text.trim_end_matches('\0').trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_owned());
            }
        }
    }
    None
}

/// A value from a version resource: where it is in `data` and its length.
fn query(data: &[u8], path: &str) -> Option<(*const c_void, u32)> {
    let wide = to_wide(path);
    let mut pointer: *mut c_void = null_mut();
    let mut length = 0_u32;
    // SAFETY: `data` is a version resource read by GetFileVersionInfoW; `wide` is NUL-terminated.
    let ok = unsafe {
        VerQueryValueW(
            data.as_ptr().cast(),
            wide.as_ptr(),
            &raw mut pointer,
            &raw mut length,
        )
    };
    (ok != 0 && !pointer.is_null() && length > 0).then_some((pointer.cast_const(), length))
}
