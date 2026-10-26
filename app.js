const couple = `${WEDDING.groom} & ${WEDDING.bride}`;

function fillText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function renderStatic() {
  document.title = `دعوة زفاف ${WEDDING.groom} و${WEDDING.bride}`;
  fillText("coverNames", couple);
  fillText("names", couple);
  fillText("footerNames", couple);
  fillText("dateLabel", WEDDING.dateLabel);
  fillText("timeLabel", WEDDING.timeLabel);
  fillText("venueLabel", `${WEDDING.venue} — ${WEDDING.address}`);
  fillText("dressLabel", WEDDING.dress);
  fillText("addressLabel", `${WEDDING.venue}، ${WEDDING.address}`);

  const mapLink = document.getElementById("mapLink");
  mapLink.href = WEDDING.mapUrl;

  document.getElementById("mapFrame").src = WEDDING.mapEmbed;

  const program = document.getElementById("program");
  program.innerHTML = WEDDING.program
    .map(
      (item) =>
        `<li><span>${item.title}</span><time datetime=""><span dir="ltr">${item.time}</span> مساءً</time></li>`
    )
    .join("");
}

function tickCountdown() {
  const target = new Date(WEDDING.dateISO).getTime();
  const now = Date.now();
  let diff = Math.max(0, target - now);

  const days = Math.floor(diff / 86400000);
  diff %= 86400000;
  const hours = Math.floor(diff / 3600000);
  diff %= 3600000;
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  fillText("days", pad(days));
  fillText("hours", pad(hours));
  fillText("minutes", pad(minutes));
  fillText("seconds", pad(seconds));
}

function icsDate(iso) {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function addToCalendar() {
  const end = new Date(new Date(WEDDING.dateISO).getTime() + 4 * 3600000);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Wedding Invite//AR//",
    "BEGIN:VEVENT",
    `DTSTART:${icsDate(WEDDING.dateISO)}`,
    `DTEND:${icsDate(end.toISOString())}`,
    `SUMMARY:حفل زفاف ${couple}`,
    `LOCATION:${WEDDING.venue}، ${WEDDING.address}`,
    "DESCRIPTION:يسعدنا حضوركم حفل الزفاف",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "wedding.ics";
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadWishes() {
  const section = document.getElementById("wishesSection");
  const box = document.getElementById("wishes");
  try {
    const response = await fetch("/api/wishes");
    const data = await response.json();
    const wishes = data.wishes || [];
    if (!wishes.length) {
      section.hidden = true;
      return;
    }
    box.innerHTML = wishes
      .map(
        (wish) => `
          <figure class="wish">
            <blockquote>${escapeHtml(wish.message)}</blockquote>
            <figcaption>${escapeHtml(wish.name)}</figcaption>
          </figure>
        `
      )
      .join("");
    section.hidden = false;
  } catch {
    section.hidden = true;
  }
}

async function sendRsvp(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const copied = document.getElementById("copied");
  const error = document.getElementById("rsvpError");
  copied.hidden = true;
  error.hidden = true;

  const data = new FormData(form);
  const payload = {
    name: String(data.get("guestName") || "").trim(),
    status: data.get("status") === "attending" ? "attending" : "declining",
    guests: Number(data.get("guests") || 1),
    message: String(data.get("message") || "").trim(),
  };

  try {
    const response = await fetch("/api/rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("save_failed");
    copied.hidden = false;
    form.reset();
    form.status.value = "attending";
    form.guests.value = "1";
  } catch {
    error.hidden = false;
  }
}

function openInvite() {
  const cover = document.getElementById("cover");
  const invite = document.getElementById("invite");
  cover.classList.add("opening");
  window.setTimeout(() => {
    cover.hidden = true;
    invite.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, 550);
}

renderStatic();
loadWishes();
tickCountdown();
window.setInterval(tickCountdown, 1000);

document.getElementById("openInvite").addEventListener("click", openInvite);
document.getElementById("addToCalendar").addEventListener("click", addToCalendar);
document.getElementById("rsvpForm").addEventListener("submit", sendRsvp);
