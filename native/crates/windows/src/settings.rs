//! Reading and editing the driver's `vdd_settings.xml`.
//!
//! The file is small and has a fixed shape, and the driver ships it with many explanatory
//! comments. Parsing and re-serialising it would drop those, so this module scans for the one
//! list it cares about (`<resolutions>`) and inserts text next to it, leaving every other byte
//! alone. It is pure string handling so it is tested on every OS.

use std::fmt::{self, Write as _};

/// Refresh rate written for a new resolution. The driver multiplies every resolution by the
/// file's global `<g_refresh_rate>` list, so this is only the base entry (the stock list uses 30).
pub const NEW_ENTRY_REFRESH_HZ: u32 = 30;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsError {
    /// The document has no `<resolutions>...</resolutions>` element to add modes to.
    MissingResolutionsSection,
}

impl fmt::Display for SettingsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingResolutionsSection => {
                f.write_str("vdd_settings.xml has no <resolutions> section")
            }
        }
    }
}

impl std::error::Error for SettingsError {}

/// Blanks out XML comments so tag searches skip them. Byte offsets stay valid: every
/// character is replaced by as many spaces as it has UTF-8 bytes, and line breaks are kept.
fn mask_comments(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len());
    let mut rest = xml;
    while let Some(start) = rest.find("<!--") {
        out.push_str(&rest[..start]);
        let end = rest[start..]
            .find("-->")
            .map_or(rest.len(), |len| start + len + 3);
        for c in rest[start..end].chars() {
            if c == '\n' || c == '\r' {
                out.push(c);
            } else {
                out.extend(std::iter::repeat_n(' ', c.len_utf8()));
            }
        }
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

/// Byte range of the text between `<resolutions>` and `</resolutions>` in a masked document,
/// plus where the closing tag starts.
fn resolutions_span(masked: &str) -> Option<(usize, usize)> {
    const OPEN: &str = "<resolutions>";
    const CLOSE: &str = "</resolutions>";
    let open = masked.find(OPEN)? + OPEN.len();
    let close = open + masked[open..].find(CLOSE)?;
    Some((open, close))
}

/// The text inside `<tag>...</tag>` within `block`, trimmed.
fn tag_text<'a>(block: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = block.find(&open)? + open.len();
    let end = start + block[start..].find(&close)?;
    Some(block[start..end].trim())
}

/// Every `(width, height)` the file lists, ignoring commented-out entries.
pub fn listed_resolutions(xml: &str) -> Vec<(u32, u32)> {
    let masked = mask_comments(xml);
    let Some((start, end)) = resolutions_span(&masked) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    let mut rest = &masked[start..end];
    while let Some(open) = rest.find("<resolution>") {
        let after = &rest[open + "<resolution>".len()..];
        let Some(close) = after.find("</resolution>") else {
            break;
        };
        let block = &after[..close];
        let width = tag_text(block, "width").and_then(|t| t.parse::<u32>().ok());
        let height = tag_text(block, "height").and_then(|t| t.parse::<u32>().ok());
        if let (Some(width), Some(height)) = (width, height) {
            found.push((width, height));
        }
        rest = &after[close + "</resolution>".len()..];
    }
    found
}

