//! Validated virtual-monitor resolution.

use crate::protocol::{AttachParams, HelperError, PrepareParams};

/// Smallest and largest resolutions the virtual display drivers accept
/// (Virtual Display Driver's documented limits; macOS and Linux are looser).
pub const MIN_WIDTH: u32 = 640;
pub const MIN_HEIGHT: u32 = 480;
pub const MAX_WIDTH: u32 = 7680;
pub const MAX_HEIGHT: u32 = 4320;
pub const REFRESH_RANGE: std::ops::RangeInclusive<u32> = 24..=240;
pub const SCALE_RANGE: std::ops::RangeInclusive<u32> = 100..=300;
/// Most sizes one `display.prepare` may list. A phone produces 3 streaming split presets x
/// 2 orientations x 2 stream qualities = 12; the Windows elevated step accepts this many per run.
pub const MAX_PREPARE_SIZES: usize = 16;

/// Range and even-dimension checks shared by `display.attach` and `display.prepare`.
fn check_size(width: u32, height: u32) -> Result<(), HelperError> {
    if !(MIN_WIDTH..=MAX_WIDTH).contains(&width) || !(MIN_HEIGHT..=MAX_HEIGHT).contains(&height) {
        return Err(HelperError::invalid_params(format!(
            "{width}x{height} is outside {MIN_WIDTH}x{MIN_HEIGHT}..={MAX_WIDTH}x{MAX_HEIGHT}"
        )));
    }
    // Hardware H.264/H.265 encoders work on 2x2 chroma blocks.
    if !width.is_multiple_of(2) || !height.is_multiple_of(2) {
        return Err(HelperError::invalid_params(format!(
            "{width}x{height} must have even dimensions"
        )));
    }
    Ok(())
}

/// Validates a `display.prepare` list and returns it as `(width, height)` pairs with
/// duplicates removed, in request order. A list with one bad entry is rejected whole, so a
/// backend never acts on part of a request.
pub fn prepare_sizes(params: &PrepareParams) -> Result<Vec<(u32, u32)>, HelperError> {
    if params.sizes.is_empty() {
        return Err(HelperError::invalid_params("no sizes to prepare"));
    }
    if params.sizes.len() > MAX_PREPARE_SIZES {
        return Err(HelperError::invalid_params(format!(
            "at most {MAX_PREPARE_SIZES} sizes per call, got {}",
            params.sizes.len()
        )));
    }
    let mut sizes: Vec<(u32, u32)> = Vec::with_capacity(params.sizes.len());
    for size in &params.sizes {
        check_size(size.width, size.height)?;
        let pair = (size.width, size.height);
        if !sizes.contains(&pair) {
            sizes.push(pair);
        }
    }
    Ok(sizes)
}

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
        check_size(p.width, p.height)?;
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
    use crate::protocol::{DisplaySize, ErrorCode};

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

    fn prepare(sizes: &[(u32, u32)]) -> PrepareParams {
        PrepareParams {
            sizes: sizes
                .iter()
                .map(|&(width, height)| DisplaySize { width, height })
                .collect(),
        }
    }

    #[test]
    fn prepare_keeps_order_and_drops_duplicates() {
        let sizes = prepare_sizes(&prepare(&[
            (1440, 1080),
            (1080, 1440),
            (1440, 1080),
            (2400, 1080),
        ]))
        .unwrap();
        assert_eq!(sizes, vec![(1440, 1080), (1080, 1440), (2400, 1080)]);
    }

    #[test]
    fn prepare_rejects_the_whole_list_for_one_bad_size() {
        for bad in [
            vec![(1440, 1080), (1441, 1080)],
            vec![(1440, 1080), (639, 480)],
            vec![(7682, 1080), (1440, 1080)],
        ] {
            let err = prepare_sizes(&prepare(&bad)).unwrap_err();
            assert_eq!(err.code, ErrorCode::InvalidParams, "{bad:?}");
        }
    }

    #[test]
    fn prepare_needs_between_one_and_the_maximum_sizes() {
        assert!(prepare_sizes(&prepare(&[])).is_err());
        let full: Vec<(u32, u32)> = (0..MAX_PREPARE_SIZES)
            .map(|i| (1280 + 2 * u32::try_from(i).unwrap(), 720))
            .collect();
        assert_eq!(
            prepare_sizes(&prepare(&full)).unwrap().len(),
            MAX_PREPARE_SIZES
        );
        let too_many: Vec<(u32, u32)> = (0..=MAX_PREPARE_SIZES)
            .map(|i| (1280 + 2 * u32::try_from(i).unwrap(), 720))
            .collect();
        assert!(prepare_sizes(&prepare(&too_many)).is_err());
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
