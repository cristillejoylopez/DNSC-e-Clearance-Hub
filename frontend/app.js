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

// Show/hide password toggle (eye icon)
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

// Quick role pills focus username input with sample placeholder hints
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

async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await res.json()
    : await res.text();

  if (!res.ok) {
    const msg =
      (data && data.detail) ||
      (data && data.message) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function showAlert(el, message, isOk = false) {
  el.textContent = message;
  el.classList.toggle("ok", isOk);
  el.classList.remove("hidden");
}

function hideAlert(el) {
  el.classList.add("hidden");
}

function renderRoleView() {
  els.studentSection.classList.add("hidden");
  els.staffSection.classList.add("hidden");
  els.adminSection.classList.add("hidden");
  hideAlert(els.authMessage);

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

async function loadStudentClearance() {
  try {
    const data = await apiRequest("/api/clearance/me");
    els.studentMeta.textContent = `${data.name || state.user} — ${data.program || ""}`;

    const clearedAll = data.overall_status === "CLEARED";
    els.overallStatus.textContent = data.overall_status || "PENDING";
    els.overallStatus.className = `status-pill ${clearedAll ? "status-cleared" : "status-hold"}`;

    els.deadlineInfo.textContent = data.deadline
      ? `Clearance Deadline: ${data.deadline}`
      : "Clearance deadline will load from the Hub API.";

    els.clearanceTableBody.innerHTML = "";
    (data.offices || []).forEach((item) => {
      const tr = document.createElement("tr");
      const isCleared = item.status === "CLEARED";
      tr.innerHTML = `
        <td>${item.office}</td>
        <td><span class="status-pill ${isCleared ? "status-cleared" : "status-hold"}">${item.status}</span></td>
        <td>${item.reason || "-"}</td>
      `;
      els.clearanceTableBody.appendChild(tr);
    });

    if (clearedAll && data.slip_token) {
      els.slipBox.classList.remove("hidden");
      els.slipToken.textContent = data.slip_token;
    } else {
      els.slipBox.classList.add("hidden");
    }
  } catch (err) {
    showAlert(els.authMessage, `Could not load clearance: ${err.message}`);
  }
}

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
    showAlert(els.staffMessage, err.message);
  }
});

document.querySelectorAll("[data-format]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const format = btn.getAttribute("data-format");
    try {
      const output = await apiRequest(
        `/api/reports/registrar?format=${encodeURIComponent(format)}`
      );
      els.reportPreview.textContent =
        typeof output === "string" ? output : JSON.stringify(output, null, 2);
    } catch (err) {
      els.reportPreview.textContent = `Error: ${err.message}`;
    }
  });
});

els.logoutBtn.addEventListener("click", () => {
  sessionStorage.clear();
  state.token = "";
  state.role = "";
  state.user = "";
  renderRoleView();
});

renderRoleView();