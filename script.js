// ======= Firebase ESM (akan diabaikan saat mode lokal) =======
// (Pastikan di index.html sudah ada CDN Tesseract: 
// <script src="https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js"></script>)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  onSnapshot,
  doc,
  addDoc,
  Timestamp,
  updateDoc,
  deleteDoc,
  writeBatch,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* =========================================================================
 * KONFIGURASI & INISIALISASI
 * ========================================================================= */
const MOCK_FIREBASE_CONFIG = {
  apiKey: "MOCK_API_KEY_LOCAL_TEST",
  authDomain: "mock-project.firebaseapp.com",
  projectId: "mock-project-id",
  storageBucket: "mock-project.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:mockid",
};

const appId =
  typeof __app_id !== "undefined" ? __app_id : "default-app-id";
const firebaseConfig =
  typeof __firebase_config !== "undefined"
    ? JSON.parse(__firebase_config)
    : MOCK_FIREBASE_CONFIG;

// FIX token custom
const initialAuthToken =
  typeof __initial_auth_token !== "undefined" ? __initial_auth_token : null;

let db, auth, userId = null;

let employees = [];
let attendanceRecords = [];

/* ===== NEW: PUNISHMEN storage (selalu Lokal) ===== */
let punishmentRecords = [];

/* ===== OCR state ===== */
let mediaStream = null;
let lastOcrText = "";

/* ===== MISC ===== */
let isLocalMode = false;

const ATTENDANCE_TYPES = [
  "Sakit", "Cuti", "Terlambat", "ALPA", "IZIN", "DINAS LUAR",
];

/* =========================================================================
 * GLOBAL STATE
 * ========================================================================= */
let currentView = "dashboard";
const today = new Date();
const defaultMonth = today.toISOString().slice(0, 7);
let currentFilterMonth = defaultMonth;
let currentPunishMonth = defaultMonth;

/* Alias agar onclick='setview("...")' tetap jalan */
window.setview = (...args) => window.setView(...args);

/* Fallback binding menu (kalau inline onclick diblok oleh CSP host) */
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("nav-dashboard")?.addEventListener("click", () => window.setView("dashboard"));
  document.getElementById("nav-input")?.addEventListener("click", () => window.setView("input"));
  document.getElementById("nav-punishmen")?.addEventListener("click", () => window.setView("punishmen"));
  document.getElementById("nav-employee_db")?.addEventListener("click", () => window.setView("employee_db"));

  // tombol hapus semua
  document.getElementById("btn-delete-all")?.addEventListener("click", () => window.deleteAllEmployees());

  // inisialisasi kontrol OCR bila panel ada di HTML (opsional)
  initOcrUiBindings();
});

/* =========================================================================
 * UTILITIES
 * ========================================================================= */

// Namespace LocalStorage agar data GitHub Pages dan Lokal terpisah
const STORE_PREFIX = location.hostname.includes("github.io") ? "gh:" : "local:";
const lsGet = (key) => {
  let v = localStorage.getItem(STORE_PREFIX + key);
  if (v == null) v = localStorage.getItem(key); // fallback legacy
  return v;
};
const lsSet = (key, val) => localStorage.setItem(STORE_PREFIX + key, val);

window.formatDate = (timestamp) => {
  if (!timestamp) return "N/A";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const options = {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  };
  return date.toLocaleDateString("id-ID", options);
};

window.showMessage = (message, type = "success") => {
  const messageBox = document.getElementById("message-box");
  if (!messageBox) { console.log(`[${type}] ${message}`); return; }

  messageBox.textContent = message;
  messageBox.className = "p-3 rounded-lg text-center font-semibold mb-4";
  if (type === "success") {
    messageBox.classList.add("bg-green-100", "text-green-800");
  } else if (type === "error") {
    messageBox.classList.add("bg-red-100", "text-red-800");
  } else {
    messageBox.classList.add("bg-blue-100", "text-blue-800");
  }
  messageBox.classList.remove("hidden");
  setTimeout(() => messageBox.classList.add("hidden"), 5000);
};

/* =========================================================================
 * LOCAL STORAGE HELPERS
 * ========================================================================= */
function loadLocalData() {
  try {
    employees          = JSON.parse(lsGet("employees") || "[]");
    attendanceRecords  = JSON.parse(lsGet("attendanceRecords") || "[]");
    punishmentRecords  = JSON.parse(lsGet("punishmentRecords") || "[]");

    renderEmployeeDropdowns();
    renderEmployeeList();
    renderDashboard();
  } catch (e) {
    console.error("Gagal memuat data dari LocalStorage:", e);
    showMessage("Gagal memuat data lokal. Lihat console untuk detail.", "error");
  }
}
function saveLocalData() {
  try {
    lsSet("employees", JSON.stringify(employees));
    lsSet("attendanceRecords", JSON.stringify(attendanceRecords));
    lsSet("punishmentRecords", JSON.stringify(punishmentRecords));
  } catch (e) {
    console.error("Gagal menyimpan data ke LocalStorage:", e);
    showMessage("Gagal menyimpan data lokal. Lihat console untuk detail.", "error");
  }
}

/* =========================================================================
 * PILIH MODE (Cloud / Lokal)
 * ========================================================================= */
if (firebaseConfig && firebaseConfig.apiKey !== "MOCK_API_KEY_LOCAL_TEST") {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);

  onAuthStateChanged(auth, async (user) => {
    try {
      if (user) {
        userId = user.uid;
        document.getElementById("user-info").textContent = `User ID: ${userId}`;
      } else {
        if (initialAuthToken) {
          try { await signInWithCustomToken(auth, initialAuthToken); }
          catch { await signInAnonymously(auth); }
        } else {
          await signInAnonymously(auth);
        }
        userId = auth.currentUser?.uid || crypto.randomUUID();
      }
      setupFirestoreListeners();
    } catch (err) {
      console.error(err);
      showMessage("Auth error. Beralih ke mode lokal.", "error");
      isLocalMode = true;
      document.getElementById("user-info").textContent = `User ID: LOCAL STORAGE`;
      loadLocalData();
    }
  });
} else {
  isLocalMode = true;
  console.warn("Mode LOKAL aktif. Data disimpan di LocalStorage.");
  document.getElementById("user-info").textContent = `User ID: LOCAL STORAGE`;
  loadLocalData();
}

