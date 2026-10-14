//! Validated virtual-monitor resolution.

use crate::protocol::{AttachParams, HelperError};

/// Smallest and largest resolutions the virtual display drivers accept
/// (Virtual Display Driver's documented limits; macOS and Linux are looser).
pub const MIN_WIDTH: u32 = 640;
pub const MIN_HEIGHT: u32 = 480;
pub const MAX_WIDTH: u32 = 7680;
pub const MAX_HEIGHT: u32 = 4320;
pub const REFRESH_RANGE: std::ops::RangeInclusive<u32> = 24..=240;
pub const SCALE_RANGE: std::ops::RangeInclusive<u32> = 100..=300;

/// A resolution the helper has checked and is willing to hand to the OS.
///
/// The phone already clamps and rounds its request (see `@shiftpane/layout`); the helper
/// re-checks because it is the side that talks to the driver, and it rejects rather than
/// silently adjusting so a mismatch shows up as an error instead of a blurry stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Mode {
    pub width: u32,
    pub height: u32,
    pub refresh_hz: u32,
    pub scale_percent: Option<u32>,
}

impl TryFrom<AttachParams> for Mode {
    type Error = HelperError;

    fn try_from(p: AttachParams) -> Result<Self, Self::Error> {
        if !(MIN_WIDTH..=MAX_WIDTH).contains(&p.width)
            || !(MIN_HEIGHT..=MAX_HEIGHT).contains(&p.height)
        {
            return Err(HelperError::invalid_params(format!(
                "{}x{} is outside {MIN_WIDTH}x{MIN_HEIGHT}..={MAX_WIDTH}x{MAX_HEIGHT}",
                p.width, p.height
            )));
        }
        // Hardware H.264/H.265 encoders work on 2x2 chroma blocks.
        if !p.width.is_multiple_of(2) || !p.height.is_multiple_of(2) {
            return Err(HelperError::invalid_params(format!(
                "{}x{} must have even dimensions",
                p.width, p.height
            )));
        }
        if !REFRESH_RANGE.contains(&p.refresh_hz) {
            return Err(HelperError::invalid_params(format!(
                "refresh rate {} Hz is out of range",
                p.refresh_hz
            )));
        }
        if let Some(scale) = p.scale_percent
            && !SCALE_RANGE.contains(&scale)
        {
            return Err(HelperError::invalid_params(format!(
                "scale {scale}% is out of range"
            )));
        }
        Ok(Self {
            width: p.width,
            height: p.height,
            refresh_hz: p.refresh_hz,
            scale_percent: p.scale_percent,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::ErrorCode;

    fn params(width: u32, height: u32) -> AttachParams {
        AttachParams {
            width,
            height,
            refresh_hz: 60,
            scale_percent: None,
        }
    }

    #[test]
    fn accepts_phone_split_sizes() {
        let mode = Mode::try_from(params(1440, 1080)).unwrap();
        assert_eq!((mode.width, mode.height), (1440, 1080));
    }

    #[test]
    fn rejects_out_of_range_and_odd_sizes() {
        for (w, h) in [
            (639, 480),
            (640, 479),
            (7682, 1080),
            (1441, 1080),
            (1440, 1081),
        ] {
            let err = Mode::try_from(params(w, h)).unwrap_err();
            assert_eq!(err.code, ErrorCode::InvalidParams, "{w}x{h}");
        }
    }

    #[test]
    fn rejects_bad_refresh_and_scale() {
        assert!(
            Mode::try_from(AttachParams {
                refresh_hz: 1,
                ..params(1280, 720)
            })
            .is_err()
        );
        assert!(
            Mode::try_from(AttachParams {
                scale_percent: Some(50),
                ..params(1280, 720)
            })
            .is_err()
        );
        assert!(
            Mode::try_from(AttachParams {
                scale_percent: Some(150),
                ..params(1280, 720)
            })
            .is_ok()
        );
    }
}
