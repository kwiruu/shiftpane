//! The system media controls (the panel behind the volume flyout): what is playing, and the
//! play/pause, next and previous buttons, through the `WinRT`
//! `GlobalSystemMediaTransportControlsSessionManager`. Works with any app that reports to it:
//! Spotify, browsers, the Media Player app and so on.

use shiftpane_core::protocol::{MediaAction, MediaState, MediaStatus};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::core::Result;

use crate::plan;

/// Longest title, artist or app name passed on; the phone shows one line of each.
const MAX_TEXT_CHARS: usize = 200;

fn current_session() -> Result<Option<Session>> {
    let manager = SessionManager::RequestAsync()?.join()?;
    // No app is playing anything: the call fails rather than returning an empty session.
    Ok(manager.GetCurrentSession().ok())
}

fn text(value: Result<windows::core::HSTRING>) -> Option<String> {
    let value = value.ok()?.to_string_lossy();
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.chars().take(MAX_TEXT_CHARS).collect())
}

pub fn state() -> Result<MediaState> {
    let Some(session) = current_session()? else {
        return Ok(MediaState::none());
    };
    let info = session.GetPlaybackInfo()?;
    let status = match info.PlaybackStatus()? {
        PlaybackStatus::Playing => MediaStatus::Playing,
        PlaybackStatus::Paused => MediaStatus::Paused,
        _ => MediaStatus::Stopped,
    };
    let controls = info.Controls()?;
    let properties = session.TryGetMediaPropertiesAsync()?.join()?;
    Ok(MediaState {
        status,
        title: text(properties.Title()),
        artist: text(properties.Artist()),
        app: text(session.SourceAppUserModelId())
            .and_then(|id| plan::app_name(&id))
            .map(|name| name.chars().take(MAX_TEXT_CHARS).collect()),
        can_play_pause: controls.IsPlayPauseToggleEnabled().unwrap_or(false),
        can_next: controls.IsNextEnabled().unwrap_or(false),
        can_previous: controls.IsPreviousEnabled().unwrap_or(false),
    })
}

/// Presses `action`. `Ok(false)` when nothing is playing or the app refused the button.
pub fn control(action: MediaAction) -> Result<bool> {
    let Some(session) = current_session()? else {
        return Ok(false);
    };
    let pressed = match action {
        MediaAction::PlayPause => session.TryTogglePlayPauseAsync()?,
        MediaAction::Next => session.TrySkipNextAsync()?,
        MediaAction::Previous => session.TrySkipPreviousAsync()?,
    };
    pressed.join()
}
