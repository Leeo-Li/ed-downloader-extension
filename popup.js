// popup.js - UI control + extract token from page + dispatch to background

const $ = (id) => document.getElementById(id);

let lastScan = null;

function setStatus(msg, type) {
  const el = $("status");
  el.textContent = msg;
  el.className = "status " + (type || "hint");
}

function getCourseFromUrl(url) {
  const m = url.match(
    /^(https:\/\/(?:[^\/]+\.)?edstem\.(?:org|com))(\/[a-z]{2})?\/courses\/(\d+)/i
  );
  if (!m) return null;
  return {
    base: m[1],
    regionPath: m[2] || "",
    courseId: parseInt(m[3], 10),
  };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// This function runs INSIDE the Ed page context to dig out the auth token.
// Different Ed versions stash it under different keys, so we scan everything.
function extractEdToken() {
  const out = { token: null, where: null, allKeys: [] };
  // Scan localStorage
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out.allKeys.push("ls:" + k);
      const v = localStorage.getItem(k);
      if (typeof v === "string" && v.split(".").length === 3 && v.startsWith("eyJ")) {
        out.token = v;
        out.where = "localStorage[" + k + "]";
        return out;
      }
      // Sometimes wrapped in JSON
      try {
        const parsed = JSON.parse(v);
        const cand = parsed && (parsed.token || parsed.auth_token || parsed.authToken || parsed.access_token);
        if (typeof cand === "string" && cand.startsWith("eyJ")) {
          out.token = cand;
          out.where = "localStorage[" + k + "].token";
          return out;
        }
      } catch (e) { /* not json */ }
    }
  } catch (e) { /* localStorage blocked */ }
  // Scan sessionStorage
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      out.allKeys.push("ss:" + k);
      const v = sessionStorage.getItem(k);
      if (typeof v === "string" && v.split(".").length === 3 && v.startsWith("eyJ")) {
        out.token = v;
        out.where = "sessionStorage[" + k + "]";
        return out;
      }
    }
  } catch (e) { /* blocked */ }
  // Last resort: try to read it from a cookie (most cookies are httpOnly so likely fails)
  try {
    const m = document.cookie.match(/(?:^|;\s*)([^=]*token[^=]*)=([^;]+)/i);
    if (m) {
      out.token = decodeURIComponent(m[2]);
      out.where = "cookie[" + m[1] + "]";
      return out;
    }
  } catch (e) { /* */ }
  return out;
}

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp || { ok: false, error: "no response" });
      }
    });
  });
}

function selectionItems(kind) {
  return Array.from(document.querySelectorAll('.select-item[data-kind="' + kind + '"]'));
}

function updateSelectionState() {
  const lessonsEnabled = $("opt-lessons").checked;
  const announcementsEnabled = $("opt-announce").checked;

  const lessonBoxes = selectionItems("lesson");
  const announcementBoxes = selectionItems("announcement");

  lessonBoxes.forEach((box) => {
    box.disabled = !lessonsEnabled;
    const row = box.closest(".select-row");
    if (row) row.classList.toggle("disabled", !lessonsEnabled);
  });
  announcementBoxes.forEach((box) => {
    box.disabled = !announcementsEnabled;
    const row = box.closest(".select-row");
    if (row) row.classList.toggle("disabled", !announcementsEnabled);
  });

  const selectedLessons = lessonsEnabled ? lessonBoxes.filter((x) => x.checked).length : 0;
  const selectedAnnouncements = announcementsEnabled ? announcementBoxes.filter((x) => x.checked).length : 0;
  const total = selectedLessons + selectedAnnouncements;

  $("selected-summary").textContent =
    "已选 " + selectedLessons + " Lessons / " + selectedAnnouncements + " 公告";
  $("download").textContent = total ? ("下载已选 (" + total + ")") : "下载已选";
  $("download").disabled = !lastScan || total === 0;
}

function addSelectRow(ul, kind, id, title, meta) {
  const li = document.createElement("li");
  li.className = "select-row";

  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = true;
  input.className = "select-item";
  input.dataset.kind = kind;
  input.dataset.id = String(id);

  const main = document.createElement("span");
  main.className = "select-main";
  const name = document.createElement("span");
  name.className = "select-title";
  name.textContent = title;
  const detail = document.createElement("span");
  detail.className = "select-meta";
  detail.textContent = meta || "";

  main.appendChild(name);
  main.appendChild(detail);
  label.appendChild(input);
  label.appendChild(main);
  li.appendChild(label);
  ul.appendChild(li);
}

