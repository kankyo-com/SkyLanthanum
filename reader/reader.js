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
const ticketList = document.getElementById("ticketList");

const fields = {
  status: document.getElementById("statusValue"),
  quantity: document.getElementById("quantityValue"),
  name: document.getElementById("nameValue"),
  kana: document.getElementById("kanaValue"),
  transaction: document.getElementById("transactionValue"),
  ticket: document.getElementById("ticketValue"),
};

const summaryFields = {
  remainingPeople: document.getElementById("remainingPeople"),
  remainingQuantity: document.getElementById("remainingQuantity"),
  usedPeople: document.getElementById("usedPeople"),
  usedQuantity: document.getElementById("usedQuantity"),
  totalPeople: document.getElementById("totalPeople"),
  totalQuantity: document.getElementById("totalQuantity"),
};

let ticketMap = new Map();
let usedLog = [];
let currentTicket = null;
let controls = null;
let lastScanned = "";
let lastScannedAt = 0;
let currentFacingMode = "environment";
let restarting = false;
let audioContext = null;
let detectorTimer = null;

function prepareAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") audioContext.resume();
  } catch (_) {
    audioContext = null;
  }
}

function isScanning() {
  return Boolean(controls);
}

function stopCamera(message) {
  if (detectorTimer) clearInterval(detectorTimer);
  detectorTimer = null;
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
    prepareAudio();
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(1046, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    setTimeout(() => {
      oscillator.stop();
      oscillator.disconnect();
      gain.disconnect();
    }, 180);
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

function updateSummary() {
  const tickets = [...ticketMap.values()];
  const totalPeople = tickets.length;
  const totalQuantity = tickets.reduce((sum, ticket) => sum + Number(ticket.quantity || 0), 0);
  const usedTickets = tickets.filter((ticket) => ticket.status === "used");
  const usedPeople = usedTickets.length;
  const usedQuantity = usedTickets.reduce((sum, ticket) => sum + Number(ticket.quantity || 0), 0);
  const remainingPeople = totalPeople - usedPeople;
  const remainingQuantity = totalQuantity - usedQuantity;

  summaryFields.remainingPeople.textContent = `${remainingPeople}人`;
  summaryFields.remainingQuantity.textContent = `${remainingQuantity}基`;
  summaryFields.usedPeople.textContent = `${usedPeople}人`;
  summaryFields.usedQuantity.textContent = `${usedQuantity}基`;
  summaryFields.totalPeople.textContent = `${totalPeople}人`;
  summaryFields.totalQuantity.textContent = `${totalQuantity}基`;
}

function renderTicketList() {
  const tickets = [...ticketMap.values()].sort((a, b) => {
    const statusOrder = Number(a.status === "used") - Number(b.status === "used");
    if (statusOrder !== 0) return statusOrder;
    return String(a.kana || a.name || "").localeCompare(String(b.kana || b.name || ""), "ja");
  });

  if (!tickets.length) {
    ticketList.innerHTML = '<p class="empty-list">まだデータを読み込んでいません。</p>';
    updateSummary();
    return;
  }

  ticketList.innerHTML = tickets
    .map((ticket) => {
      const used = ticket.status === "used";
      return `
        <div class="ticket-list-row ${used ? "is-used" : ""}">
          <div>
            <strong>${ticket.name || "-"}</strong>
            <span>${ticket.kana || ""}</span>
          </div>
          <div class="list-quantity">${ticket.quantity || 0}基</div>
          <div class="list-status">${used ? "受渡済" : "未受渡"}</div>
        </div>
      `;
    })
    .join("");
  updateSummary();
}

function startNativeDetectorLoop() {
  if (!("BarcodeDetector" in window)) return;
  let detector;
  try {
    detector = new BarcodeDetector({ formats: ["qr_code"] });
  } catch (_) {
    return;
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  detectorTimer = setInterval(async () => {
    if (!controls || preview.readyState < 2 || !preview.videoWidth || !preview.videoHeight) return;
    try {
      canvas.width = preview.videoWidth;
      canvas.height = preview.videoHeight;
      context.drawImage(preview, 0, 0, canvas.width, canvas.height);
      const codes = await detector.detect(canvas);
      const rawValue = codes?.[0]?.rawValue;
      if (rawValue) handleTicketId(rawValue);
    } catch (_) {
      // Native detection can fail on transient video frames.
    }
  }, 120);
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
  renderTicketList();
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
  prepareAudio();
  const file = dataFile.files?.[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  ticketMap = new Map((data.tickets || []).map((ticket) => [ticket.ticket_id, ticket]));
  usedLog = [];
  currentTicket = null;
  clearResult();
  renderTicketList();
  dataStatus.textContent = `${data.event || "イベント"}: ${ticketMap.size}件のチケットを読み込みました。`;
  startButton.disabled = ticketMap.size === 0;
  switchCameraButton.disabled = ticketMap.size === 0;
  exportButton.disabled = true;
  if (ticketMap.size > 0) await startCamera();
});

async function startCamera() {
  prepareAudio();
  if (!ticketMap.size) return;
  if (isScanning() || restarting) return;
  restarting = true;
  const reader = new ZXingBrowser.BrowserQRCodeReader(undefined, {
    delayBetweenScanAttempts: 80,
    delayBetweenScanSuccess: 250,
  });
  scanStatus.textContent = "カメラを起動しています。";
  try {
    controls = await reader.decodeFromConstraints(
      {
        video: {
          facingMode: { ideal: currentFacingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      },
      preview,
      (result) => {
        if (result) handleTicketId(result.getText());
      },
    );
    try {
      await controls.streamVideoConstraintsApply?.({
        advanced: [{ focusMode: "continuous" }],
      });
    } catch (_) {
      // Some iPad/Safari combinations do not expose focus constraints.
    }
    startButton.disabled = true;
    stopButton.disabled = false;
    switchCameraButton.disabled = false;
    const label = currentFacingMode === "user" ? "前面カメラ" : "背面カメラ";
    scanStatus.textContent = `${label}でQRコードを読み取れます。`;
    startNativeDetectorLoop();
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
