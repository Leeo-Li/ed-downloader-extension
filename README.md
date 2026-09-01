# 📚 Ed Downloader

[English](README.md) | [简体中文](README.zh-CN.md)

A Chrome extension for backing up course content from **Ed / EdStem** for personal study use.

Ed Downloader can scan the current course, let you choose which Lessons or Announcements to export, and save supported course content as Markdown together with attachments, images, raw slide data, and an export report.

> **Current version: v1.3.0**

## ✨ Features

- 🔎 Scan the current Ed course directly from the course page
- ✅ Select individual **Lessons** and **Announcements** before downloading
- **Select all / Clear** controls for faster selection
- 📝 Export lesson slides as Markdown
- Preserve slide numbering, including Question / Quiz / Activity slides
- Avoid silently dropping unsupported slide types
- Export visible question prompts and options when available in the API response
- Save raw slide payloads under `_raw/` for unsupported or future content types
- 📥 Download supported Ed-hosted images and attachments
- Preserve external links such as:
  - Google Docs / Slides / Sheets
  - YouTube
  - Echo360
  - Panopto
  - Zoom
- Save lesson attachments under `_attachments/`
- Export staff announcements / pinned posts as Markdown
- 📊 Generate `export-report.json` for export completeness checks
- Record selected Lesson and Announcement IDs in the export report

## ✅ Selective Download

Starting from **v1.3.0**, the extension no longer requires downloading the whole course at once.

After scanning a course, you can choose exactly what you want to export:

```text
☑ Week 1 Applied
☐ Week 1 Seminar
☐ Week 2 Applied
☑ Week 3 Applied
☐ Week 3 Seminar
```

Then click:

```text
Download selected
```

Only the checked Lessons and Announcements will be exported.

## 🧩 Installation

This extension is currently intended to be installed manually in Chrome or another Chromium-based browser.

1. Download or clone this repository.
2. Open Chrome and go to:

```text
chrome://extensions/
```

3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the folder containing:

```text
manifest.json
background.js
popup.html
popup.js
popup.css
```

6. The **Ed Downloader** extension should now appear in your browser.

After updating the source code, return to `chrome://extensions/` and click **Reload** on the extension.

## 🚀 Usage

1. Sign in to Ed normally.
2. Open the course you want to back up.

For example:

```text
https://edstem.org/.../courses/<course-id>/...
```

3. Click the **Ed Downloader** extension icon.
4. Click **Scan current course**.
5. Wait for the course structure to load.
6. Select the Lessons and/or Announcements you want.
7. Click **Download selected**.
8. Wait for the browser download to finish.

The extension reads the authentication information from the currently signed-in Ed page and uses it only for the export request.

## 📁 Export Structure

The exact structure may vary depending on the course, but an export can look similar to:

```text
Course Name/
│
├── export-report.json
│
├── Week 1 Applied/
│   ├── 01_Introduction.md
│   ├── 02_Question.md
│   ├── 03_Example.md
│   │
│   ├── _attachments/
│   │   ├── worksheet.pdf
│   │   └── dataset.csv
│   │
│   └── slides/
│       └── _raw/
│           ├── 01_slide.json
│           ├── 02_slide.json
│           └── ...
│
└── Announcements/
    └── announcement.md
```

Depending on the Ed content structure, images and other downloaded assets may also be stored locally and referenced from the generated Markdown.

## 🔍 Export Completeness

Ed contains several different content types, including normal text slides, quizzes, activities, embeds, files, and external resources.

Older versions of this extension could silently skip slides when their normal `content` field was empty.

The current exporter instead attempts to preserve every slide position.

For example, a lesson containing:

```text
01 Text
02 Quiz
03 Text
04 Activity
05 Text
```

should no longer be exported as:

```text
01
03
05
```

Unsupported content is preserved through a placeholder and/or its raw API payload rather than being silently discarded.

The generated `export-report.json` includes information such as:

```json
{
  "slides_seen": 45,
  "slides_markdown": 45,
  "complete_slide_coverage": true,
  "failures": []
}
```

This makes it easier to detect incomplete exports.

## ❓ Question / Quiz Support

The extension preserves Question, Quiz, and Activity slides even when their normal text content is empty.

When the Ed API response contains visible question data, the exporter attempts to preserve:

- Prompt
- Passage
- Visible answer options
- Activity text
- External resources

However, some Ed quiz pages load the actual question content through a separate request and only expose quiz metadata in the lesson response.

In those cases, the slide is still preserved, but the complete question body may not yet be available in the exported Markdown.

This is a current limitation rather than a silently skipped slide.

## 📎 Attachments and External Content

The extension attempts to download supported Ed-hosted resources, including common formats such as:

- PDF
- CSV / spreadsheets
- Word documents
- PowerPoint files
- Images
- Video or audio files when directly downloadable

For third-party embedded content, the extension currently prioritizes preserving the original URL.

Examples include:

```text
Google Slides
Google Docs
YouTube
Echo360
Panopto
Zoom
```

Some external services may require their own login or may not allow direct file downloads.

## 🔐 Permissions

The extension currently requests:

```text
downloads
storage
activeTab
scripting
```

and access to Ed-related hosts including:

```text
*.edstem.org
*.edstem.com
*.edusercontent.com
*.edcdn.net
```

These permissions are required to scan the active Ed course and download course resources.

## 📝 Version History

### v1.3.0

- Added selective Lesson / Announcement downloads
- Added individual checkboxes after scanning
- Added **Select all** and **Clear**
- Download button now exports only selected items
- Selected IDs are recorded in `export-report.json`
- Maintains compatibility with full-course export behavior

### v1.2.0

- Fixed silently missing Question / Activity slides
- Preserved slides even when the normal `content` field is empty
- Added raw slide JSON backups
- Added export completeness reporting
- Improved attachment handling
- Improved image detection and downloading
- Added Ed CDN permissions
- Improved support for external embedded resources

## ⚠️ Known Limitations

- Some quiz question bodies are loaded by a separate Ed request and may not yet be fully exported.
- Google Slides / Docs are currently generally preserved as links rather than converted into complete offline copies.
- Some third-party embedded media may require separate authentication.
- Ed may change its internal API or page structure in the future.
- Unsupported future content types may initially be preserved only as raw JSON / placeholders until a parser is added.

## ⚖️ Disclaimer

This project is intended for **personal study, accessibility, and backup of content that the user is already authorized to access**.

Do not use this extension to bypass access controls, obtain hidden assessment answers, redistribute copyrighted course material, or access content without permission.

Course content remains the property of its respective authors and institutions.

## 📄 License

This project is open source under the [MIT License](LICENSE).
