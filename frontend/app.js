const API_BASE_URL = "http://localhost:8000";

const state = {
  token: sessionStorage.getItem("hub_token") || "",
  role: sessionStorage.getItem("hub_role") || "",
  user: sessionStorage.getItem("hub_user") || "",
};

const els = {
  appHeader: document.getElementById("appHeader"),
  loginSection: document.getElementById("loginSection"),
  workspaceContainer: document.getElementById("workspaceContainer"),
  loginForm: document.getElementById("loginForm"),
  usernameInput: document.getElementById("username"),
  passwordInput: document.getElementById("password"),
  togglePasswordBtn: document.getElementById("togglePasswordBtn"),
  authMessage: document.getElementById("authMessage"),
  roleBadge: document.getElementById("roleBadge"),
  logoutBtn: document.getElementById("logoutBtn"),
  studentSection: document.getElementById("studentSection"),
  studentMessage: document.getElementById("studentMessage"),
  studentMeta: document.getElementById("studentMeta"),
  overallStatus: document.getElementById("overallStatus"),
  deadlineInfo: document.getElementById("deadlineInfo"),
  clearanceTableBody: document.getElementById("clearanceTableBody"),
  slipBox: document.getElementById("slipBox"),
  slipToken: document.getElementById("slipToken"),
  staffSection: document.getElementById("staffSection"),
  staffOfficeInfo: document.getElementById("staffOfficeInfo"),
  staffActionForm: document.getElementById("staffActionForm"),
  staffMessage: document.getElementById("staffMessage"),
  adminSection: document.getElementById("adminSection"),
  reportPreview: document.getElementById("reportPreview"),
};

// ---------- Show/hide password (eye icon) ----------
els.togglePasswordBtn.addEventListener("click", () => {
  const isPassword = els.passwordInput.type === "password";
  els.passwordInput.type = isPassword ? "text" : "password";

  els.togglePasswordBtn
    .querySelector(".icon-eye")
    .classList.toggle("hidden", isPassword);
  els.togglePasswordBtn
    .querySelector(".icon-eye-off")
    .classList.toggle("hidden", !isPassword);

  const label = isPassword ? "Hide password" : "Show password";
  els.togglePasswordBtn.setAttribute("aria-label", label);
  els.togglePasswordBtn.title = label;
});

// ---------- Quick role pills ----------
document.querySelectorAll("[data-preset]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const preset = btn.getAttribute("data-preset");
    const placeholders = {
      student: "Username or Student ID (e.g. 2024-00123)",
      staff: "Office Staff Username (e.g. library_staff)",
      admin: "Admin Username (e.g. registrar_admin)",
    };
    els.usernameInput.placeholder = placeholders[preset] || "Username or Student ID";
    els.usernameInput.focus();
  });
});

// ---------- Alerts ----------
function showAlert(el, message, isOk = false) {
  el.textContent = message;
  el.classList.toggle("ok", isOk);
  el.classList.remove("hidden");
}

function hideAlert(el) {
  el.classList.add("hidden");
}

// ---------- Session handling ----------
function clearSession() {
  sessionStorage.clear();
  state.token = "";
  state.role = "";
  state.user = "";
}

// Called when the server says our token is invalid or expired (HTTP 401)
function handleExpiredSession() {
  clearSession();
  renderRoleView();
  showAlert(els.authMessage, "Your session has expired. Please log in again.");
}

