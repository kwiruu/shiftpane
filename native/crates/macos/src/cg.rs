//! The CoreGraphics side of the backend: a `CGVirtualDisplay` and the active display list.
//!
//! `CGVirtualDisplay` and its descriptor, settings and mode classes are not in the public SDK
//! headers, so they are reached through the Objective-C runtime by name, with the property
//! types from their reverse-engineered headers (the ones DeskPad and Chromium's tests use).

use std::ffi::{CStr, CString, c_void};
use std::thread::sleep;
use std::time::{Duration, Instant};

use objc2::encode::{Encode, Encoding};
use objc2::rc::{Allocated, Retained, autoreleasepool};
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{class, msg_send};

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct CGPoint {
    pub x: f64,
    pub y: f64,
}

// SAFETY: the layout matches CoreGraphics' `CGPoint` (two `CGFloat`s, `double` on 64-bit).
unsafe impl Encode for CGPoint {
    const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct CGSize {
    pub width: f64,
    pub height: f64,
}

// SAFETY: the layout matches CoreGraphics' `CGSize`.
unsafe impl Encode for CGSize {
    const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct CGRect {
    pub origin: CGPoint,
    pub size: CGSize,
}

type CGDirectDisplayID = u32;
type CGDisplayModeRef = *mut c_void;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGGetActiveDisplayList(max: u32, displays: *mut CGDirectDisplayID, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: CGDirectDisplayID) -> CGRect;
    fn CGDisplayIsMain(display: CGDirectDisplayID) -> u32;
    fn CGMainDisplayID() -> CGDirectDisplayID;
    fn CGDisplayCopyDisplayMode(display: CGDirectDisplayID) -> CGDisplayModeRef;
    fn CGDisplayModeGetRefreshRate(mode: CGDisplayModeRef) -> f64;
    fn CGDisplayModeGetPixelWidth(mode: CGDisplayModeRef) -> usize;
    fn CGDisplayModeGetPixelHeight(mode: CGDisplayModeRef) -> usize;
    fn CGDisplayModeRelease(mode: CGDisplayModeRef);
}

// libdispatch, part of libSystem.
unsafe extern "C" {
    fn dispatch_get_global_queue(identifier: isize, flags: usize) -> *mut AnyObject;
}

/// A display as the backend reports it: its bounds in pixels, refresh rate and scale.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shown {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub refresh_hz: u32,
    pub scale_factor: f64,
    pub primary: bool,
}

/// Whether this macOS has the `CGVirtualDisplay` classes (macOS 11 and later).
pub fn available() -> bool {
    AnyClass::get(c"CGVirtualDisplay").is_some()
}

fn private_class(name: &CStr) -> Result<&'static AnyClass, String> {
    AnyClass::get(name).ok_or_else(|| format!("{} is missing", name.to_string_lossy()))
}

/// Every display on the desktop, the virtual one included.
pub fn displays() -> Vec<Shown> {
    let mut ids = [0_u32; 32];
    let mut count = 0_u32;
    // SAFETY: the buffer holds as many ids as `max` says; `count` is a valid out-pointer.
    let code = unsafe { CGGetActiveDisplayList(32, ids.as_mut_ptr(), &raw mut count) };
    if code != 0 {
        return Vec::new();
    }
    ids.iter()
        .take(usize::try_from(count).unwrap_or(0))
        .filter_map(|&id| shown(id))
        .collect()
}

/// One display's bounds and mode, or None while macOS hasn't laid it out yet.
pub fn shown(id: u32) -> Option<Shown> {
    // SAFETY: plain value arguments; an unknown id gives an empty rectangle.
    let bounds = unsafe { CGDisplayBounds(id) };
    if bounds.size.width <= 0.0 || bounds.size.height <= 0.0 {
        return None;
    }
    // SAFETY: as above; the mode is released below.
    let mode = unsafe { CGDisplayCopyDisplayMode(id) };
    if mode.is_null() {
        return None;
    }
    // SAFETY: `mode` is a valid display mode until it is released.
    let (hz, pixels_wide, pixels_high) = unsafe {
        (
            CGDisplayModeGetRefreshRate(mode),
            CGDisplayModeGetPixelWidth(mode),
            CGDisplayModeGetPixelHeight(mode),
        )
    };
    // SAFETY: released once, after its last use.
    unsafe { CGDisplayModeRelease(mode) };
    let width = u32::try_from(pixels_wide).unwrap_or(0);
    let height = u32::try_from(pixels_high).unwrap_or(0);
    // The bounds are in points; the mode's pixels over them is the display's scale.
    let scale = if bounds.size.width > 0.0 {
        f64::from(width) / bounds.size.width
    } else {
        1.0
    };
    Some(Shown {
        id,
        x: points_to_pixels(bounds.origin.x, scale),
        y: points_to_pixels(bounds.origin.y, scale),
        width,
        height,
        // A virtual or built-in panel can report 0 Hz; that means 60.
        refresh_hz: if hz > 0.0 { rounded(hz) } else { 60 },
        scale_factor: scale,
        // SAFETY: plain value arguments.
        primary: unsafe { CGDisplayIsMain(id) } != 0 || id == unsafe { CGMainDisplayID() },
    })
}

