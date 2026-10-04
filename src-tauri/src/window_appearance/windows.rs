//! Acrylic with checked system return values. window-vibrancy 0.6 ignores
//! these results on Windows, which prevents a reliable solid fallback.
use super::windows_status::{check_bool, check_hresult, use_dwm};
use std::ffi::c_void;
use std::mem::size_of;
use windows_sys::Win32::{
    Foundation::{BOOL, HWND},
    Graphics::Dwm::DwmSetWindowAttribute,
    System::LibraryLoader::{GetModuleHandleW, GetProcAddress},
};

#[repr(C)]
struct AccentPolicy {
    state: i32,
    flags: u32,
    color: u32,
    animation: u32,
}

#[repr(C)]
struct CompositionData {
    attribute: i32,
    data: *mut c_void,
    size: usize,
}

pub(super) fn set_acrylic(hwnd: HWND, enabled: bool) -> Result<(), String> {
    if use_dwm(windows_version::OsVersion::current().build)? {
        // Windows 11 22H2+: SYSTEMBACKDROP_TYPE (38), transient Acrylic (3)
        // or disabled (1). A failing HRESULT must reach the frontend.
        let value: i32 = if enabled { 3 } else { 1 };
        let result = unsafe {
            DwmSetWindowAttribute(hwnd, 38, &value as *const _ as _, size_of::<i32>() as u32)
        };
        return check_hresult(result);
    }

    // Windows 10 1809 and early Windows 11 use the legacy composition API.
    // user32 is loaded by the window runtime; GetModuleHandle adds no refcount.
    let module_name: Vec<u16> = "user32.dll\0".encode_utf16().collect();
    let module = unsafe { GetModuleHandleW(module_name.as_ptr()) };
    if module.is_null() {
        return Err("acrylic-library-unavailable".into());
    }
    let proc = unsafe { GetProcAddress(module, b"SetWindowCompositionAttribute\0".as_ptr()) }
        .ok_or("acrylic-api-unavailable")?;
    type SetComposition = unsafe extern "system" fn(HWND, *mut CompositionData) -> BOOL;
    // SAFETY: this export has the HWND, WINDOWCOMPOSITIONATTRIBDATA -> BOOL
    // ABI. Both repr(C) records and their pointed data live through the call.
    let set_composition: SetComposition = unsafe { std::mem::transmute(proc) };
    let mut policy = AccentPolicy {
        state: if enabled { 4 } else { 0 },
        flags: 0,
        // Legacy Acrylic needs nonzero alpha. Frontend owns the base tint.
        color: if enabled { 0x01000000 } else { 0 },
        animation: 0,
    };
    let mut data = CompositionData {
        attribute: 19,
        data: &mut policy as *mut _ as _,
        size: size_of::<AccentPolicy>(),
    };
    check_bool(unsafe { set_composition(hwnd, &mut data) })
}