/* =========================================================================
 * LISTENER FIRESTORE
 * ========================================================================= */
function setupFirestoreListeners() {
  if (!db || !userId) return;

  const employeesPath = `artifacts/${appId}/users/${userId}/employees`;
  const recordsPath   = `artifacts/${appId}/users/${userId}/attendance_records`;

  const qEmployees = query(collection(db, employeesPath));
  onSnapshot(qEmployees, (snapshot) => {
    employees = [];
    snapshot.forEach((docu) => employees.push({ id: docu.id, ...docu.data() }));
    renderEmployeeDropdowns();
    renderEmployeeList();
  }, (error) => showMessage(`Gagal memuat data karyawan dari Cloud: ${error.message}`, "error"));

  const qRecords = query(collection(db, recordsPath));
  onSnapshot(qRecords, (snapshot) => {
    attendanceRecords = [];
    snapshot.forEach((docu) => attendanceRecords.push({ id: docu.id, ...docu.data() }));
    renderDashboard();
  }, (error) => showMessage(`Gagal memuat data kehadiran dari Cloud: ${error.message}`, "error"));
}

/* =========================================================================
 * DISPATCHERS (dipanggil dari HTML inline)
 * ========================================================================= */
window.submitEmployee     = async () => isLocalMode ? submitEmployeeLocal() : await submitEmployeeFirebase();
window.handleFileUpload   = (e) => isLocalMode ? handleFileUploadLocal(e) : handleFileUploadFirebase(e);
window.submitAttendance   = async (type) => isLocalMode ? submitAttendanceLocal(type) : await submitAttendanceFirebase(type);
window.deleteEmployee     = async (id, name) => {
  if (!confirm(`Hapus karyawan ${name}? Semua catatan kehadiran akan ikut dihapus.`)) return;
  if (isLocalMode) deleteEmployeeLocal(id); else await deleteEmployeeFirebase(id);
};
window.openEditModal      = (id) => {
  const emp = employees.find(e => e.id === id); if (!emp) return;
  document.getElementById("edit-employee-id").value = emp.id;
  document.getElementById("edit-employee-name").value = emp.name;
  document.getElementById("edit-employee-nid").value  = emp.nid;
  document.getElementById("edit-employee-bidang").value = emp.bidang;
  const m = document.getElementById("edit-modal"); m?.classList.remove("hidden"); m?.classList.add("flex");
};
window.closeEditModal     = () => { const m = document.getElementById("edit-modal"); m?.classList.remove("flex"); m?.classList.add("hidden"); };
window.saveEmployeeChanges = async () => {
  const id = document.getElementById("edit-employee-id").value;
  const name   = document.getElementById("edit-employee-name").value.trim();
  const nid    = document.getElementById("edit-employee-nid").value.trim();
  const bidang = document.getElementById("edit-employee-bidang").value.trim();
  if (!name || !nid || !bidang) { showMessage("Nama, NID, dan Bidang wajib diisi.", "error"); return; }
  const updated = { name, nid, bidang };
  if (isLocalMode) saveEmployeeChangesLocal(id, updated); else await saveEmployeeChangesFirebase(id, updated);
  window.closeEditModal();
};

/* === HAPUS SEMUA DATA (Lokal & Cloud) ================================== */
window.deleteAllEmployees = async () => {
  const ok = confirm(
    "Yakin ingin menghapus SEMUA data karyawan dan seluruh catatan kehadiran?\nTindakan ini tidak bisa dibatalkan."
  );
  if (!ok) return;

  const btn = document.getElementById("btn-delete-all");
  btn?.setAttribute("disabled", "true");

  try {
    if (isLocalMode) {
      // Hapus semua data lokal (karyawan, kehadiran, dan punishmen)
      employees = [];
      attendanceRecords = [];
      punishmentRecords = [];
      saveLocalData();

      renderEmployeeDropdowns();
      renderEmployeeList();
      renderDashboard();
      renderPunishList?.();
      showMessage("Semua data lokal berhasil dihapus.");
    } else {
      // Cloud: hapus semua dokumen di employees dan attendance_records
      const base = `artifacts/${appId}/users/${userId}`;
      const deletedEmp = await deleteAllDocsInCollection(`${base}/employees`);
      const deletedAtt = await deleteAllDocsInCollection(`${base}/attendance_records`);

      // bersihkan cache lokal agar UI langsung kosong
      employees = [];
      attendanceRecords = [];
      saveLocalData();
      renderEmployeeDropdowns();
      renderEmployeeList();
      renderDashboard();

      showMessage(`Hapus Cloud sukses. Karyawan: ${deletedEmp}, Catatan kehadiran: ${deletedAtt}.`);
    }
  } catch (err) {
    console.error(err);
    showMessage("Gagal menghapus semua data: " + (err?.message || err), "error");
  } finally {
    btn?.removeAttribute("disabled");
  }
};