// ---------- API helper (the ONLY way this page talks to the Hub) ----------
async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch (networkErr) {
    // Server is off, wrong address, or blocked by CORS
    throw new Error("Cannot reach the server. Please try again later.");
  }

  const contentType = res.headers.get("content-type") || "";
  let data;
  try {
    data = contentType.includes("application/json")
      ? await res.json()
      : await res.text();
  } catch (parseErr) {
    throw new Error("The server sent an unreadable response.");
  }

  if (!res.ok) {
    // 401 on any page except the login request means the token is no longer valid
    if (res.status === 401 && state.token && path !== "/api/auth/login") {
      handleExpiredSession();
      throw new Error("Session expired");
    }
    const msg =
      (data && data.detail) ||
      (data && data.message) ||
      `Request failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : "Request failed");
  }
  return data;
}

// ---------- Which screen to show ----------
function renderRoleView() {
  els.studentSection.classList.add("hidden");
  els.staffSection.classList.add("hidden");
  els.adminSection.classList.add("hidden");
  hideAlert(els.authMessage);
  hideAlert(els.studentMessage);

  if (!state.token || !state.role) {
    els.loginSection.classList.remove("hidden");
    els.appHeader.classList.add("hidden");
    els.workspaceContainer.classList.add("hidden");
    return;
  }

  els.loginSection.classList.add("hidden");
  els.appHeader.classList.remove("hidden");
  els.workspaceContainer.classList.remove("hidden");
  els.roleBadge.textContent = `${state.role} • ${state.user}`;

  if (state.role === "student") {
    els.studentSection.classList.remove("hidden");
    loadStudentClearance();
  } else if (state.role === "staff") {
    els.staffSection.classList.remove("hidden");
    els.staffOfficeInfo.textContent = `Signed in as ${state.user}.`;
  } else if (state.role === "admin") {
    els.adminSection.classList.remove("hidden");
  }
}

// Builds one table row safely: textContent never runs HTML or scripts
function buildOfficeRow(item) {
  const tr = document.createElement("tr");
  const isCleared = item.status === "CLEARED";

  const tdOffice = document.createElement("td");
  tdOffice.textContent = item.office;

  const tdStatus = document.createElement("td");
  const pill = document.createElement("span");
  pill.className = `status-pill ${isCleared ? "status-cleared" : "status-hold"}`;
  pill.textContent = item.status;
  tdStatus.appendChild(pill);

  const tdRemarks = document.createElement("td");
  tdRemarks.textContent = item.reason || "-";

  tr.append(tdOffice, tdStatus, tdRemarks);
  return tr;
}

async function loadStudentClearance() {
  hideAlert(els.studentMessage);
  try {
    const data = await apiRequest("/api/clearance/me");
    els.studentMeta.textContent = `${data.name || state.user} — ${data.program || ""}`;

    const clearedAll = data.overall_status === "CLEARED";
    els.overallStatus.textContent = data.overall_status || "PENDING";
    els.overallStatus.className = `status-pill ${clearedAll ? "status-cleared" : "status-hold"}`;

    els.deadlineInfo.textContent = data.deadline
      ? `Clearance Deadline: ${data.deadline}`
      : "Clearance deadline will load from the Hub API.";

    els.clearanceTableBody.innerHTML = ""; // empty the table (no API data here)
    (data.offices || []).forEach((item) => {
      els.clearanceTableBody.appendChild(buildOfficeRow(item));
    });

    if (clearedAll && data.slip_token) {
      els.slipBox.classList.remove("hidden");
      els.slipToken.textContent = data.slip_token;      renderSlipQr(data.slip_token);
    } else {
      els.slipBox.classList.add("hidden");
    }
  } catch (err) {
    if (err.message === "Session expired") return; // already handled
    showAlert(els.studentMessage, `Could not load clearance: ${err.message}`);
  }
}

// ---------- Login ----------
els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert(els.authMessage);

  const username = els.usernameInput.value.trim();
  const password = els.passwordInput.value;

  try {
    const data = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    state.token = data.token || data.access_token;
    state.role = (data.role || "").toLowerCase();
    state.user = data.username || username;

    sessionStorage.setItem("hub_token", state.token);
    sessionStorage.setItem("hub_role", state.role);
    sessionStorage.setItem("hub_user", state.user);

    renderRoleView();
  } catch (err) {
    showAlert(els.authMessage, err.message);
  }
});

// ---------- Staff: sign off / hold ----------
els.staffActionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert(els.staffMessage);

  const student_id = document.getElementById("targetStudentId").value.trim();
  const status = document.getElementById("clearanceAction").value;
  const reason = document.getElementById("clearanceReason").value.trim();

  if (status === "HOLD" && !reason) {
    showAlert(els.staffMessage, "Please enter a reason when putting a student on HOLD.");
    return;
  }

  try {
    await apiRequest("/api/clearance/decision", {
      method: "POST",
      body: JSON.stringify({ student_id, status, reason }),
    });
    showAlert(els.staffMessage, `Saved ${status} for ${student_id}.`, true);
    els.staffActionForm.reset();
  } catch (err) {
    if (err.message === "Session expired") return;
    showAlert(els.staffMessage, err.message);
  }
});

// ---------- Admin: report preview + download ----------
let currentReport = { format: "", text: "" };
const downloadBtn = document.getElementById("downloadReportBtn");

document.querySelectorAll("[data-format]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const format = btn.getAttribute("data-format");
    downloadBtn.classList.add("hidden");
    try {
      const output = await apiRequest(
        `/api/reports/registrar?format=${encodeURIComponent(format)}`
      );
      const text =
        typeof output === "string" ? output : JSON.stringify(output, null, 2);

      els.reportPreview.textContent = text;
      currentReport = { format, text };
      downloadBtn.textContent = `Download ${format.toUpperCase()}`;
      downloadBtn.classList.remove("hidden");
    } catch (err) {
      if (err.message === "Session expired") return;
      els.reportPreview.textContent = `Error: ${err.message}`;
    }
  });
});

downloadBtn.addEventListener("click", () => {
  if (!currentReport.text) return;

  const types = {
    json: "application/json",
    csv: "text/csv",
    xml: "application/xml",
  };
  const blob = new Blob([currentReport.text], {
    type: types[currentReport.format] || "text/plain",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `clearance_report.${currentReport.format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

});
els.logoutBtn.addEventListener("click", () => {
  clearSession();
  renderRoleView();
});

renderRoleView();
// ---------- Staff form: reason is required only for HOLD ----------
const actionSelect = document.getElementById("clearanceAction");
const reasonInput = document.getElementById("clearanceReason");

function syncReasonField() {
  const isHold = actionSelect.value === "HOLD";
  reasonInput.required = isHold;
  reasonInput.placeholder = isHold
    ? "Reason is required for a HOLD"
    : "Optional note";
}

actionSelect.addEventListener("change", syncReasonField);
// form.reset() puts the dropdown back to CLEARED, so refresh the field too
els.staffActionForm.addEventListener("reset", () => setTimeout(syncReasonField, 0));
syncReasonField();
// ---------- Clearance slip: QR code + print ----------
function renderSlipQr(token) {
  const target = document.getElementById("qrTarget");
  target.innerHTML = ""; // clear any previous QR (no API data is inserted here)

  if (typeof QRCode === "undefined") {
    // Library did not load (offline?). The short code below still works.
    target.textContent = "QR unavailable. Use the short code below.";
    return;
  }

  new QRCode(target, {
    text: token,
    width: 160,
    height: 160,
    correctLevel: QRCode.CorrectLevel.M,
  });
}

document
  .getElementById("printSlipBtn")
  .addEventListener("click", () => window.print()); 