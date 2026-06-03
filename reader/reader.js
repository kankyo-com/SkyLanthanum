const dataFile = document.getElementById("dataFile");
const dataStatus = document.getElementById("dataStatus");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const switchCameraButton = document.getElementById("switchCameraButton");
const exportButton = document.getElementById("exportButton");
const preview = document.getElementById("preview");
const scanStatus = document.getElementById("scanStatus");
const resultBox = document.getElementById("result");
const resultBanner = document.getElementById("resultBanner");
const useButton = document.getElementById("useButton");
const cancelButton = document.getElementById("cancelButton");

const fields = {
  status: document.getElementById("statusValue"),
  quantity: document.getElementById("quantityValue"),
  name: document.getElementById("nameValue"),
  kana: document.getElementById("kanaValue"),
  transaction: document.getElementById("transactionValue"),
  ticket: document.getElementById("ticketValue"),
};

let ticketMap = new Map();
let usedLog = [];
let currentTicket = null;
let controls = null;
let lastScanned = "";
let lastScannedAt = 0;
let currentFacingMode = "user";
let restarting = false;

function isScanning() {
  return Boolean(controls);
}

function stopCamera(message) {
  if (controls) controls.stop();
  controls = null;
  startButton.disabled = ticketMap.size === 0;
  stopButton.disabled = true;
  switchCameraButton.disabled = ticketMap.size === 0;
  if (message) scanStatus.textContent = message;
}

function feedback() {
  try {
    navigator.vibrate?.(120);
  } catch (_) {
    // Vibration is optional and unsupported on some iPads.
  }
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audio = new AudioContextClass();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.05;
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      audio.close();
    }, 110);
  } catch (_) {
    // Audio feedback is optional; the visual banner is the primary signal.
  }
}

function scrollToResult() {
  setTimeout(() => resultBox.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
}

function clearResult() {
  resultBox.className = "result";
  resultBanner.textContent = "読み取り待ち";
  fields.status.textContent = "-";
  fields.quantity.textContent = "-";
  fields.name.textContent = "-";
  fields.kana.textContent = "-";
  fields.transaction.textContent = "-";
  fields.ticket.textContent = "-";
  useButton.disabled = true;
  currentTicket = null;
}

function setResult(ticket, state, className) {
  resultBox.className = `result visible ${className || ""}`.trim();
  resultBanner.textContent = state === "未受渡" ? "読み取りました" : state;
  fields.status.textContent = state;
  fields.quantity.textContent = ticket ? `${ticket.quantity}基` : "-";
  fields.name.textContent = ticket?.name || "-";
  fields.kana.textContent = ticket?.kana || "-";
  fields.transaction.textContent = ticket ? `下4桁 ${ticket.transaction_last4 || ""}` : "-";
  fields.ticket.textContent = ticket?.ticket_id || lastScanned || "-";
  useButton.disabled = !ticket || ticket.status === "used";
  currentTicket = ticket;
}

async function restartScanner(message) {
  clearResult();
  lastScanned = "";
  lastScannedAt = 0;
  scanStatus.textContent = message || "次のQRコードを読み取れます。";
  if (ticketMap.size) await startCamera();
}

async function markUsed() {
  if (!currentTicket || currentTicket.status === "used") return;
  currentTicket.status = "used";
  currentTicket.used_at = new Date().toISOString();
  usedLog.push({
    ticket_id: currentTicket.ticket_id,
    name: currentTicket.name,
    kana: currentTicket.kana,
    quantity: currentTicket.quantity,
    used_at: currentTicket.used_at,
  });
  exportButton.disabled = false;
  await restartScanner("受渡済にしました。次のQRコードを読み取れます。");
}

function handleTicketId(rawText) {
  const ticketId = String(rawText || "").trim();
  const now = Date.now();
  if (ticketId === lastScanned && now - lastScannedAt < 1600) return;
  lastScanned = ticketId;
  lastScannedAt = now;
  stopCamera("読み取りました。内容を確認してください。");
  feedback();

  const ticket = ticketMap.get(ticketId);
  if (!ticket) {
    setResult(null, "該当なし", "error");
    scanStatus.textContent = "このQRコードは当日データにありません。責任者へ確認してください。";
    scrollToResult();
    return;
  }

  if (ticket.status === "used") {
    setResult(ticket, "使用済み", "used");
    scanStatus.textContent = "このチケットはすでに受渡済みです。追加配布せず責任者へ確認してください。";
    scrollToResult();
    return;
  }

  setResult(ticket, "未受渡", "ok");
  scanStatus.textContent = "氏名と購入基数を確認し、表示された基数分を渡してください。";
  scrollToResult();
}

dataFile.addEventListener("change", async () => {
  const file = dataFile.files?.[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  ticketMap = new Map((data.tickets || []).map((ticket) => [ticket.ticket_id, ticket]));
  usedLog = [];
  currentTicket = null;
  clearResult();
  dataStatus.textContent = `${data.event || "イベント"}: ${ticketMap.size}件のチケットを読み込みました。`;
  startButton.disabled = ticketMap.size === 0;
  switchCameraButton.disabled = ticketMap.size === 0;
  exportButton.disabled = true;
  if (ticketMap.size > 0) await startCamera();
});

async function startCamera() {
  if (!ticketMap.size) return;
  if (isScanning() || restarting) return;
  restarting = true;
  const reader = new ZXingBrowser.BrowserQRCodeReader();
  scanStatus.textContent = "カメラを起動しています。";
  try {
    controls = await reader.decodeFromConstraints(
      { video: { facingMode: currentFacingMode } },
      preview,
      (result) => {
        if (result) handleTicketId(result.getText());
      },
    );
    startButton.disabled = true;
    stopButton.disabled = false;
    switchCameraButton.disabled = false;
    const label = currentFacingMode === "user" ? "前面カメラ" : "背面カメラ";
    scanStatus.textContent = `${label}でQRコードを読み取れます。`;
  } catch (error) {
    controls = null;
    startButton.disabled = ticketMap.size === 0;
    stopButton.disabled = true;
    scanStatus.textContent = `カメラを開始できませんでした: ${error.message || error}`;
  } finally {
    restarting = false;
  }
}

startButton.addEventListener("click", startCamera);

stopButton.addEventListener("click", () => {
  stopCamera("カメラを停止しました。");
});

switchCameraButton.addEventListener("click", async () => {
  currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
  stopCamera("カメラを切り替えています。");
  await startCamera();
});

useButton.addEventListener("click", markUsed);
cancelButton.addEventListener("click", async () => {
  await restartScanner("キャンセルしました。次のQRコードを読み取れます。");
});

exportButton.addEventListener("click", () => {
  const header = ["ticket_id", "name", "kana", "quantity", "used_at"];
  const lines = [header.join(",")];
  for (const row of usedLog) {
    lines.push(header.map((key) => `"${String(row[key] ?? "").replaceAll('"', '""')}"`).join(","));
  }
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `used_log_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});
