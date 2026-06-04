const DEFAULT_CONFIG = globalThis.TK_DEFAULT_CONFIG;

const form = document.getElementById("configForm");
const engineInput = document.getElementById("engine");
const llmModelInput = document.getElementById("llmModel");
const llmBaseURLInput = document.getElementById("llmBaseURL");
const llmApiKeyInput = document.getElementById("llmApiKey");
const loopSizeInput = document.getElementById("loopSize");
const msgInput = document.getElementById("msg");
const sentInput = document.getElementById("sent");
const testModeInput = document.getElementById("testMode");
const statusEl = document.getElementById("status");
const reloadBtn = document.getElementById("reloadBtn");

function setStatus(text, isError = false) {
	statusEl.textContent = text;
	statusEl.style.color = isError ? "#d92d20" : "#0f9f6e";
	if (text) {
		setTimeout(() => {
			if (statusEl.textContent === text) statusEl.textContent = "";
		}, 2500);
	}
}

function normalizeCsv(value) {
	const result = [];
	for (const item of String(value || "").split(/[\n,]/)) {
		const trimmed = item.trim();
		if (trimmed && !result.includes(trimmed)) result.push(trimmed);
	}
	return result.join(",");
}

async function loadConfig() {
	const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
	const merged = {
		...DEFAULT_CONFIG,
		...config,
		msg: String(config.msg || "").trim() ? config.msg : DEFAULT_CONFIG.msg,
	};
	engineInput.value = merged.engine || "dom";
	llmModelInput.value = merged.llmModel || "";
	llmBaseURLInput.value = merged.llmBaseURL || "";
	llmApiKeyInput.value = merged.llmApiKey || "";
	loopSizeInput.value = merged.loopSize;
	msgInput.value = merged.msg;
	sentInput.value = merged.sent;
	testModeInput.checked =
		merged.testMode === true || merged.testMode === "true";
}

async function saveConfig() {
	const loopSize = Math.max(1, parseInt(loopSizeInput.value || "10", 10));
	await chrome.storage.local.set({
		engine: engineInput.value || "dom",
		llmModel: llmModelInput.value || "",
		llmBaseURL: llmBaseURLInput.value || "",
		llmApiKey: llmApiKeyInput.value || "",
		loopSize: String(loopSize),
		msg: msgInput.value || "",
		sent: normalizeCsv(sentInput.value),
		testMode: testModeInput.checked,
	});
	loopSizeInput.value = String(loopSize);
	sentInput.value = normalizeCsv(sentInput.value);
	setStatus("保存しました");
}

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	try {
		await saveConfig();
	} catch (err) {
		console.error(err);
		setStatus(err?.message || "保存に失敗しました", true);
	}
});

reloadBtn.addEventListener("click", async () => {
	await loadConfig();
	setStatus("再読み込みしました");
});

loadConfig().catch((err) => {
	console.error(err);
	setStatus(err?.message || "読み込みに失敗しました", true);
});