// helper untuk menghapus semua dokumen dalam 1 koleksi (Cloud)
async function deleteAllDocsInCollection(path) {
  const colRef = collection(db, path);
  const snap = await getDocs(colRef);
  let count = 0;
  let batch = writeBatch(db);
  let ops = 0;

  snap.forEach((d) => {
    batch.delete(doc(db, path, d.id));
    ops++; count++;
    if (ops >= 400) { // batas aman batch Firestore
      batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  });
  if (ops > 0) await batch.commit();
  return count;
}

window.reviewEmployeeDetails = (id, name) => {
  setView("review-detail");
  const employeeRecords = attendanceRecords
    .filter((r) => r.employeeId === id)
    .sort((a, b) => {
      const ta = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : a.timestamp;
      const tb = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : b.timestamp;
      return (tb || 0) - (ta || 0);
    });

  document.getElementById("review-header").textContent = `Histori Kehadiran: ${name}`;
  const container = document.getElementById("review-detail-container");

  if (!employeeRecords.length) {
    container.innerHTML = `<p class="text-gray-500 italic">Belum ada catatan kehadiran untuk ${name}.</p>`;
    return;
  }

  const items = employeeRecords.map((r) => {
    const type = r.type;
    const cls  = type.toLowerCase().replace(/\s/g,"_");
    const ts   = r.timestamp?.toDate ? r.timestamp : new Date(r.timestamp);
    return `
      <div class="p-4 mb-3 bg-white rounded-lg shadow-sm border-l-4 border-${cls}-500">
        <span class="px-3 py-1 text-xs font-semibold rounded-full bg-${cls}-badge">${type}</span>
        <p class="text-sm text-gray-700 mt-1">Tanggal/Waktu: <span class="font-medium">${window.formatDate(ts)}</span></p>
      </div>`;
  }).join("");

  container.innerHTML = `<h3 class="text-xl font-semibold mb-4 border-b pb-2">Total ${employeeRecords.length} Catatan</h3><div class="space-y-3">${items}</div>`;
};

/* =========================================================================
 * FIREBASE CRUD (CLOUD)
 * ========================================================================= */
async function submitEmployeeFirebase() {
  const name = document.getElementById("employee-name").value.trim();
  const nid  = document.getElementById("employee-nid").value.trim();
  const bidang = document.getElementById("employee-bidang").value.trim();
  if (!name || !nid || !bidang) { showMessage("Nama, NID, dan Bidang wajib diisi.", "error"); return; }

  try {
    const employeesPath = `artifacts/${appId}/users/${userId}/employees`;
    await addDoc(collection(db, employeesPath), { name, nid, bidang, createdAt: Timestamp.now() });
    document.getElementById("employee-name").value = "";
    document.getElementById("employee-nid").value  = "";
    document.getElementById("employee-bidang").value = "";
    showMessage(`Karyawan ${name} berhasil ditambahkan ke Cloud!`);
  } catch (e) { showMessage(`Gagal menambahkan karyawan ke Cloud: ${e.message}`, "error"); }
}
function handleFileUploadFirebase(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const data = new Uint8Array(e.target.result);
    const wb = XLSX.read(data, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const employeesPath = `artifacts/${appId}/users/${userId}/employees`;
    const batch = writeBatch(db);

    let added = 0;
    rows.forEach((row, idx) => {
      if (!row || row.length < 2) return;
      let [Nama, NID, Bidang] = row;
      if (idx === 0 && typeof Nama === "string" && /nama/i.test(Nama)) return;
      Nama   = String(Nama || "").trim();
      NID    = String(NID  || "").trim();
      Bidang = String(Bidang || "").trim();
      if (!Nama || !NID) return;

      const ref = doc(collection(db, employeesPath));
      batch.set(ref, { name: Nama, nid: NID, bidang: Bidang || "-", createdAt: Timestamp.now() });
      added++;
    });

    try {
      await batch.commit();
      showMessage(`Berhasil mengunggah ${added} data karyawan ke Cloud!`);
      event.target.value = "";
    } catch (error) {
      showMessage(`Gagal mengunggah data ke Cloud: ${error.message}`, "error");
    }
  };
  reader.readAsArrayBuffer(file);
}
async function submitAttendanceFirebase(type) {
  const selectId = `select-${type.toLowerCase().replace(/\s/g,"_")}`;
  const employeeId = document.getElementById(selectId).value;
  const date = document.getElementById("input-date").value;

  // normalisasi waktu: izinkan "11.23" -> "11:23"
  let time = document.getElementById("input-time").value.trim();
  time = time.replace(".", ":");

  if (!employeeId || !date || !time) { showMessage("Lengkapi semua input.", "error"); return; }

  const dt = new Date(`${date}T${time}:00`);
  if (isNaN(dt.getTime())) { showMessage("Format tanggal/waktu tidak valid.", "error"); return; }
  const ts = Timestamp.fromDate(dt);
  const monthYear = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
  const emp = employees.find(e => e.id === employeeId);

  try {
    await addDoc(collection(db, `artifacts/${appId}/users/${userId}/attendance_records`), {
      employeeId, employeeName: emp.name, employeeNid: emp.nid, employeeBidang: emp.bidang,
      type, timestamp: ts, monthYear, createdAt: Timestamp.now(),
    });
    document.getElementById(selectId).value = "";
    showMessage(`Catatan ${type} berhasil diunggah ke Cloud!`);
  } catch (e) { showMessage(`Gagal mengunggah catatan ke Cloud: ${e.message}`, "error"); }
}
async function deleteEmployeeFirebase(id) {
  try { await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/employees`, id)); showMessage("Karyawan berhasil dihapus dari Cloud!"); }
  catch (e) { showMessage(`Gagal menghapus karyawan dari Cloud: ${e.message}`, "error"); }
}
async function saveEmployeeChangesFirebase(id, updated) {
  try { await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/employees`, id), updated); showMessage("Perubahan karyawan berhasil disimpan ke Cloud!"); }
  catch (e) { showMessage(`Gagal menyimpan perubahan ke Cloud: ${e.message}`, "error"); }
}

/* =========================================================================
 * LOCAL STORAGE CRUD (FALLBACK)
 * ========================================================================= */