#[allow(clippy::cast_possible_truncation)]
fn points_to_pixels(points: f64, scale: f64) -> i32 {
    // Display origins are whole points well inside i32.
    (points * scale).round() as i32
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn rounded(hz: f64) -> u32 {
    // A refresh rate is a small positive number.
    hz.round() as u32
}

/// The virtual monitor. It exists exactly as long as this object: dropping it removes it.
#[derive(Debug)]
pub struct VirtualDisplay {
    display: Retained<AnyObject>,
    pub id: u32,
    max: (u32, u32),
}

impl VirtualDisplay {
    /// Creates a virtual monitor that can be up to `width` x `height` pixels, and shows it at
    /// that size.
    pub fn create(width: u32, height: u32, hz: u32, hidpi: bool) -> Result<Self, String> {
        autoreleasepool(|_| {
            let descriptor_class = private_class(c"CGVirtualDisplayDescriptor")?;
            let display_class = private_class(c"CGVirtualDisplay")?;
            // SAFETY: each message below is one the class declares, with the argument and return
            // types of its header; the objects stay alive while they are used.
            unsafe {
                let descriptor: Retained<AnyObject> = msg_send![descriptor_class, new];
                let queue = dispatch_get_global_queue(0, 0);
                let () = msg_send![&*descriptor, setQueue: queue];
                let name = ns_string("ShiftPane")?;
                let () = msg_send![&*descriptor, setName: &*name];
                let () = msg_send![&*descriptor, setMaxPixelsWide: width];
                let () = msg_send![&*descriptor, setMaxPixelsHigh: height];
                // About a 6.5" phone held sideways; macOS uses it for the display's DPI.
                let size = CGSize {
                    width: 150.0,
                    height: 70.0,
                };
                let () = msg_send![&*descriptor, setSizeInMillimeters: size];
                let () = msg_send![&*descriptor, setVendorID: 0x5350_u32];
                let () = msg_send![&*descriptor, setProductID: 0x0001_u32];
                let () = msg_send![&*descriptor, setSerialNum: 0x0001_u32];
                // sRGB primaries and D65 white.
                let () = msg_send![&*descriptor, setRedPrimary: CGPoint { x: 0.6400, y: 0.3300 }];
                let () = msg_send![&*descriptor, setGreenPrimary: CGPoint { x: 0.3000, y: 0.6000 }];
                let () = msg_send![&*descriptor, setBluePrimary: CGPoint { x: 0.1500, y: 0.0600 }];
                let () = msg_send![&*descriptor, setWhitePoint: CGPoint { x: 0.3127, y: 0.3290 }];

                let allocated: Allocated<AnyObject> = msg_send![display_class, alloc];
                let display: Option<Retained<AnyObject>> =
                    msg_send![allocated, initWithDescriptor: &*descriptor];
                let display = display.ok_or("macOS did not create the virtual display")?;
                let id: u32 = msg_send![&*display, displayID];
                let created = Self {
                    display,
                    id,
                    max: (width, height),
                };
                created.apply(width, height, hz, hidpi)?;
                Ok(created)
            }
        })
    }

    /// Whether the monitor can be switched to this size without being made again.
    pub fn fits(&self, width: u32, height: u32) -> bool {
        width <= self.max.0 && height <= self.max.1
    }

    /// Shows the monitor at one mode, and waits for macOS to lay it out.
    pub fn apply(&self, width: u32, height: u32, hz: u32, hidpi: bool) -> Result<Shown, String> {
        autoreleasepool(|_| {
            let settings_class = private_class(c"CGVirtualDisplaySettings")?;
            let mode_class = private_class(c"CGVirtualDisplayMode")?;
            // SAFETY: as in `create`.
            let applied = unsafe {
                let settings: Retained<AnyObject> = msg_send![settings_class, new];
                let () = msg_send![&*settings, setHiDPI: u32::from(hidpi)];
                let allocated: Allocated<AnyObject> = msg_send![mode_class, alloc];
                let mode: Option<Retained<AnyObject>> = msg_send![
                    allocated,
                    initWithWidth: width,
                    height: height,
                    refreshRate: f64::from(hz)
                ];
                let mode = mode.ok_or("macOS did not take the display mode")?;
                let modes: Retained<AnyObject> =
                    msg_send![class!(NSArray), arrayWithObject: &*mode];
                let () = msg_send![&*settings, setModes: &*modes];
                let ok: Bool = msg_send![&*self.display, applySettings: &*settings];
                ok.as_bool()
            };
            if !applied {
                return Err(format!("macOS refused {width}x{height} at {hz} Hz"));
            }
            // HiDPI halves the size in points, so the pixel size is what to wait for.
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                if let Some(shown) =
                    shown(self.id).filter(|s| (s.width, s.height) == (width, height))
                {
                    return Ok(shown);
                }
                if Instant::now() >= deadline {
                    return Err(format!(
                        "macOS did not show the display at {width}x{height}"
                    ));
                }
                sleep(Duration::from_millis(50));
            }
        })
    }
}

fn ns_string(text: &str) -> Result<Retained<AnyObject>, String> {
    let c_text = CString::new(text).map_err(|_| "text with a NUL in it".to_owned())?;
    // SAFETY: a NUL-terminated UTF-8 string; the NSString copies it.
    let string: Option<Retained<AnyObject>> =
        unsafe { msg_send![class!(NSString), stringWithUTF8String: c_text.as_ptr()] };
    string.ok_or_else(|| "NSString refused the text".to_owned())
}
