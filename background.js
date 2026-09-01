// background.js v1.3 - complete slide backup: questions/activities, raw JSON,
// external-resource preservation, completeness report, files & inline images.
//
// Auth: token from page localStorage, sent as x-token header.
// CDN files: URLs like https://static.au.edusercontent.com/files/<hash> have no
//   extension, so we HEAD them and use Content-Type / Content-Disposition.
// Inline images in slides: downloaded to a sibling folder, .md is rewritten
//   to use local relative paths so it's fully offline-readable.

const STAFF_ROLES = new Set([
  "admin", "staff", "teacher", "instructor", "tutor", "ta",
  "head_tutor", "head_ta", "tutor_lead",
]);

const state = { apiPrefix: null };

// Ed's CDN hosts — anything served from here is a real attachment.
const ED_CDN_RX =
  /^https?:\/\/(?:static[\w.-]*\.(?:edusercontent|edstem)\.(?:com|org)|edcdn\.net)\//i;

// Things we explicitly DON'T want to grab even if a URL looks like a file.
const JUNK_RX =
  /\/(download[\w_-]*\.html?|ed-discussion\.html?|favicon\.[a-z]+|robots\.txt)(?:[?#]|$)|(?:edcdn\.net|edstem\.(?:org|com))\/.*\.(?:html?|js|css)(?:[?#]|$)/i;

const FILE_EXT_RX =
  /\.(pdf|pptx?|docx?|xlsx?|zip|tar|gz|csv|txt|md|py|ipynb|c|cpp|h|java|js|ts|sql|mp4|mov|webm|mp3|wav|png|jpe?g|gif|svg|webp)(\?|#|$)/i;

const CT_TO_EXT = {
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip",
  "application/x-tar": ".tar",
  "application/gzip": ".gz",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/json": ".json",
  "application/octet-stream": ".bin",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/markdown": ".md",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
};

// ---------- HTTP helpers ----------

async function tryFetch(url, token, method) {
  const headers = { Accept: "application/json" };
  if (token) {
    headers["x-token"] = token;
    headers["Authorization"] = "Bearer " + token;
  }
  return fetch(url, {
    method: method || "GET",
    credentials: "include",
    headers: headers,
  });
}

async function apiGet(base, path, regionPath, token) {
  if (path.startsWith("http")) {
    const r = await tryFetch(path, token);
    if (!r.ok) throw new Error(r.status + " " + path);
    const ct = r.headers.get("Content-Type") || "";
    return ct.includes("json") ? r.json() : r.blob();
  }
  let candidates;
  if (state.apiPrefix !== null) candidates = [state.apiPrefix];
  else if (regionPath) candidates = [regionPath, ""];
  else candidates = ["", "/au", "/us", "/eu"];

  let lastErr = null;
  for (const prefix of candidates) {
    const url = base + prefix + path;
    try {
      const r = await tryFetch(url, token);
      if (r.ok) {
        const ct = r.headers.get("Content-Type") || "";
        if (ct.includes("json")) {
          state.apiPrefix = prefix;
          return r.json();
        }
        lastErr = new Error("non-json from " + url);
        continue;
      }
      lastErr = new Error(r.status + " " + url);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all api prefix attempts failed");
}

// HEAD request to get real filename + extension. Some CDNs reject HEAD,
// so fallback to ranged GET (1 byte) just for headers.
async function probeUrl(url, token) {
  let r = null;
  try {
    r = await tryFetch(url, token, "HEAD");
    if (!r.ok || !r.headers) throw new Error("head " + r.status);
  } catch (e) {
    try {
      r = await fetch(url, {
        credentials: "include",
        headers: { Range: "bytes=0-0", "x-token": token || "" },
      });
    } catch (e2) {
      return { filename: null, ext: "" };
    }
  }
  const ct = ((r.headers.get("Content-Type") || "").split(";")[0] || "").trim().toLowerCase();
  const cd = r.headers.get("Content-Disposition") || "";
  let filename = null;
  // RFC 5987 filename*=UTF-8''...
  let m = cd.match(/filename\*=UTF-8''([^;\s]+)/i);
  if (m) {
    try { filename = decodeURIComponent(m[1]); } catch { filename = m[1]; }
  } else {
    m = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
    if (m) filename = m[1];
  }
  return { filename: filename, ext: CT_TO_EXT[ct] || "" };
}

// ---------- Scan ----------

async function scanCourse(base, courseId, regionPath, token) {
  state.apiPrefix = null;
  const get = (p) => apiGet(base, p, regionPath || "", token);

  // 1. Course info
  let courseInfo = { id: courseId, name: "Course " + courseId };
  try {
    const me = await get("/api/user");
    const matched = (me.courses || []).find((c) => {
      const cid = (c.course && c.course.id) || c.id;
      return cid === courseId;
    });
    if (matched) courseInfo = matched.course || matched;
  } catch (e) {
    throw new Error("/api/user failed: " + (e.message || e));
  }

  // 2. Lessons
  const lessons = [];
  try {
    const data = await get("/api/courses/" + courseId + "/lessons");
    const list = data.lessons || data.results || data || [];
    for (const brief of list) {
      const lid = brief.id || (brief.lesson && brief.lesson.id);
      if (!lid) continue;
      try {
        const lr = await get("/api/lessons/" + lid);
        const lesson = lr.lesson || lr;
        lessons.push({
          id: lesson.id,
          title: lesson.title || ("lesson_" + lesson.id),
          files: extractAttachments(lesson),
          slides: extractSlides(lesson),
        });
      } catch (e) {
        lessons.push({
          id: lid,
          title: brief.title || ("lesson_" + lid),
          files: [], slides: [],
        });
      }
    }
  } catch (e) {
    throw new Error("lessons list failed: " + (e.message || e));
  }

  // 3. Threads
  const threadBriefs = [];
  let threadsUsersDict = {};
  try {
    let offset = 0; const pageSize = 50; let pages = 0;
    while (pages < 20) {
      const data = await get(
        "/api/courses/" + courseId + "/threads?limit=" + pageSize +
        "&offset=" + offset + "&sort=new"
      );
      // Ed often returns a parallel `users` array; keep it for author lookup
      if (Array.isArray(data.users)) {
        for (const u of data.users) {
          if (u && u.id) threadsUsersDict[u.id] = u;
        }
      }
      const list = data.threads || data || [];
      if (!list.length) break;
      for (const t of list) if (isOfficial(t, threadsUsersDict)) threadBriefs.push(t);
      if (list.length < pageSize) break;
      offset += pageSize; pages++;
    }
  } catch (e) { console.warn("threads failed:", e); }

  // 4. Fetch each thread fully
  const announcements = [];
  for (const t of threadBriefs) {
    try {
      const tr = await get("/api/threads/" + t.id);
      const full = tr.thread || tr;
      // Merge any users dict from this response too
      if (Array.isArray(tr.users)) {
        for (const u of tr.users) if (u && u.id) threadsUsersDict[u.id] = u;
      }
      announcements.push({
        id: full.id,
        title: full.title || ("thread_" + full.id),
        author: resolveAuthor(full, threadsUsersDict),
        created_at: full.created_at,
        is_pinned: !!full.is_pinned,
        is_announcement: !!full.is_announcement || full.type === "announcement",
        type: full.type || "thread",
        content: full.content || full.document || "",
        comments: (full.comments || full.answers || [])
          .filter((c) => {
            const u = resolveUser(c, threadsUsersDict);
            const r = ((u && (u.course_role || u.role)) || "").toLowerCase();
            return STAFF_ROLES.has(r);
          })
          .map((c) => ({
            author: resolveAuthor(c, threadsUsersDict),
            created_at: c.created_at,
            content: c.content || c.document || "",
          })),
        files: extractAttachments(full),
        url: base + (regionPath || "") + "/courses/" + courseId + "/discussion/" + full.id,
      });
    } catch (e) { console.warn("thread " + t.id + " fetch failed:", e); }
  }

  return { base, course: courseInfo, lessons, announcements };
}

function resolveUser(obj, usersDict) {
  if (!obj) return null;
  if (obj.user) return obj.user;
  if (obj.user_id && usersDict[obj.user_id]) return usersDict[obj.user_id];
  if (obj.author) return obj.author;
  return null;
}

function resolveAuthor(obj, usersDict) {
  const u = resolveUser(obj, usersDict);
  if (!u) return obj.name || obj.author_name || "Unknown";
  if (u.name) return u.name;
  const fn = u.first_name || u.given_name || "";
  const ln = u.last_name || u.family_name || "";
  if (fn || ln) return (fn + " " + ln).trim();
  return u.username || u.email || "Unknown";
}

function isOfficial(thread, usersDict) {
  if (thread.is_pinned) return true;
  if (thread.is_announcement) return true;
  if (thread.type === "announcement") return true;
  const u = resolveUser(thread, usersDict);
  const role = ((u && (u.course_role || u.role)) || "").toLowerCase();
  return STAFF_ROLES.has(role);
}

function extractSlides(lesson) {
  const slides = lesson.slides || lesson.modules || [];
  return slides.map((s, i) => ({
    id: s.id ?? i,
    title: s.title || ("slide_" + (i + 1)),
    type: s.type || s.kind || s.slide_type || "unknown",
    // Keep the old field for normal rich-text slides, but do NOT rely on it.
    content: pickPrimaryContent(s),
    // Preserve the complete API object so unsupported/new Ed block types are never
    // silently dropped. Secrets are redacted when written to JSON.
    raw: s,
    question: extractQuestionView(s),
    resources: extractExternalResources(s),
  }));
}

function firstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

// Convert only human-readable fields from an arbitrary API value to Markdown.
// This intentionally ignores grading/correctness metadata.
function visibleTextFromValue(value, depth = 0) {
  if (value == null || depth > 5) return "";
  if (typeof value === "string") return htmlToMarkdown(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => visibleTextFromValue(v, depth + 1)).filter(Boolean).join("\n");
  }
  if (typeof value !== "object") return "";

  const preferred = [
    "content", "document", "text", "label", "title", "prompt", "stem",
    "body", "description", "instructions", "question", "caption", "name",
  ];
  const parts = [];
  const seen = new Set();
  for (const key of preferred) {
    if (!(key in value)) continue;
    const text = visibleTextFromValue(value[key], depth + 1).trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      parts.push(text);
    }
  }
  return parts.join("\n\n");
}

function pickPrimaryContent(s) {
  const v = firstDefined(
    s.content, s.document, s.body, s.text, s.prompt, s.stem,
    s.instructions, s.description,
    s.question && (s.question.content || s.question.document || s.question.prompt || s.question.text)
  );
  return visibleTextFromValue(v);
}

function findFirstArray(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return null;
  for (const key of keys) {
    if (Array.isArray(obj[key]) && obj[key].length) return obj[key];
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const got = findFirstArray(value, keys, depth + 1);
      if (got) return got;
    }
  }
  return null;
}

function extractQuestionView(s) {
  if (!s || typeof s !== "object") return null;
  const type = String(s.type || s.kind || s.slide_type || "").toLowerCase();
  const questionish = /question|quiz|poll|choice|response|exercise|activity|assessment/.test(type) ||
    s.question != null || s.prompt != null || s.stem != null ||
    Array.isArray(s.options) || Array.isArray(s.choices);
  if (!questionish) return null;

  const qObj = (s.question && typeof s.question === "object") ? s.question : null;
  const promptValue = firstDefined(
    s.prompt, s.stem,
    qObj && firstDefined(qObj.prompt, qObj.stem, qObj.content, qObj.document, qObj.text),
    s.content, s.document, s.body, s.instructions, s.description,
    typeof s.question === "string" ? s.question : null
  );
  const prompt = visibleTextFromValue(promptValue).trim();

  // Ed has used different names for selectable/response items over time.
  // We only render visible text and deliberately ignore keys such as correct/solution.
  const rawOptions = findFirstArray(s, ["options", "choices", "alternatives", "items", "responses"]);
  const options = [];
  if (rawOptions) {
    for (const o of rawOptions) {
      const text = visibleTextFromValue(o).trim();
      if (text && !options.includes(text)) options.push(text);
    }
  }

  const responseType = String(firstDefined(
    s.response_type, s.responseType, s.question_type, s.questionType,
    qObj && firstDefined(qObj.response_type, qObj.responseType, qObj.type),
    s.type
  ) || "");

  return { prompt, options, responseType };
}

function collectUrls(payload) {
  const out = [];
  const seen = new Set();
  function add(url, path) {
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    // Trim common rich-text punctuation/closing delimiters.
    url = url.replace(/[),.;]+$/g, "");
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ url, path: path || "" });
  }
  function walk(v, path, depth) {
    if (v == null || depth > 10) return;
    if (typeof v === "string") {
      const matches = v.match(/https?:\/\/[^\s"'<>]+/g) || [];
      matches.forEach((u) => add(u, path));
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, path + "[" + i + "]", depth + 1));
      return;
    }
    if (typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        const next = path ? path + "." + k : k;
        if (typeof x === "string" && /^(url|href|src|download_url|downloadUrl|file_url|fileUrl)$/i.test(k)) {
          add(x, next);
        }
        walk(x, next, depth + 1);
      }
    }
  }
  walk(payload, "", 0);
  return out;
}

function providerForUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes("docs.google.com")) return "Google Docs/Slides/Sheets";
    if (h.includes("drive.google.com")) return "Google Drive";
    if (h.includes("youtube.com") || h.includes("youtu.be")) return "YouTube";
    if (h.includes("echo360")) return "Echo360";
    if (h.includes("panopto")) return "Panopto";
    if (h.includes("zoom.us")) return "Zoom";
    if (h.includes("edstem") || h.includes("edusercontent") || h.includes("edcdn")) return "Ed";
    return h;
  } catch { return "External"; }
}

function extractExternalResources(payload) {
  return collectUrls(payload)
    .filter((x) => !isAttachableUrl(x.url))
    .map((x) => ({ url: x.url, provider: providerForUrl(x.url), path: x.path }));
}

const SECRET_KEY_RX = /(^|_)(token|auth|authorization|password|passwd|cookie|secret)(_|$)/i;
function safeJson(value) {
  return JSON.stringify(value, (key, val) => {
    if (SECRET_KEY_RX.test(key)) return "[redacted]";
    return val;
  }, 2);
}

function renderSlideMarkdown(s, rawRelativePath) {
  const lines = [
    "# " + (s.title || "Untitled slide"), "",
    "- Slide ID: " + String(s.id ?? "unknown"),
    "- Type: " + String(s.type || "unknown"),
  ];

  let hasReadable = false;
  const body = htmlToMarkdown(s.content || "").trim();
  if (body) {
    lines.push("", "---", "", body);
    hasReadable = true;
  }

  const q = s.question;
  if (q) {
    const prompt = (q.prompt || "").trim();
    // Avoid duplicating the same prompt when pickPrimaryContent already caught it.
    if (prompt && !body.includes(prompt)) {
      lines.push("", "## Question", "", prompt);
      hasReadable = true;
    } else if (!prompt && /question|quiz|poll|choice|response|exercise|activity/i.test(String(s.type || ""))) {
      lines.push("", "## Activity / question", "", "_(No plain-text prompt field was exposed; raw API JSON is preserved.)_");
    }
    if (q.responseType && q.responseType.toLowerCase() !== String(s.type || "").toLowerCase()) {
      lines.push("", "**Response type:** " + q.responseType);
    }
    if (q.options && q.options.length) {
      lines.push("", "## Options / responses", "");
      q.options.forEach((o, i) => lines.push("- " + String.fromCharCode(65 + (i % 26)) + ". " + o));
      hasReadable = true;
    }
  }

  const resources = (s.resources || []).filter((r, i, arr) =>
    r.url && arr.findIndex((x) => x.url === r.url) === i
  );
  if (resources.length) {
    lines.push("", "## External resources", "");
    for (const r of resources) lines.push("- [" + r.provider + "](" + r.url + ")");
    hasReadable = true;
  }

  if (!hasReadable) {
    lines.push("", "---", "",
      "_(This Ed slide has no plain-text body in the fields currently understood by the exporter. It was still preserved instead of being skipped.)_");
  }

  if (rawRelativePath) {
    lines.push("", "---", "", "Raw API payload: `" + rawRelativePath + "`");
  }
  return lines.join("\n").trim() + "\n";
}