/// Returns the document with every size in `wanted` that it does not list yet appended to the
/// resolution list, or `None` when nothing was missing. Calling it again with its own output
/// returns `None`, so repeated attaches never pile up duplicates.
pub fn with_modes(xml: &str, wanted: &[(u32, u32)]) -> Result<Option<String>, SettingsError> {
    let masked = mask_comments(xml);
    let (_, close) = resolutions_span(&masked).ok_or(SettingsError::MissingResolutionsSection)?;

    let present = listed_resolutions(xml);
    let mut missing: Vec<(u32, u32)> = Vec::new();
    for &size in wanted {
        if !present.contains(&size) && !missing.contains(&size) {
            missing.push(size);
        }
    }
    if missing.is_empty() {
        return Ok(None);
    }

    let eol = if xml.contains("\r\n") { "\r\n" } else { "\n" };
    let line_start = xml[..close].rfind('\n').map_or(0, |i| i + 1);
    let before_close = &xml[line_start..close];
    let closing_alone = before_close.trim().is_empty();
    let base_indent: String = before_close
        .chars()
        .take_while(|c| c.is_whitespace())
        .collect();
    let entry_indent = format!("{base_indent}    ");
    let field_indent = format!("{entry_indent}    ");

    let mut block = String::new();
    if !closing_alone {
        block.push_str(eol);
    }
    for (width, height) in missing {
        // Writing to a String cannot fail.
        let _ = write!(
            block,
            "{entry_indent}<resolution>{eol}\
             {field_indent}<width>{width}</width>{eol}\
             {field_indent}<height>{height}</height>{eol}\
             {field_indent}<refresh_rate>{NEW_ENTRY_REFRESH_HZ}</refresh_rate>{eol}\
             {entry_indent}</resolution>{eol}"
        );
    }

    let insert_at = if closing_alone { line_start } else { close };
    let mut out = String::with_capacity(xml.len() + block.len() + base_indent.len());
    out.push_str(&xml[..insert_at]);
    out.push_str(&block);
    if !closing_alone {
        out.push_str(&base_indent);
    }
    out.push_str(&xml[insert_at..]);
    Ok(Some(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The file the driver ships, trimmed to what matters here (comments included).
    const STOCK: &str = "<?xml version='1.0' encoding='utf-8'?>
<vdd_settings>
    <monitors>
        <count>1</count>
    </monitors>
	<global>
		<!--These are global refreshrates, any you add in here, will be replicated to all resolutions-->
		<g_refresh_rate>60</g_refresh_rate>
	</global>
    <resolutions>
        <resolution>
            <width>800</width>
            <height>600</height>
            <refresh_rate>30</refresh_rate>
        </resolution>
        <resolution>
            <width>1920</width>
            <height>1080</height>
            <refresh_rate>30</refresh_rate>
        </resolution>


    </resolutions>
    <options>
		<HDRPlus>false</HDRPlus> <!-- conflict because there\u{2019}s no 12-bit and 10-bit at once -->
	</options>
</vdd_settings>
";

    #[test]
    fn lists_the_stock_resolutions() {
        assert_eq!(listed_resolutions(STOCK), vec![(800, 600), (1920, 1080)]);
    }

    #[test]
    fn adds_a_mode_and_keeps_everything_else() {
        let out = with_modes(STOCK, &[(1440, 1080)]).unwrap().unwrap();
        assert_eq!(
            listed_resolutions(&out),
            vec![(800, 600), (1920, 1080), (1440, 1080)]
        );
        // Comments and unrelated settings survive byte for byte.
        assert!(out.contains("<!--These are global refreshrates"));
        assert!(out.contains("there\u{2019}s no 12-bit"));
        assert!(out.contains("<g_refresh_rate>60</g_refresh_rate>"));
        // The new entry sits before the closing tag, indented like its siblings.
        assert!(out.contains(
            "        <resolution>\n            <width>1440</width>\n            <height>1080</height>"
        ));
        assert!(out.find("<width>1440</width>").unwrap() < out.find("</resolutions>").unwrap());
    }

    #[test]
    fn is_idempotent() {
        let once = with_modes(STOCK, &[(1440, 1080)]).unwrap().unwrap();
        assert_eq!(with_modes(&once, &[(1440, 1080)]).unwrap(), None);
        // A size the stock file already has is not added either.
        assert_eq!(with_modes(STOCK, &[(1920, 1080)]).unwrap(), None);
    }

    #[test]
    fn adds_several_and_collapses_duplicates_in_the_request() {
        let out = with_modes(STOCK, &[(1440, 1080), (1440, 1080), (1680, 1050)])
            .unwrap()
            .unwrap();
        assert_eq!(
            listed_resolutions(&out),
            vec![(800, 600), (1920, 1080), (1440, 1080), (1680, 1050)]
        );
    }

    #[test]
    fn commented_out_entries_do_not_count_as_present() {
        let xml = STOCK.replace(
            "    </resolutions>",
            "<!-- <resolution><width>1440</width><height>1080</height></resolution> -->\n    </resolutions>",
        );
        assert!(!listed_resolutions(&xml).contains(&(1440, 1080)));
        let out = with_modes(&xml, &[(1440, 1080)]).unwrap().unwrap();
        assert!(listed_resolutions(&out).contains(&(1440, 1080)));
    }

    #[test]
    fn keeps_windows_line_endings() {
        let crlf = STOCK.replace('\n', "\r\n");
        let out = with_modes(&crlf, &[(1440, 1080)]).unwrap().unwrap();
        assert_eq!(out.matches('\n').count(), out.matches("\r\n").count());
    }

    #[test]
    fn handles_a_closing_tag_that_shares_a_line() {
        let xml = "<vdd_settings><resolutions><resolution><width>800</width><height>600</height></resolution></resolutions></vdd_settings>";
        let out = with_modes(xml, &[(1440, 1080)]).unwrap().unwrap();
        assert_eq!(listed_resolutions(&out), vec![(800, 600), (1440, 1080)]);
        assert!(out.ends_with("</resolutions></vdd_settings>"));
    }

    #[test]
    fn rejects_a_document_without_a_resolution_list() {
        assert_eq!(
            with_modes("<vdd_settings></vdd_settings>", &[(1440, 1080)]),
            Err(SettingsError::MissingResolutionsSection)
        );
    }
}
