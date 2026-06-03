const dataFile = document.getElementById("dataFile");
const dataStatus = document.getElementById("dataStatus");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const exportButton = document.getElementById("exportButton");
const preview = document.getElementById("preview");
const scanStatus = document.getElementById("scanStatus");
const resultBox = document.getElementById("result");
const useButton = document.getElementById("useButton");

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

function setResult(ticket, state, className) {
  resultBox.className = `result visible ${className || ""}`.trim();
  fields.status.textContent = state;
  fields.quantity.textContent = ticket ? `${ticket.quantity}基` : "-";
  fields.name.textContent = ticket?.name || "-";
  fields.kana.textContent = ticket?.kana || "-";
  fields.transaction.textContent = ticket ? `下4桁 ${ticket.transaction_last4 || ""}` : "-";
  fields.ticket.textContent = ticket?.ticket_id || lastScanned || "-";
  useButton.disabled = !ticket || ticket.status === "used";
  currentTicket = ticket;
}

function markUsed() {
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
  setResult(currentTicket, "使用済み", "used");
  scanStatus.textContent = "受渡済にしました。同じQRを読むと使用済み警告が出ます。";
}

function handleTicketId(rawText) {
  const ticketId = String(rawText || "").trim();
  const now = Date.now();
  if (ticketId === lastScanned && now - lastScannedAt < 1600) return;
  lastScanned = ticketId;
  lastScannedAt = now;

  const ticket = ticketMap.get(ticketId);
  if (!ticket) {
    setResult(null, "該当なし", "error");
    scanStatus.textContent = "このQRコードは当日データにありません。責任者へ確認してください。";
    return;
  }

  if (ticket.status === "used") {
    setResult(ticket, "使用済み", "used");
    scanStatus.textContent = "このチケットはすでに受渡済みです。追加配布せず責任者へ確認してください。";
    return;
  }

  setResult(ticket, "未受渡", "ok");
  scanStatus.textContent = "氏名と購入基数を確認し、表示された基数分を渡してください。";
}

dataFile.addEventListener("change", async () => {
  const file = dataFile.files?.[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  ticketMap = new Map((data.tickets || []).map((ticket) => [ticket.ticket_id, ticket]));
  usedLog = [];
  currentTicket = null;
  dataStatus.textContent = `${data.event || "イベント"}: ${ticketMap.size}件のチケットを読み込みました。`;
  startButton.disabled = ticketMap.size === 0;
  exportButton.disabled = true;
});

startButton.addEventListener("click", async () => {
  if (!ticketMap.size) return;
  const reader = new ZXingBrowser.BrowserQRCodeReader();
  scanStatus.textContent = "カメラを起動しています。";
  controls = await reader.decodeFromVideoDevice(null, preview, (result, error) => {
    if (result) handleTicketId(result.getText());
  });
  startButton.disabled = true;
  stopButton.disabled = false;
  scanStatus.textContent = "QRコードを読み取れます。";
});

stopButton.addEventListener("click", () => {
  if (controls) controls.stop();
  controls = null;
  startButton.disabled = ticketMap.size === 0;
  stopButton.disabled = true;
  scanStatus.textContent = "カメラを停止しました。";
});

useButton.addEventListener("click", markUsed);

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