// ---------- Attachments ----------

function isAttachableUrl(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return false;
  if (JUNK_RX.test(url)) return false;
  if (ED_CDN_RX.test(url)) return true;
  if (FILE_EXT_RX.test(url)) return true;
  return false;
}

function extractAttachments(payload) {
  const found = [];
  const seen = new Set();
  function add(name, url) {
    if (seen.has(url)) return;
    if (!isAttachableUrl(url)) return;
    seen.add(url);
    found.push({ name: name || nameFromUrl(url), url });
  }
  function walk(o) {
    if (!o) return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (typeof o === "object") {
      const url = o.url || o.download_url || o.downloadUrl || o.file_url || o.fileUrl ||
        o.href || (o.file && (o.file.url || o.file.download_url || o.file.downloadUrl));
      const name = o.name || o.filename || o.file_name || o.title;
      if (url) add(name, url);
      Object.values(o).forEach(walk);
    } else if (typeof o === "string") {
      const m = o.match(/https?:\/\/[^\s"'<>]+/g);
      if (m) m.forEach((u) => add(null, u));
    }
  }
  walk(payload);
  return found;
}

function extractInlineImages(payload) {
  const urls = new Set();
  function add(url) {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) urls.add(url);
  }
  function scanString(text) {
    if (!text) return;
    const xmlRx = /<(?:image|img)[^>]*src\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = xmlRx.exec(text)) !== null) add(m[1]);
    const mdRx = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
    while ((m = mdRx.exec(text)) !== null) add(m[1]);
  }
  function walk(v, parentKey, depth) {
    if (v == null || depth > 10) return;
    if (typeof v === "string") { scanString(v); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, parentKey, depth + 1)); return; }
    if (typeof v === "object") {
      const type = String(v.type || v.kind || "").toLowerCase();
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === "string" && /^https?:\/\//i.test(x)) {
          const imageishKey = /image|thumbnail|poster|avatar|picture|src/i.test(k) ||
            /image/.test(type) || /\.(png|jpe?g|gif|svg|webp)(?:[?#]|$)/i.test(x);
          if (imageishKey) add(x);
        }
        walk(x, k, depth + 1);
      }
    }
  }
  walk(payload, "", 0);
  return [...urls];
}