function submitEmployeeLocal() {
  const name = document.getElementById("employee-name").value.trim();
  const nid  = document.getElementById("employee-nid").value.trim();
  const bidang = document.getElementById("employee-bidang").value.trim();
  if (!name || !nid || !bidang) { showMessage("Nama, NID, dan Bidang wajib diisi.", "error"); return; }

  employees.push({ id: crypto.randomUUID(), name, nid, bidang, createdAt: Date.now() });
  saveLocalData();
  document.getElementById("employee-name").value = "";
  document.getElementById("employee-nid").value  = "";
  document.getElementById("employee-bidang").value = "";
  showMessage(`Karyawan ${name} berhasil ditambahkan ke Lokal!`);
  renderEmployeeDropdowns(); renderEmployeeList();
}
function handleFileUploadLocal(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    let added = 0;
    rows.forEach((row, idx) => {
      if (!row || row.length < 2) return;
      let [Nama, NID, Bidang] = row;
      if (idx === 0 && typeof Nama === "string" && /nama/i.test(Nama)) return;
      Nama = String(Nama || "").trim(); NID = String(NID || "").trim(); Bidang = String(Bidang || "").trim();
      if (!Nama || !NID) return;
      employees.push({ id: crypto.randomUUID(), name: Nama, nid: NID, bidang: Bidang || "-", createdAt: Date.now() });
      added++;
    });
    saveLocalData(); event.target.value = "";
    showMessage(`Berhasil menambahkan ${added} karyawan dari file.`);
    renderEmployeeDropdowns(); renderEmployeeList();
  };
  reader.readAsArrayBuffer(file);
}
function submitAttendanceLocal(type) {
  const selectId = `select-${type.toLowerCase().replace(/\s/g,"_")}`;
  const employeeId = document.getElementById(selectId).value;
  const date = document.getElementById("input-date").value;

  // normalisasi waktu: izinkan "11.23" -> "11:23"
  let time = document.getElementById("input-time").value.trim();
  time = time.replace(".", ":");

  if (!employeeId || !date || !time) { showMessage("Lengkapi semua input.", "error"); return; }

  const dt = new Date(`${date}T${time}:00`);
  if (isNaN(dt.getTime())) { showMessage("Format Tanggal atau Waktu tidak valid.", "error"); return; }
  const emp = employees.find(e => e.id === employeeId); if (!emp) return;

  const monthYear = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
  attendanceRecords.push({
    employeeId, employeeName: emp.name, employeeNid: emp.nid, employeeBidang: emp.bidang,
    type, timestamp: dt.getTime(), monthYear, createdAt: Date.now(),
  });
  saveLocalData();
  document.getElementById(selectId).value = "";
  showMessage(`Catatan ${type} berhasil diunggah ke Lokal!`);
  renderDashboard();
}
function deleteEmployeeLocal(id) {
  employees = employees.filter(e => e.id !== id);
  attendanceRecords = attendanceRecords.filter(r => r.employeeId !== id);
  punishmentRecords = punishmentRecords.filter(r => r.employeeId !== id);
  saveLocalData();
  showMessage("Karyawan & catatan terkait dihapus dari Lokal!");
  renderEmployeeDropdowns(); renderEmployeeList(); renderDashboard(); renderPunishList();
}
function saveEmployeeChangesLocal(id, updated) {
  const idx = employees.findIndex(e => e.id === id);
  if (idx !== -1) {
    employees[idx] = { ...employees[idx], ...updated };
    attendanceRecords = attendanceRecords.map(r => r.employeeId === id ? { ...r, employeeName: updated.name, employeeNid: updated.nid, employeeBidang: updated.bidang } : r);
    punishmentRecords = punishmentRecords.map(r => r.employeeId === id ? { ...r, employeeName: updated.name, employeeNid: updated.nid, employeeBidang: updated.bidang } : r);
    saveLocalData();
    showMessage("Perubahan karyawan disimpan ke Lokal!");
    renderEmployeeDropdowns(); renderEmployeeList(); renderDashboard(); renderPunishList();
  }
}

/* =========================================================================
 * RENDER & NAVIGASI
 * ========================================================================= */
window.setView = (view) => { currentView = view; renderApp(); };
window.handleMonthChange = (e) => { currentFilterMonth = e.target.value; renderDashboard(); };

function updateDateTimeInputs() {
  const dateInput = document.getElementById("input-date");
  const timeInput = document.getElementById("input-time");
  if (dateInput) dateInput.value = today.toISOString().substring(0, 10);
  if (timeInput) timeInput.value = today.toTimeString().substring(0, 5);
}
function updatePunishDateAndFilter() {
  const d = document.getElementById("punish-date");
  const m = document.getElementById("punish-filter-month");
  if (d) d.value = today.toISOString().substring(0,10);
  if (m) { m.value = currentPunishMonth; m.onchange = (e)=>{ currentPunishMonth = e.target.value; renderPunishList(); }; }
}

function renderApp() {
  // reset nav styles
  document.querySelectorAll("#sidebar button").forEach((btn) => {
    btn.classList.remove("bg-indigo-600","text-white");
    btn.classList.add("text-indigo-200","hover:bg-indigo-700");
  });
  const activeBtn = document.getElementById(`nav-${currentView}`);
  if (activeBtn && currentView !== "review-detail") {
    activeBtn.classList.add("bg-indigo-600","text-white");
    activeBtn.classList.remove("text-indigo-200","hover:bg-indigo-700");
  }

  // toggle views
  document.getElementById("view-employee-db")?.classList.toggle("hidden", currentView !== "employee_db");
  document.getElementById("view-input")?.classList.toggle("hidden", currentView !== "input");
  document.getElementById("view-dashboard")?.classList.toggle("hidden", currentView !== "dashboard");
  document.getElementById("view-review-detail")?.classList.toggle("hidden", currentView !== "review-detail");
  document.getElementById("view-punishmen")?.classList.toggle("hidden", currentView !== "punishmen");

  if (currentView === "employee_db") {
    renderEmployeeList();
  } else if (currentView === "input") {
    updateDateTimeInputs();
  } else if (currentView === "dashboard") {
    renderDashboard();
  } else if (currentView === "punishmen") {
    renderEmployeeDropdowns();
    updatePunishDateAndFilter();
    renderPunishList();
  }

  if (isLocalMode) showMessage("Mode lokal aktif. Data disimpan menggunakan LocalStorage.", "info");
  else document.getElementById("message-box")?.classList.add("hidden");
}