function renderPreview(scan) {
  $("preview").hidden = false;
  $("course-name").textContent = scan.course.name || scan.course.code || "(unknown)";
  $("course-id").textContent = "#" + scan.course.id;
  $("cnt-lessons").textContent = scan.lessons.length;
  let fileCount = 0;
  let slideCount = 0;
  scan.lessons.forEach((l) => {
    fileCount += (l.files || []).length;
    slideCount += (l.slides || []).length;
  });
  $("cnt-slides").textContent = slideCount;
  (scan.announcements || []).forEach((a) => { fileCount += (a.files || []).length; });
  $("cnt-files").textContent = fileCount;
  $("cnt-announce").textContent = (scan.announcements || []).length;

  const ul = $("item-list");
  ul.innerHTML = "";

  if (scan.lessons.length) {
    const head = document.createElement("li");
    head.className = "group";
    head.textContent = "Lessons";
    ul.appendChild(head);
    scan.lessons.forEach((l) => {
      addSelectRow(
        ul,
        "lesson",
        l.id,
        l.title,
        (l.slides || []).length + " slides · " + (l.files || []).length + " attachments"
      );
    });
  }

  if ((scan.announcements || []).length) {
    const head = document.createElement("li");
    head.className = "group";
    head.textContent = "Announcements / Pinned";
    ul.appendChild(head);
    scan.announcements.forEach((a) => {
      addSelectRow(
        ul,
        "announcement",
        a.id,
        a.title || "Announcement",
        (a.files || []).length + " attachments"
      );
    });
  }

  ul.querySelectorAll(".select-item").forEach((box) => {
    box.addEventListener("change", updateSelectionState);
  });
  updateSelectionState();
}

$("scan").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab || !tab.url) { setStatus("Cannot read current tab URL", "err"); return; }
  const ctx = getCourseFromUrl(tab.url);
  if (!ctx) {
    setStatus("This tab is not an Ed course page (.../courses/<id>/...)", "err");
    return;
  }

  setStatus("Reading auth token from page...", "busy");
  $("scan").disabled = true;
  $("download").disabled = true;

  let tokenInfo = { token: null, where: null, allKeys: [] };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractEdToken,
    });
    if (results && results[0]) tokenInfo = results[0].result || tokenInfo;
  } catch (e) {
    setStatus("Cannot inject into Ed page: " + e.message, "err");
    $("scan").disabled = false;
    return;
  }

  if (!tokenInfo.token) {
    setStatus("No token found. Keys checked: " + tokenInfo.allKeys.join(", "), "err");
    $("scan").disabled = false;
    return;
  }

  setStatus("Token found in " + tokenInfo.where + ". Scanning...", "busy");

  try {
    const resp = await send({
      type: "scan",
      base: ctx.base,
      regionPath: ctx.regionPath,
      courseId: ctx.courseId,
      token: tokenInfo.token,
    });
    if (!resp.ok) throw new Error(resp.error || "scan failed");
    lastScan = resp.data;
    lastScan._token = tokenInfo.token; // pass to download step
    renderPreview(lastScan);
    const slideCount = lastScan.lessons.reduce((n, l) => n + (l.slides || []).length, 0);
    setStatus("Scan complete - " + lastScan.lessons.length + " lessons, " +
              slideCount + " slides, " +
              (lastScan.announcements || []).length + " announcements", "ok");
  } catch (e) {
    setStatus("Scan failed: " + e.message, "err");
  } finally {
    $("scan").disabled = false;
  }
});

$("download").addEventListener("click", async () => {
  if (!lastScan) return;
  const opts = {
    lessons: $("opt-lessons").checked,
    announcements: $("opt-announce").checked,
    selectedLessonIds: selectionItems("lesson").filter((x) => x.checked).map((x) => x.dataset.id),
    selectedAnnouncementIds: selectionItems("announcement").filter((x) => x.checked).map((x) => x.dataset.id),
  };
  setStatus("Dispatching downloads (see chrome://downloads)", "busy");
  $("download").disabled = true;
  try {
    const resp = await send({
      type: "download",
      scan: lastScan,
      opts: opts,
      token: lastScan._token,
    });
    if (!resp.ok) throw new Error(resp.error || "download failed");
    const r = resp.report || {};
    const coverage = r.slides_seen != null ? (" Slides: " + r.slides_markdown + "/" + r.slides_seen + ".") : "";
    const failures = (r.failures || []).length ? (" Failures logged: " + r.failures.length + ".") : "";
    setStatus("Queued " + resp.queued + " downloads." + coverage + failures + " See export-report.json.", "ok");
  } catch (e) {
    setStatus("Download failed: " + e.message, "err");
  } finally {
    $("download").disabled = false;
  }
});

$("select-all").addEventListener("click", () => {
  document.querySelectorAll(".select-item:not(:disabled)").forEach((box) => { box.checked = true; });
  updateSelectionState();
});

$("select-none").addEventListener("click", () => {
  document.querySelectorAll(".select-item:not(:disabled)").forEach((box) => { box.checked = false; });
  updateSelectionState();
});

$("opt-lessons").addEventListener("change", updateSelectionState);
$("opt-announce").addEventListener("change", updateSelectionState);

(async () => {
  const tab = await getActiveTab();
  const ctx = tab && getCourseFromUrl(tab.url || "");
  if (ctx) {
    setStatus("Detected course id=" + ctx.courseId + " - click Scan", "hint");
  } else {
    setStatus("Open any Ed course page first", "hint");
    $("scan").disabled = true;
  }
})();
