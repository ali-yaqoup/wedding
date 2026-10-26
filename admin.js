const TOKEN_KEY = "wedding-admin-token";

function toAr(n) {
  return String(n).replace(/\d/g, (ch) => "٠١٢٣٤٥٦٧٨٩"[ch]);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token()) headers["X-Admin-Token"] = token();
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "request_failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

function statusLabel(status) {
  return status === "attending" ? "إن شاء الله بحضر" : "معتذر";
}

function renderStats(stats) {
  document.getElementById("statGuests").textContent = toAr(stats.guests);
  document.getElementById("statAttending").textContent = toAr(stats.attending);
  document.getElementById("statDeclining").textContent = toAr(stats.declining);
  document.getElementById("statMessages").textContent = toAr(stats.messages);
}

function renderList(rows) {
  const filter = document.getElementById("filter").value;
  const filtered = rows.filter((row) => {
    if (filter === "attending") return row.status === "attending";
    if (filter === "declining") return row.status !== "attending";
    if (filter === "messages") return Boolean(String(row.message || "").trim());
    if (filter === "featured") return Boolean(row.featured);
    return true;
  });

  const list = document.getElementById("rsvpList");
  const empty = document.getElementById("emptyState");
  empty.hidden = filtered.length > 0;
  list.innerHTML = filtered
    .map((row) => {
      const hasMessage = Boolean(String(row.message || "").trim());
      return `
        <article class="guest-card" data-id="${escapeHtml(row.id)}">
          <header>
            <h3>${escapeHtml(row.name)}</h3>
            <span class="pill ${row.status}">${statusLabel(row.status)}</span>
          </header>
          <p class="guest-meta">عدد الحضور: ${toAr(row.status === "attending" ? row.guests : 0)}</p>
          ${
            hasMessage
              ? `<blockquote>${escapeHtml(row.message)}</blockquote>`
              : `<p class="lead">بدون رسالة</p>`
          }
          <label class="choice ${hasMessage ? "" : "is-disabled"}">
            <input type="checkbox" data-feature="${escapeHtml(row.id)}" ${
              row.featured ? "checked" : ""
            } ${hasMessage ? "" : "disabled"} />
            أظهر التهنئة داخل الدعوة
          </label>
        </article>
      `;
    })
    .join("");
}

async function loadDashboard() {
  const data = await api("/api/admin/rsvps");
  renderStats(data.stats);
  renderList(data.rsvps);
  window.__rsvps = data.rsvps;
}

function showDashboard() {
  document.getElementById("loginCard").hidden = true;
  document.getElementById("dashboard").hidden = false;
  document.getElementById("coupleLine").textContent = `${WEDDING.groom} و ${WEDDING.bride}`;
}

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.getElementById("loginError");
  error.hidden = true;
  const password = new FormData(event.currentTarget).get("password");
  try {
    const data = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    sessionStorage.setItem(TOKEN_KEY, data.token);
    showDashboard();
    await loadDashboard();
  } catch {
    error.hidden = false;
  }
});

document.getElementById("filter").addEventListener("change", () => {
  renderList(window.__rsvps || []);
});

document.getElementById("rsvpList").addEventListener("change", async (event) => {
  const box = event.target.closest("[data-feature]");
  if (!box) return;
  try {
    const data = await api(`/api/admin/rsvps/${box.dataset.feature}`, {
      method: "PATCH",
      body: JSON.stringify({ featured: box.checked }),
    });
    const rows = window.__rsvps || [];
    const index = rows.findIndex((row) => row.id === data.rsvp.id);
    if (index >= 0) rows[index] = data.rsvp;
    renderStats(data.stats);
  } catch {
    box.checked = !box.checked;
  }
});

document.getElementById("logout").addEventListener("click", () => {
  sessionStorage.removeItem(TOKEN_KEY);
  window.location.reload();
});

if (token()) {
  showDashboard();
  loadDashboard().catch(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    window.location.reload();
  });
}
