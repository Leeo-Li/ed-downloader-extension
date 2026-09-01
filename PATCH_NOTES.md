# v1.3.0

- Added selective download after scanning.
- Each Lesson and Announcement can be checked independently.
- Added Select all / Clear controls.
- Download button now exports only selected items.
- `export-report.json` records the selected lesson and announcement IDs.
- Background remains backward compatible: if no selection IDs are supplied, it exports all enabled content.

# Ed Downloader v1.2.0 patch notes

Changes in this build:

- Never silently skip a slide just because its normal `content` field is empty.
- Export question/activity prompts and visible options when present in the API payload.
- Preserve every slide's raw API payload under `slides/_raw/*.json` (auth-like keys are redacted).
- Preserve external resources such as Google Docs/Slides/Sheets, YouTube, Echo360, Panopto and Zoom links in Markdown.
- Scan images from the complete slide payload, not only the normal rich-text body.
- Add Ed CDN host permissions for `edusercontent.com` and `edcdn.net`.
- Put lesson attachments under `_attachments/`.
- Generate `export-report.json` with slide coverage, asset counts and failures.
- Popup now shows total slide count and reports exported slide coverage.

Expected behavior for the Week 3 case that previously produced 01, 03, 05...:
all slide positions are now exported as Markdown. Unsupported block types get a placeholder plus raw JSON instead of disappearing.