function nameFromUrl(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split("/").pop() || "file");
  } catch { return "file"; }
}

function safe(name) {
  return String(name || "untitled")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120) || "untitled";
}

// ---------- Download dispatch ----------

async function queueTextDownload(text, mime, filename) {
  const dataUrl = await blobToDataUrl(new Blob([text], { type: mime }));
  return chrome.downloads.download({
    url: dataUrl,
    filename,
    conflictAction: "uniquify",
    saveAs: false,
  });
}

async function dispatchDownloads(scan, opts, token) {
  const courseFolder = "Ed/" +
    safe(scan.course.code || scan.course.name || ("course_" + scan.course.id));
  let queued = 0;
  const report = {
    exporter_version: "1.3.0",
    generated_at: new Date().toISOString(),
    course: {
      id: scan.course.id,
      code: scan.course.code || null,
      name: scan.course.name || null,
    },
    lessons: 0,
    slides_seen: 0,
    slides_markdown: 0,
    slide_raw_json: 0,
    slides_without_plain_text: 0,
    inline_images_found: 0,
    inline_images_queued: 0,
    lesson_attachments_found: 0,
    lesson_attachments_queued: 0,
    announcements: 0,
    selection: {
      lesson_ids: Array.isArray(opts.selectedLessonIds) ? opts.selectedLessonIds.map(String) : null,
      announcement_ids: Array.isArray(opts.selectedAnnouncementIds) ? opts.selectedAnnouncementIds.map(String) : null,
    },
    failures: [],
  };

  // A null selection means an older popup requested "all". An empty array means "none".
  const selectedLessonIds = Array.isArray(opts.selectedLessonIds)
    ? new Set(opts.selectedLessonIds.map(String))
    : null;
  const selectedAnnouncementIds = Array.isArray(opts.selectedAnnouncementIds)
    ? new Set(opts.selectedAnnouncementIds.map(String))
    : null;

  if (opts.lessons) {
    for (let i = 0; i < scan.lessons.length; i++) {
      const l = scan.lessons[i];
      if (selectedLessonIds && !selectedLessonIds.has(String(l.id))) continue;
      report.lessons++;
      const folder = courseFolder + "/lessons/" +
        String(i + 1).padStart(2, "0") + "_" + safe(l.title);

      for (let j = 0; j < (l.slides || []).length; j++) {
        const s = l.slides[j];
        report.slides_seen++;
        const slideBase = String(j + 1).padStart(2, "0") + "_" + safe(s.title);
        const slidePath = folder + "/slides/" + slideBase;
        const rawRel = "./_raw/" + slideBase + ".json";
        const imgRel = "./" + slideBase + "_images";

        // Always produce Markdown, including questions/activities/unknown types.
        let bodyMd = renderSlideMarkdown(s, rawRel);
        const beforeReadable = htmlToMarkdown(s.content || "").trim();
        if (!beforeReadable && !(s.question && ((s.question.prompt || "").trim() || (s.question.options || []).length)) &&
            !(s.resources || []).length) {
          report.slides_without_plain_text++;
        }

        // Discover images from the entire raw slide object, not just s.content.
        const imgUrls = extractInlineImages(s.raw || s.content || "");
        report.inline_images_found += imgUrls.length;
        let idx = 1;
        for (const url of imgUrls) {
          try {
            const probe = await probeUrl(url, token);
            const ext = probe.ext || (/\.(png|jpe?g|gif|svg|webp)(?:[?#]|$)/i.exec(url)?.[1] ?
              "." + /\.(png|jpe?g|gif|svg|webp)(?:[?#]|$)/i.exec(url)[1].replace("jpeg", "jpg") : ".bin");
            const localName = "img_" + String(idx).padStart(3, "0") + ext;
            idx++;
            bodyMd = bodyMd.split(url).join(imgRel + "/" + localName);
            await chrome.downloads.download({
              url,
              filename: folder + "/slides/" + slideBase + "_images/" + localName,
              conflictAction: "uniquify",
              saveAs: false,
            });
            queued++;
            report.inline_images_queued++;
          } catch (e) {
            report.failures.push({ kind: "inline_image", lesson_id: l.id, slide_id: s.id, url, error: String(e.message || e) });
          }
        }

        try {
          await queueTextDownload(bodyMd, "text/markdown", slidePath + ".md");
          queued++;
          report.slides_markdown++;
        } catch (e) {
          report.failures.push({ kind: "slide_markdown", lesson_id: l.id, slide_id: s.id, error: String(e.message || e) });
        }

        // Raw payload means a future parser can recover new/unsupported Ed block types.
        try {
          await queueTextDownload(
            safeJson(s.raw || s),
            "application/json",
            folder + "/slides/_raw/" + slideBase + ".json"
          );
          queued++;
          report.slide_raw_json++;
        } catch (e) {
          report.failures.push({ kind: "slide_raw_json", lesson_id: l.id, slide_id: s.id, error: String(e.message || e) });
        }
      }

      // Lesson-level files (PDFs, recordings, spreadsheets, documents, etc.).
      report.lesson_attachments_found += (l.files || []).length;
      for (const f of (l.files || [])) {
        try {
          const probe = await probeUrl(f.url, token);
          const baseName = probe.filename || f.name || nameFromUrl(f.url);
          let finalName = safe(baseName);
          if (probe.ext && !/\.[a-z0-9]{1,8}$/i.test(finalName)) finalName += probe.ext;
          await chrome.downloads.download({
            url: f.url,
            filename: folder + "/_attachments/" + finalName,
            conflictAction: "uniquify",
            saveAs: false,
          });
          queued++;
          report.lesson_attachments_queued++;
        } catch (e) {
          report.failures.push({ kind: "lesson_attachment", lesson_id: l.id, url: f.url, error: String(e.message || e) });
        }
      }
    }
  }

  if (opts.announcements) {
    for (const a of (scan.announcements || [])) {
      if (selectedAnnouncementIds && !selectedAnnouncementIds.has(String(a.id))) continue;
      report.announcements++;
      const imgUrls = extractInlineImages(a.content);
      const slideBase = (a.created_at || "").slice(0, 10) + "_" + safe(a.title);
      let bodyMd = htmlToMarkdown(a.content);
      let idx = 1;
      const imgRel = "./" + slideBase + "_images";
      for (const url of imgUrls) {
        try {
          const probe = await probeUrl(url, token);
          const ext = probe.ext || ".bin";
          const localName = "img_" + String(idx).padStart(3, "0") + ext;
          idx++;
          bodyMd = bodyMd.split(url).join(imgRel + "/" + localName);
          await chrome.downloads.download({
            url,
            filename: courseFolder + "/announcements/" + slideBase + "_images/" + localName,
            conflictAction: "uniquify",
            saveAs: false,
          });
          queued++;
        } catch (e) {
          report.failures.push({ kind: "announcement_image", announcement_id: a.id, url, error: String(e.message || e) });
        }
      }

      try {
        const md = announcementToMd(a, scan.course, bodyMd);
        await queueTextDownload(md, "text/markdown", courseFolder + "/announcements/" + safe(slideBase) + ".md");
        queued++;
      } catch (e) {
        report.failures.push({ kind: "announcement_markdown", announcement_id: a.id, error: String(e.message || e) });
      }

      for (const f of (a.files || [])) {
        try {
          const probe = await probeUrl(f.url, token);
          const baseName = probe.filename || f.name || nameFromUrl(f.url);
          let finalName = safe(baseName);
          if (probe.ext && !/\.[a-z0-9]{1,8}$/i.test(finalName)) finalName += probe.ext;
          await chrome.downloads.download({
            url: f.url,
            filename: courseFolder + "/announcements/_attachments/" + finalName,
            conflictAction: "uniquify",
            saveAs: false,
          });
          queued++;
        } catch (e) {
          report.failures.push({ kind: "announcement_attachment", announcement_id: a.id, url: f.url, error: String(e.message || e) });
        }
      }
    }
  }

  report.complete_slide_coverage = report.slides_seen === report.slides_markdown;
  try {
    await queueTextDownload(safeJson(report), "application/json", courseFolder + "/export-report.json");
    queued++;
  } catch (e) {
    console.warn("report download failed", e);
  }

  return { queued, report };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function announcementToMd(a, course, bodyMdOverride) {
  const pin = a.is_pinned ? "[PINNED] " : "";
  const an = a.is_announcement ? "[ANNOUNCEMENT] " : "";
  const lines = [
    "# " + an + pin + a.title, "",
    "- Author: " + a.author,
    "- Posted: " + (a.created_at || "").replace("T", " ").slice(0, 19),
    "- Type: " + a.type,
    "- Course: " + (course.code || course.name || course.id),
    "- Ed link: " + a.url,
    "", "---", "",
    (bodyMdOverride || htmlToMarkdown(a.content)) || "_(empty body)_",
  ];
  if (a.comments && a.comments.length) {
    lines.push("", "## Staff replies", "");
    for (const c of a.comments) {
      lines.push("### " + c.author + " - " +
        (c.created_at || "").replace("T", " ").slice(0, 19));
      lines.push("", htmlToMarkdown(c.content), "");
    }
  }
  return lines.join("\n");
}

function htmlToMarkdown(html) {
  if (!html) return "";
  let s = html;
  s = s.replace(/<\/?document[^>]*>/g, "");
  s = s.replace(/<paragraph[^>]*>/g, "");
  s = s.replace(/<\/paragraph>/g, "\n\n");
  s = s.replace(/<br\s*\/?>/g, "\n");
  for (let n = 1; n <= 6; n++) {
    s = s.replace(
      new RegExp("<heading[^>]*level\\s*=\\s*['\"]" + n + "['\"][^>]*>", "g"),
      "#".repeat(n) + " "
    );
  }
  s = s.replace(/<\/heading>/g, "\n\n");
  s = s.replace(/<(bold|strong)[^>]*>/g, "**").replace(/<\/(bold|strong)>/g, "**");
  s = s.replace(/<(italic|em)[^>]*>/g, "*").replace(/<\/(italic|em)>/g, "*");
  s = s.replace(/<code[^>]*>/g, "`").replace(/<\/code>/g, "`");
  s = s.replace(/<(pre|snippet)[^>]*>/g, "\n```\n");
  s = s.replace(/<\/(pre|snippet)>/g, "\n```\n");
  s = s.replace(/<list-item[^>]*>/g, "- ").replace(/<\/list-item>/g, "\n");
  s = s.replace(/<\/?(list|ordered-list|unordered-list|ul|ol)[^>]*>/g, "\n");
  s = s.replace(/<link[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/link>/g,
    (_, h, t) => "[" + (stripTags(t) || h) + "](" + h + ")");
  s = s.replace(/<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g,
    (_, h, t) => "[" + (stripTags(t) || h) + "](" + h + ")");
  s = s.replace(/<(image|img)[^>]*src\s*=\s*["']([^"']+)["'][^>]*\/?>/g,
    (_, __, src) => "![image](" + src + ")");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

function stripTags(s) { return s.replace(/<[^>]+>/g, "").trim(); }

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

// ---------- Message router ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "scan") {
        const data = await scanCourse(msg.base, msg.courseId, msg.regionPath || "", msg.token);
        sendResponse({ ok: true, data });
      } else if (msg.type === "download") {
        const result = await dispatchDownloads(msg.scan, msg.opts || {}, msg.token);
        sendResponse({ ok: true, queued: result.queued, report: result.report });
      } else {
        sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true;
});