function renderEmployeeList() {
  const listContainer = document.getElementById("employee-list-container");
  if (!listContainer) return;

  if (!employees.length) {
    listContainer.innerHTML = '<p class="text-gray-500 italic">Belum ada data karyawan. Silakan tambahkan di atas.</p>';
    return;
  }

  const html = `
    <div class="space-y-3">
      <div class="p-4 bg-indigo-100 font-bold text-indigo-800 rounded-t-lg flex justify-between">
        <span>NAMA / NID / BIDANG</span><span>AKSI</span>
      </div>
      ${employees.map(emp => `
        <div class="p-4 bg-white rounded-lg border border-gray-200 flex justify-between items-center">
          <div>
            <p class="font-semibold text-gray-800">${emp.name}</p>
            <p class="text-sm text-gray-500">NID: ${emp.nid}</p>
            <p class="text-sm text-indigo-600">${emp.bidang}</p>
          </div>
          <div class="flex space-x-2">
            <button onclick="reviewEmployeeDetails('${emp.id}', '${String(emp.name).replace(/'/g,"\\'")}')" class="icon-button icon-review" title="Lihat Histori">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2m-9 0V3h4v2m-4 0h4m-4 4h9m-9 4h9m-9 4h6"/></svg>
            </button>
            <button onclick="openEditModal('${emp.id}')" class="icon-button icon-edit" title="Edit Karyawan">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            </button>
            <button onclick="deleteEmployee('${emp.id}', '${String(emp.name).replace(/'/g,"\\'")}')" class="icon-button icon-delete" title="Hapus Karyawan">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>`).join("")}
    </div>`;
  listContainer.innerHTML = html;
}

function renderEmployeeDropdowns() {
  const dropdownIds = ATTENDANCE_TYPES.map(type => `select-${type.toLowerCase().replace(/\s/g,"_")}`);
  const baseOptions = '<option value="" selected>-- Pilih Karyawan --</option>' +
    employees.map(emp => `<option value="${emp.id}">${emp.name} (${emp.nid} - ${emp.bidang})</option>`).join("");

  dropdownIds.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = baseOptions; });

  const pAdd = document.getElementById("punish-employee");
  if (pAdd) pAdd.innerHTML = baseOptions;
  const pEdit = document.getElementById("edit-punish-employee");
  if (pEdit) pEdit.innerHTML = baseOptions;

  // juga isi daftar pada panel AI jika ada
  const aiEmp = document.getElementById("ai-employee");
  if (aiEmp) aiEmp.innerHTML = baseOptions;
}

/* =========================================================================
 * DASHBOARD
 * ========================================================================= */
function processDashboardData(records, type) {
  const filtered = records.filter(r => r.type === type);
  const aggregated = filtered.reduce((acc, r) => {
    const key = r.employeeNid || r.employeeId;
    if (!acc[key]) acc[key] = { id: r.employeeId, name: r.employeeName, nid: r.employeeNid || "N/A", bidang: r.employeeBidang || "N/A", count: 0 };
    acc[key].count += 1; return acc;
  }, {});
  return { total: filtered.length, sortedList: Object.values(aggregated).sort((a,b)=>b.count-a.count) };
}
function renderDashboard() {
  const container = document.getElementById("dashboard-container"); if (!container) return;
  const filterYearMonth = currentFilterMonth;
  const monthRecords = attendanceRecords.filter(r => r.monthYear === filterYearMonth);

  const dashboardData = {};
  ATTENDANCE_TYPES.forEach(t => dashboardData[t] = processDashboardData(monthRecords, t));

  const renderColumn = (title, data) => {
    const k = title.toLowerCase().replace(/\s/g,"_");
    const titleBg = `color-${k}-title`; const totalBg = `bg-${k}-total`; const countBg = `bg-${k}-badge`;
    const listHtml = data.sortedList.length
      ? data.sortedList.map(item => {
          const empId = item.id || (employees.find(e => e.nid === item.nid)?.id || "");
          const safeName = String(item.name).replace(/'/g,"\\'");
          return `
            <li class="p-4 bg-white rounded-lg border border-gray-200 mb-2 flex justify-between items-center">
              <div>
                <p class="font-semibold text-gray-800">${item.name}</p>
                <p class="text-xs text-gray-500">NID: ${item.nid}</p>
                <p class="text-xs text-indigo-600">${item.bidang}</p>
              </div>
              <div class="flex items-center space-x-2">
                <button onclick="reviewEmployeeDetails('${empId}', '${safeName}')" class="px-3 py-1 text-xs font-semibold rounded-full bg-orange-500 text-white hover:bg-orange-600 transition">view</button>
                <span class="ml-2 flex-shrink-0 px-3 py-1 ${countBg} rounded-full font-bold text-sm">${item.count} Kali</span>
              </div>
            </li>`;
        }).join("")
      : `<li class="p-4 text-center text-gray-500 italic">Tidak ada catatan ${title} bulan ini.</li>`;

    return `
      <div class="w-full">
        <div class="${titleBg} text-white font-extrabold py-3 px-4 rounded-xl shadow-md text-center text-xl mb-4">DAFTAR ${title.toUpperCase()}</div>
        <div class="p-4 rounded-xl shadow-md ${totalBg} mb-4"><p class="text-lg font-bold">Total ${title} (${filterYearMonth}): <span class="text-3xl ml-2 font-extrabold">${data.total}</span> Catatan</p></div>
        <ul class="space-y-2 min-h-64">${listHtml}</ul>
      </div>`;
  };

  const filterSection = `
    <h2 class="text-3xl font-bold text-gray-800 mb-6 border-b pb-4">Dashboard Rekap Kehadiran</h2>
    <div class="mb-8 p-6 bg-indigo-50 rounded-xl container-shadow">
      <label for="filter-month" class="block text-lg font-bold text-indigo-800 mb-3">Filter Berdasarkan Bulan & Tahun:</label>
      <input type="month" id="filter-month" value="${filterYearMonth}" onchange="handleMonthChange(event)"
        class="w-full md:w-1/3 p-3 border-2 border-indigo-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-lg">
    </div>`;
  const contentHtml = `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6 mt-8">
      ${renderColumn("Sakit", dashboardData["Sakit"])}
      ${renderColumn("Cuti",  dashboardData["Cuti"])}
      ${renderColumn("Terlambat", dashboardData["Terlambat"])}
      ${renderColumn("ALPA",  dashboardData["ALPA"])}
      ${renderColumn("IZIN",  dashboardData["IZIN"])}
      ${renderColumn("DINAS LUAR", dashboardData["DINAS LUAR"])}
    </div>`;
  container.innerHTML = filterSection + contentHtml;
  const filterInput = document.getElementById("filter-month"); if (filterInput) filterInput.onchange = window.handleMonthChange;
  document.getElementById("filter-month").value = currentFilterMonth;
}

/* =========================================================================
 * PUNISHMEN (SELALU LOCAL STORAGE)
 * ========================================================================= */
function fileToDataUrlIfSmall(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    const MAX = 2 * 1024 * 1024; // 2MB
    if (file.size > MAX) return resolve(null);
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(file);
  });
}
window.submitPunishment = async () => {
  const dateVal = document.getElementById("punish-date").value;
  const empId   = document.getElementById("punish-employee").value;
  const action  = document.getElementById("punish-action").value;
  const desc    = document.getElementById("punish-desc").value.trim();
  const file    = document.getElementById("punish-file").files[0] || null;

  if (!dateVal || !empId || !action) { showMessage("Tanggal, Karyawan, dan Action wajib diisi.", "error"); return; }

  const emp = employees.find(e=>e.id===empId);
  const d = new Date(`${dateVal}T00:00:00`);
  const monthYear = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;

  const fileDataUrl = await fileToDataUrlIfSmall(file);
  if (file && !fileDataUrl) showMessage("Lampiran > 2MB tidak disimpan (metadata tetap).","info");

  punishmentRecords.push({
    id: crypto.randomUUID(),
    employeeId: emp.id,
    employeeName: emp.name,
    employeeNid: emp.nid,
    employeeBidang: emp.bidang,
    date: dateVal,
    monthYear,
    action,
    desc,
    fileName: file ? file.name : null,
    fileDataUrl: fileDataUrl || null,
    createdAt: Date.now(),
  });
  saveLocalData();

  document.getElementById("punish-employee").value = "";
  document.getElementById("punish-action").value  = "";
  document.getElementById("punish-desc").value    = "";
  document.getElementById("punish-file").value    = "";

  showMessage("Data PUNISHMEN tersimpan di lokal.");
  currentPunishMonth = monthYear;
  const pm = document.getElementById("punish-filter-month"); if (pm) pm.value = currentPunishMonth;
  renderPunishList();
};

function renderPunishList() {
  const wrap = document.getElementById("punish-list-container"); if (!wrap) return;
  const month = currentPunishMonth;
  const items = punishmentRecords.filter(r => r.monthYear === month)
                                 .sort((a,b)=> new Date(b.date) - new Date(a.date));
  if (!items.length) {
    wrap.innerHTML = `<p class="text-center text-gray-500 italic">Belum ada data PUNISHMEN untuk bulan ${month}.</p>`;
    return;
  }

  const html = items.map(r => {
    const link = r.fileDataUrl
      ? `<a href="${r.fileDataUrl}" target="_blank" class="text-indigo-600 font-semibold underline">Lihat Dokumen</a>`
      : `<span class="text-slate-400">Tanpa lampiran</span>`;
    const safeName = String(r.employeeName).replace(/</g,"&lt;").replace(/>/g,"&gt;");
    return `
      <div class="p-4 bg-white rounded-lg border border-gray-200 mb-3">
        <div class="flex items-start justify-between">
          <div class="pr-4">
            <p class="font-semibold text-slate-800">${safeName}</p>
            <p class="text-xs text-slate-500">NID: ${r.employeeNid} • ${r.employeeBidang}</p>
            <p class="text-xs text-slate-600 mt-1">Tanggal: <span class="font-medium">${r.date}</span></p>
            <p class="text-sm text-slate-700 mt-2">${r.desc ? r.desc.replace(/\n/g,"<br>") : "-"}</p>
            <div class="mt-2">${link}</div>
          </div>

          <div class="flex items-center gap-2">
            <span class="px-3 py-1 rounded-full text-sm font-bold bg-orange-100 text-orange-700">${r.action}</span>

            <button title="Edit" class="icon-button icon-edit" onclick="openEditPunish('${r.id}')">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            </button>

            <button title="Hapus" class="icon-button icon-delete" onclick="deletePunish('${r.id}')">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
      </div>`;
  }).join("");

  wrap.innerHTML = `
    <div class="p-4 rounded-xl bg-indigo-50 border mb-4">
      <div class="font-semibold text-indigo-700">Total PUNISHMEN (${month}): <span class="text-xl">${items.length}</span> catatan</div>
    </div>
    ${html}`;
}

// Aksi Hapus
window.deletePunish = (id) => {
  const rec = punishmentRecords.find(r => r.id === id); if (!rec) return;
  if (!confirm(`Hapus PUNISHMEN ${rec.employeeName} (${rec.action}) pada ${rec.date}?`)) return;
  punishmentRecords = punishmentRecords.filter(r => r.id !== id);
  saveLocalData(); showMessage("Data PUNISHMEN dihapus."); renderPunishList();
};

// Aksi Edit
function buildEmployeeOptions(selectedId = "") {
  const head = '<option value="">-- Pilih Karyawan --</option>';
  const body = employees.map(e => `<option value="${e.id}" ${e.id===selectedId?'selected':''}>${e.name} (${e.nid} - ${e.bidang})</option>`).join("");
  return head + body;
}
window.openEditPunish = (id) => {
  const rec = punishmentRecords.find(r => r.id === id); if (!rec) return;

  document.getElementById("edit-punish-id").value = rec.id;
  document.getElementById("edit-punish-date").value = rec.date;
  document.getElementById("edit-punish-employee").innerHTML = buildEmployeeOptions(rec.employeeId);
  document.getElementById("edit-punish-action").value = rec.action;
  document.getElementById("edit-punish-desc").value = rec.desc || "";
  document.getElementById("edit-punish-file").value = "";

  const m = document.getElementById("punish-edit-modal"); m?.classList.remove("hidden"); m?.classList.add("flex");
};
window.closeEditPunish = () => { const m = document.getElementById("punish-edit-modal"); m?.classList.remove("flex"); m?.classList.add("hidden"); };
window.saveEditPunish = async () => {
  const id = document.getElementById("edit-punish-id").value;
  const date   = document.getElementById("edit-punish-date").value;
  const empId  = document.getElementById("edit-punish-employee").value;
  const action = document.getElementById("edit-punish-action").value;
  const desc   = document.getElementById("edit-punish-desc").value.trim();
  const file   = document.getElementById("edit-punish-file").files[0] || null;

  if (!id || !date || !empId || !action) { showMessage("Tanggal, Karyawan, dan Action wajib diisi.","error"); return; }

  const idx = punishmentRecords.findIndex(r => r.id === id); if (idx === -1) return;
  const emp = employees.find(e => e.id === empId);
  const d = new Date(`${date}T00:00:00`);
  const monthYear = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;

  let fileName   = punishmentRecords[idx].fileName;
  let fileDataUrl= punishmentRecords[idx].fileDataUrl;
  if (file) {
    const dataUrl = await fileToDataUrlIfSmall(file);
    if (dataUrl) { fileName = file.name; fileDataUrl = dataUrl; }
    else showMessage("Lampiran > 2MB tidak disimpan. Data lain tetap diperbarui.","info");
  }

  punishmentRecords[idx] = {
    ...punishmentRecords[idx],
    employeeId: emp.id, employeeName: emp.name, employeeNid: emp.nid, employeeBidang: emp.bidang,
    date, monthYear, action, desc, fileName, fileDataUrl
  };
  saveLocalData(); closeEditPunish(); showMessage("Perubahan PUNISHMEN disimpan.");

  currentPunishMonth = monthYear; const pm = document.getElementById("punish-filter-month"); if (pm) pm.value = currentPunishMonth;
  renderPunishList();
};

/* =========================================================================
 * AI CAMERA/IMAGE OCR (panel opsional)
 * ========================================================================= */
function initOcrUiBindings() {
  const openBtn   = document.getElementById("btn-open-camera");
  const video     = document.getElementById("ocr-video") || document.getElementById("video-el");
  const capture   = document.getElementById("btn-capture");
  const fileInput = document.getElementById("file-ocr");
  const applyBtn  = document.getElementById("ai-apply-btn");

  if (!openBtn && !fileInput) return; // panel AI tidak ada di HTML

  // kamera
  openBtn?.addEventListener("click", async () => {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (video) {
        video.srcObject = mediaStream;
        await video.play();
        capture?.removeAttribute("disabled");
      }
    } catch (e) {
      showMessage("Tidak bisa membuka kamera: " + e.message, "error");
    }
  });

  capture?.addEventListener("click", async () => {
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    await runOcr(dataUrl);
  });

  // file upload
  fileInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    await runOcr(url);
    URL.revokeObjectURL(url);
    e.target.value = "";
  });

  // apply ke data
  applyBtn?.addEventListener("click", () => {
    const selType = document.getElementById("ai-type")?.value || "";
    const empId   = document.getElementById("ai-employee")?.value || "";
    const dateVal = document.getElementById("ai-date")?.value || today.toISOString().slice(0,10);
    const timeVal = document.getElementById("ai-time")?.value || new Date().toTimeString().slice(0,5);

    if (!selType || !empId) { showMessage("Pilih tipe & karyawan hasil OCR dulu.", "error"); return; }

    // set tanggal/waktu ke form utama lalu panggil submitAttendance
    const dateInput = document.getElementById("input-date");
    const timeInput = document.getElementById("input-time");
    if (dateInput) dateInput.value = dateVal;
    if (timeInput) timeInput.value = timeVal;

    // set dropdown sesuai tipe
    const selectId = `select-${selType.toLowerCase().replace(/\s/g,"_")}`;
    const sel = document.getElementById(selectId);
    if (sel) sel.value = empId;

    window.submitAttendance(selType);
  });
}

async function runOcr(imageUrl) {
  if (!window.Tesseract) {
    showMessage("Tesseract.js belum dimuat. Tambahkan CDN di HTML.", "error");
    return;
  }
  const prog = document.getElementById("ocr-progress");
  const out  = document.getElementById("ocr-output");
  try {
    out && (out.value = "Memindai gambar...\n");
    const { data } = await Tesseract.recognize(imageUrl, "eng+ind", {
      logger: m => {
        if (m.status === "recognizing text" && prog) {
          prog.value = Math.round((m.progress || 0) * 100);
        }
      }
    });
    lastOcrText = data?.text || "";
    if (out) out.value = lastOcrText.trim();

    // coba parse dan isi saran
    fillAiSuggestionsFromText(lastOcrText);
  } catch (e) {
    showMessage("Gagal OCR: " + e.message, "error");
  } finally {
    if (prog) prog.value = 0;
  }
}

/* ===== Parsing teks laporan -> {type, names[]} ===== */
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAttendanceFromText(txt) {
  const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const joined = lines.join("\n");

  // key synonym -> type
  const keys = [
    { rx: /(ijin|izin)\s*:/i,           type: "IZIN" },
    { rx: /sakit\s*:/i,                 type: "Sakit" },
    { rx: /cuti\s*:/i,                  type: "Cuti" },
    { rx: /(dl|dinas\s*luar)\s*:/i,     type: "DINAS LUAR" },
    { rx: /(terlambat|telat)\s*:/i,     type: "Terlambat" },
    { rx: /(alpa|tanpa\s*keterangan|tk|td)\s*:/i, type: "ALPA" },
  ];

  const results = [];
  keys.forEach(k => {
    const m = joined.match(k.rx);
    if (!m) return;

    // ambil baris yang mengandung key tsb
    const keyLine = lines.find(l => k.rx.test(l));
    if (!keyLine) return;

    // ambil teks setelah ":" dan juga isi di dalam tanda kurung
    const raw = keyLine.split(":").slice(1).join(":");
    // contoh: "1( Moh. Fikri)" => ambil isi di dalam kurung kalau ada
    let inside = [];
    const paren = raw.match(/\(([^)]+)\)/g);
    if (paren) {
      paren.forEach(p => inside.push(p.replace(/[()]/g,"")));
    }

    let namesPart = inside.length ? inside.join(",") : raw;
    // pisah dengan koma
    let names = namesPart.split(/,|;|•|-/).map(s => s.trim()).filter(Boolean);

    // bersihkan angka/prefix qty
    names = names.map(n => n.replace(/^\d+\s*/,""));

    // buang simbol umum seperti "Moh." -> "Moh" (tetap aman)
    names = names.map(n => n.replace(/\./g," ").replace(/\s+/g," ").trim()).filter(Boolean);

    if (names.length) results.push({ type: k.type, names });
  });

  return results; // contoh: [ {type:"Cuti", names:["Moh Fikri"]}, ... ]
}

/* ===== Mencari karyawan terdekat dari nama ===== */
function findEmployeeIdByName(name) {
  const target = normalize(name);
  if (!target) return null;

  let best = { id: null, score: 0 };

  employees.forEach(e => {
    const n = normalize(e.name);
    if (!n) return;
    // skor sederhana: kecocokan token + includes
    let score = 0;
    const tokens = target.split(" ");
    tokens.forEach(t => { if (n.includes(t)) score += 1; });
    if (n.startsWith(target)) score += 1;
    if (target.startsWith(n)) score += 1;

    if (score > best.score) best = { id: e.id, score };
  });

  // ambang minimum 1 token cocok
  return best.score > 0 ? best.id : null;
}

/* ===== Isi saran hasil OCR ke panel ===== */
function fillAiSuggestionsFromText(text) {
  const parsed = parseAttendanceFromText(text || "");
  const selType = document.getElementById("ai-type");
  const selEmp  = document.getElementById("ai-employee");

  if (!selType || !selEmp) return;

  // default tanggal & waktu
  const aiDate = document.getElementById("ai-date");
  const aiTime = document.getElementById("ai-time");
  if (aiDate && !aiDate.value) aiDate.value = today.toISOString().slice(0,10);
  if (aiTime && !aiTime.value) aiTime.value = new Date().toTimeString().slice(0,5);

  if (!parsed.length) {
    showMessage("OCR selesai, tidak menemukan pola kategori/nama. Edit manual di panel OCR.", "info");
    return;
  }

  // ambil entri pertama sebagai default saran
  const first = parsed[0];
  selType.value = first.type;

  // coba match nama pertama ke database karyawan
  const empId = findEmployeeIdByName(first.names[0] || "");
  if (empId) selEmp.value = empId;
}

/* =========================================================================
 * FUNGSI GLOBAL UNTUK TOMBOL INLINE DI HTML (OCR CAMERA)
 * ========================================================================= */

// helper pilih elemen pertama dari daftar id/selector
function $first(idsOrSelectors) {
  for (const id of idsOrSelectors) {
    const el = id.startsWith('#') || id.startsWith('.') ? document.querySelector(id)
      : document.getElementById(id);
    if (el) return el;
  }
  return null;
}
function __getVideoEl() {
  return $first(['ocr-video', 'video-el', 'video#ocr-video', 'video#video-el', '#view-input video']);
}
function __getOutputEl() {
  return $first(['ocr-output', 'ocr-text']);
}
function __getOcrDateEl() {
  return $first(['ocr-date', 'ai-date', 'ocr-detected-date']);
}

function tryExtractDate(txt) {
  if (!txt) return null;
  // dd/mm/yyyy atau dd-mm-yyyy
  const m1 = txt.match(/(\b\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m1) {
    const d = String(m1[1]).padStart(2,'0');
    const M = String(m1[2]).padStart(2,'0');
    const y = m1[3];
    return `${y}-${M}-${d}`;
  }
  // “18 Oktober 2025”/“18 Okt 2025”
  const blnMap = {
    januari:1, jan:1, feb:2, februari:2, maret:3, mar:3,
    april:4, apr:4, mei:5, june:6, juni:6, jun:6, juli:7, jul:7,
    agustus:8, agt:8, agu:8, ags:8,
    september:9, sep:9, sept:9,
    oktober:10, okt:10,
    november:11, nov:11,
    desember:12, des:12
  };
  const norm = (s)=>String(s||"").toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const m2 = norm(txt).match(/(\d{1,2})\s+([a-z\.]+)\s+(\d{4})/);
  if (m2) {
    const d = String(m2[1]).padStart(2,'0');
    const mm = blnMap[m2[2].replace(/\./g,'')];
    if (mm) return `${m2[3]}-${String(mm).padStart(2,'0')}-${d}`;
  }
  return null;
}

// Buka kamera
async function startOCRCamera() {
  const video = __getVideoEl();
  if (!video) { showMessage('Elemen <video id="ocr-video"> tidak ditemukan.', 'error'); return; }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = mediaStream;
    await video.play();
    showMessage('Kamera aktif.');
  } catch (e) {
    showMessage('Tidak bisa membuka kamera: ' + e.message, 'error');
  }
}
// Stop kamera
function stopOCRCamera() {
  const video = __getVideoEl();
  if (video?.pause) video.pause();
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  if (video) video.srcObject = null;
  showMessage('Kamera dimatikan.', 'info');
}
// Tangkap frame & OCR
async function captureOCRAndParse() {
  const video = __getVideoEl();
  const out = __getOutputEl();
  if (!video) { showMessage('Video OCR tidak ditemukan.', 'error'); return; }
  if (!window.Tesseract) { showMessage('Tesseract.js belum dimuat.', 'error'); return; }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');

  if (typeof runOcr === 'function') {
    await runOcr(dataUrl);
    return;
  }
  try {
    out && (out.value = 'Memindai gambar...\n');
    const { data } = await Tesseract.recognize(dataUrl, 'eng+ind');
    const text = (data?.text || '').trim();
    if (out) out.value = text;
  } catch (e) {
    showMessage('Gagal OCR: ' + e.message, 'error');
  }
}
// Terapkan hasil OCR ke dashboard
async function applyOCRParsed() {
  const out = __getOutputEl();
  const ocrDateInput = __getOcrDateEl();
  if (!out) { showMessage('Textarea hasil OCR tidak ditemukan.', 'error'); return; }

  const text = out.value || '';
  const parsed = (typeof parseAttendanceFromText === 'function')
    ? parseAttendanceFromText(text)
    : [];

  let dateISO = ocrDateInput?.value || tryExtractDate(text) || today.toISOString().slice(0,10);
  if (ocrDateInput && !ocrDateInput.value) ocrDateInput.value = dateISO;

  const mainDate = document.getElementById('input-date');
  const mainTime = document.getElementById('input-time');
  if (mainDate) mainDate.value = dateISO;
  if (mainTime && !mainTime.value) mainTime.value = new Date().toTimeString().slice(0,5);

  if (!parsed.length) {
    showMessage('Tidak menemukan pola kategori/nama dari teks. Silakan koreksi manual.', 'info');
    return;
  }

  for (const group of parsed) {
    const type = group.type;
    for (const nm of group.names) {
      const empId = (typeof findEmployeeIdByName === 'function') ? findEmployeeIdByName(nm) : null;
      if (!empId) { console.warn('Nama tidak cocok:', nm); continue; }
      const selectId = `select-${type.toLowerCase().replace(/\s/g,'_')}`;
      const sel = document.getElementById(selectId);
      if (sel) sel.value = empId;
      try { if (typeof window.submitAttendance === 'function') await window.submitAttendance(type); }
      catch(e){ console.error('Gagal submit OCR untuk', nm, type, e); }
    }
  }
  showMessage('Hasil OCR diterapkan ke dashboard.');
}

// Ekspos global untuk onclick HTML
window.startOCRCamera     = startOCRCamera;
window.stopOCRCamera      = stopOCRCamera;
window.captureOCRAndParse = captureOCRAndParse;
window.applyOCRParsed     = applyOCRParsed;

/* =========================================================================
 * RENDER AWAL
 * ========================================================================= */
window.onload = () => { try { renderApp(); } catch(e) { console.error(e); } };
