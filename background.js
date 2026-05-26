// background.js v1.2 - call Ed API, download files & inline images with proper extensions
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
    id: s.id || i,
    title: s.title || ("slide_" + (i + 1)),
    type: s.type || "unknown",
    content: s.content || s.document || "",
  }));
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
      const url = o.url || o.download_url || (o.file && o.file.url);
      const name = o.name || o.filename || o.title;
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

function extractInlineImages(content) {
  if (!content) return [];
  const urls = new Set();
  // From rich-text XML format: <image src="..."/>
  const xmlRx = /<(?:image|img)[^>]*src\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = xmlRx.exec(content)) !== null) {
    if (m[1].startsWith("http")) urls.add(m[1]);
  }
  // Also from already-converted markdown ![alt](url)
  const mdRx = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
  while ((m = mdRx.exec(content)) !== null) {
    urls.add(m[1]);
  }
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

async function dispatchDownloads(scan, opts, token) {
  const courseFolder = "Ed/" +
    safe(scan.course.code || scan.course.name || ("course_" + scan.course.id));
  let queued = 0;

  if (opts.lessons) {
    for (let i = 0; i < scan.lessons.length; i++) {
      const l = scan.lessons[i];
      const folder = courseFolder + "/lessons/" +
        String(i + 1).padStart(2, "0") + "_" + safe(l.title);

      // Save each slide's text as Markdown, with inline images downloaded locally.
      for (let j = 0; j < (l.slides || []).length; j++) {
        const s = l.slides[j];
        const slideBase = String(j + 1).padStart(2, "0") + "_" + safe(s.title);
        const slidePath = folder + "/slides/" + slideBase;
        const imgRel = "./" + slideBase + "_images";
        let bodyMd = htmlToMarkdown(s.content);

        if (s.content) {
          const imgUrls = extractInlineImages(s.content);
          let idx = 1;
          for (const url of imgUrls) {
            const probe = await probeUrl(url, token);
            const ext = probe.ext || ".bin";
            const localName = "img_" + String(idx).padStart(3, "0") + ext;
            idx++;
            // Rewrite both the original URL and any post-md form
            bodyMd = bodyMd.split(url).join(imgRel + "/" + localName);
            try {
              await chrome.downloads.download({
                url: url,
                filename: folder + "/slides/" + slideBase + "_images/" + localName,
                conflictAction: "uniquify",
                saveAs: false,
              });
              queued++;
            } catch (e) { console.warn("img dl failed", url, e); }
          }
        }

        if (bodyMd && bodyMd.trim()) {
          const md = "# " + s.title + "\n\n" + bodyMd;
          const dataUrl = await blobToDataUrl(new Blob([md], { type: "text/markdown" }));
          await chrome.downloads.download({
            url: dataUrl,
            filename: slidePath + ".md",
            conflictAction: "uniquify",
            saveAs: false,
          });
          queued++;
        }
      }

      // Lesson-level files (PDFs, recordings, etc.) — probe for real ext
      for (const f of (l.files || [])) {
        try {
          const probe = await probeUrl(f.url, token);
          const baseName = probe.filename || f.name || nameFromUrl(f.url);
          let finalName = safe(baseName);
          // Append extension if filename doesn't have one and we got one from CT
          if (probe.ext && !/\.[a-z0-9]{1,8}$/i.test(finalName)) {
            finalName += probe.ext;
          }
          await chrome.downloads.download({
            url: f.url,
            filename: folder + "/" + finalName,
            conflictAction: "uniquify",
            saveAs: false,
          });
          queued++;
        } catch (e) { console.warn("file dl failed", f.url, e); }
      }
    }
  }

  if (opts.announcements) {
    for (const a of (scan.announcements || [])) {
      // Process announcement images same way
      const imgUrls = extractInlineImages(a.content);
      const slideBase = (a.created_at || "").slice(0, 10) + "_" + safe(a.title);
      let bodyMd = htmlToMarkdown(a.content);
      let idx = 1;
      const imgRel = "./" + slideBase + "_images";
      for (const url of imgUrls) {
        const probe = await probeUrl(url, token);
        const ext = probe.ext || ".bin";
        const localName = "img_" + String(idx).padStart(3, "0") + ext;
        idx++;
        bodyMd = bodyMd.split(url).join(imgRel + "/" + localName);
        try {
          await chrome.downloads.download({
            url: url,
            filename: courseFolder + "/announcements/" + slideBase + "_images/" + localName,
            conflictAction: "uniquify",
            saveAs: false,
          });
          queued++;
        } catch (e) { console.warn("ann img failed", url, e); }
      }

      const md = announcementToMd(a, scan.course, bodyMd);
      const dataUrl = await blobToDataUrl(new Blob([md], { type: "text/markdown" }));
      await chrome.downloads.download({
        url: dataUrl,
        filename: courseFolder + "/announcements/" + safe(slideBase) + ".md",
        conflictAction: "uniquify",
        saveAs: false,
      });
      queued++;

      for (const f of (a.files || [])) {
        try {
          const probe = await probeUrl(f.url, token);
          const baseName = probe.filename || f.name || nameFromUrl(f.url);
          let finalName = safe(baseName);
          if (probe.ext && !/\.[a-z0-9]{1,8}$/i.test(finalName)) {
            finalName += probe.ext;
          }
          await chrome.downloads.download({
            url: f.url,
            filename: courseFolder + "/announcements/_attachments/" + finalName,
            conflictAction: "uniquify",
            saveAs: false,
          });
          queued++;
        } catch (e) { console.warn("ann file failed", f.url, e); }
      }
    }
  }
  return queued;
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
        const queued = await dispatchDownloads(msg.scan, msg.opts || {}, msg.token);
        sendResponse({ ok: true, queued });
      } else {
        sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true;
});
