# 📚 Ed Downloader

[English](README.md) | [简体中文](README.zh-CN.md)

一个用于 **Ed / EdStem** 课程内容备份的 Chrome 扩展，面向个人学习与复习场景。

Ed Downloader 可以扫描当前课程，让你选择需要导出的 **Lesson** 或 **Announcement**，并将支持的课程内容保存为 Markdown，同时保留附件、图片、原始 Slide 数据和完整性报告。

> **当前版本：v1.3.0**

## ✨ 功能

- 🔎 直接扫描当前打开的 Ed 课程
- ✅ 下载前可单独选择 **Lessons** 和 **Announcements**
- 支持 **全选 / 清空**
- 📝 将课程 Slide 导出为 Markdown
- 保留 Question / Quiz / Activity 等页面的编号，避免页面静默丢失
- 对暂不支持的内容类型保留占位文件和原始 JSON
- 当 API 返回可见题目内容时，尝试导出题干和选项
- 📥 下载支持的 Ed 图片和附件
- 保留第三方外部资源链接，例如：
  - Google Docs / Slides / Sheets
  - YouTube
  - Echo360
  - Panopto
  - Zoom
- 将 Lesson 附件保存到 `_attachments/`
- 支持导出 Announcement / 公告
- 📊 生成 `export-report.json`，用于检查导出完整性
- 在报告中记录本次实际选择并导出的 Lesson / Announcement

## ✅ 选择下载

从 **v1.3.0** 开始，不再要求一次下载整门课程。

扫描课程后，可以按需选择：

```text
☑ Week 1 Applied
☐ Week 1 Seminar
☐ Week 2 Applied
☑ Week 3 Applied
☐ Week 3 Seminar
```

然后点击：

```text
Download selected
```

只会导出勾选的内容。

## 🧩 安装

目前推荐通过 Chrome / Chromium 浏览器的开发者模式手动安装。

1. 下载或克隆本仓库。
2. 打开：

```text
chrome://extensions/
```

3. 开启 **Developer mode / 开发者模式**。
4. 点击 **Load unpacked / 加载已解压的扩展程序**。
5. 选择包含以下文件的项目目录：

```text
manifest.json
background.js
popup.html
popup.js
popup.css
```

6. 浏览器中会出现 **Ed Downloader**。

修改代码后，只需要回到 `chrome://extensions/` 并点击扩展的 **Reload / 重新加载**。

## 🚀 使用方法

1. 正常登录 Ed。
2. 打开需要备份的课程页面。
3. 点击浏览器中的 **Ed Downloader** 图标。
4. 点击 **Scan current course**。
5. 等待课程结构加载。
6. 勾选需要的 Lessons 和 / 或 Announcements。
7. 点击 **Download selected**。
8. 等待下载完成。

扩展只会使用当前已登录 Ed 页面已有的访问权限进行导出。

## 📁 导出结构

实际目录会根据课程内容略有变化，例如：

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

部分图片和其他资源也会被下载到本地，并由生成的 Markdown 引用。

## 🔍 完整性检查

Ed 课程可能包含普通文本、Quiz、Activity、附件、Embed 和外部资源等多种内容类型。

旧版本在某些 Slide 的 `content` 为空时，可能会直接跳过页面。例如原课程：

```text
01 Text
02 Quiz
03 Text
04 Activity
05 Text
```

旧版本有可能只导出：

```text
01
03
05
```

现在的导出逻辑会尽量保留所有 Slide 位置。即使暂时无法解析某种内容，也会保存占位信息和 / 或原始 API 数据，而不是静默丢失。

生成的 `export-report.json` 会包含类似：

```json
{
  "slides_seen": 45,
  "slides_markdown": 45,
  "complete_slide_coverage": true,
  "failures": []
}
```

这样可以快速判断是否存在漏抓。

## ❓ Question / Quiz 支持

扩展会保留 Question、Quiz 和 Activity Slide，即使它们的普通文本字段为空。

如果 Ed API 已经返回当前用户可见的题目数据，扩展会尝试保存：

- 题干
- Passage
- 可见选项
- Activity 文字
- 外部资源

部分 Ed Quiz 会通过另一条请求单独加载真正的题目正文，而 Lesson API 只返回 Quiz 元数据。

这种情况下，当前版本仍会保留该 Slide，但完整题目正文可能暂时无法导出。

## 📎 附件与外部资源

扩展会尝试下载 Ed 直接提供的常见文件，包括：

- PDF
- CSV / Spreadsheet
- Word 文档
- PowerPoint
- 图片
- 可直接下载的视频或音频

对于第三方 Embed，目前优先保留原始链接，例如：

```text
Google Slides
Google Docs
YouTube
Echo360
Panopto
Zoom
```

部分第三方内容可能需要单独登录，或者不允许直接下载。

## 🔐 权限

扩展目前需要：

```text
downloads
storage
activeTab
scripting
```

并访问与 Ed 相关的域名，例如：

```text
*.edstem.org
*.edstem.com
*.edusercontent.com
*.edcdn.net
```

这些权限用于读取当前已登录的课程页面并下载课程资源。

## 📝 版本记录

### v1.3.0

- 新增 Lesson / Announcement 选择下载
- 扫描后显示单独勾选框
- 新增 **Select all / Clear**
- 下载按钮只导出当前选中的项目
- `export-report.json` 记录本次选择
- 保留整门课程下载能力

### v1.2.0

- 修复 Question / Activity Slide 被静默跳过的问题
- 即使普通 `content` 为空也保留 Slide
- 新增原始 Slide JSON 备份
- 新增导出完整性报告
- 改进附件处理
- 改进图片识别和下载
- 增加 Ed CDN 权限
- 改进外部 Embed 资源支持

## ⚠️ 已知限制

- 某些 Quiz 的完整题目正文由 Ed 的独立请求加载，目前可能无法完整导出
- Google Slides / Docs 通常保留为链接，而不是完整离线副本
- 一些第三方媒体需要额外登录
- Ed 内部 API 或页面结构未来可能发生变化
- 新出现的未知内容类型可能暂时只保存为原始 JSON / 占位信息

## ⚖️ 使用说明

本项目用于**个人学习、可访问性和备份用户已经有权限访问的课程内容**。

请勿使用本扩展绕过访问控制、获取当前用户无权查看的隐藏测验答案、未经授权访问内容，或非法传播受版权保护的课程资料。

课程内容的版权仍归原作者和所属机构所有。

## 📄 开源许可

本项目基于 [MIT License](LICENSE) 开源。
