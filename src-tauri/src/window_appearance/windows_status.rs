pub fn check_hresult(result: i32) -> Result<(), String> {
    if result >= 0 {
        Ok(())
    } else {
        Err(format!(
            "DwmSetWindowAttribute-failed:0x{:08X}",
            result as u32
        ))
    }
}
pub fn check_bool(result: i32) -> Result<(), String> {
    if result != 0 {
        Ok(())
    } else {
        Err("SetWindowCompositionAttribute-failed".into())
    }
}
pub fn use_dwm(build: u32) -> Result<bool, String> {
    if build >= 22621 {
        Ok(true)
    } else if build >= 17763 {
        Ok(false)
    } else {
        Err("platform-unsupported".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_failed_hresult_for_apply_and_clear() {
        assert!(check_hresult(0).is_ok());
        assert!(check_hresult(1).is_ok());
        assert!(check_hresult(0x80070005u32 as i32).is_err());
    }
    #[test]
    fn rejects_false_composition_result() {
        assert!(check_bool(0).is_err());
        assert!(check_bool(1).is_ok());
    }
    #[test]
    fn selects_supported_acrylic_api() {
        assert!(use_dwm(17762).is_err());
        assert_eq!(use_dwm(17763), Ok(false));
        assert_eq!(use_dwm(22000), Ok(false));
        assert_eq!(use_dwm(22621), Ok(true));
    }
}
