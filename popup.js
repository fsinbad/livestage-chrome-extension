// Popup controller
// Architecture: popup sets state in chrome.storage.local, then navigates to the start page.
// Content script auto-detects the state on page load and resumes execution.

const taskButtons = Array.from(document.querySelectorAll(".task-button"));
const stopButton = document.getElementById("btnStop");
const configButton = document.getElementById("btnConfig");
const engineSelect = document.getElementById("engineSelect");
const statusEl = document.getElementById("status");

const taskLabels = {
	getCreator: "1. クリエイター取得",
	invite: "2. 招待チェック",
	sendMessage: "3. メッセージ送信",
};

const runningLabels = {
	getCreator: "クリエイター取得実行中...",
	invite: "招待チェック実行中...",
	sendMessage: "メッセージ送信中...",
};

function setStatus(text) {
	statusEl.textContent = text;
}

function setUiState({ task = null, step = 0 } = {}) {
	const isRunning = Boolean(task);

	for (const button of taskButtons) {
		const buttonTask = button.dataset.task;
		const isActive = buttonTask === task;

		button.disabled = isRunning;
		button.classList.toggle("running", isActive);
		button.textContent = isActive
			? runningLabels[buttonTask]
			: taskLabels[buttonTask];
	}

	stopButton.disabled = !isRunning;
	setStatus(
		isRunning
			? `実行中: ${task} (ステップ ${step ?? 0})`
			: "準備完了 — タスクをクリックして開始",
	);
}

async function findOrCreateTab(url) {
	const tabs = await chrome.tabs.query({ url });
	if (tabs.length > 0) {
		await chrome.tabs.update(tabs[0].id, { active: true });
		return tabs[0];
	}
	return null;
}

function getTaskStartUrl(taskName) {
	if (taskName === "getCreator")
		return "https://www.tiktok.com/live?lang=ja-JP";
	if (taskName === "invite") {
		return "https://live-backstage.tiktok.com/portal/anchor/relation";
	}
	return "https://live-backstage.tiktok.com/portal";
}

async function launchTask(taskName) {
	const current = await chrome.storage.local.get(["tkTask"]);
	if (current.tkTask) return;

	const engine = engineSelect.value || "dom";
	setUiState({ task: taskName, step: 0 });

	// Clear any stale task state while keeping data keys like users/chats.
	await chrome.storage.local.remove(["tkTask", "tkStep", "tkData"]);

	// Set fresh initial state. Content script step 0 will load local config data.
	await chrome.storage.local.set({
		tkTask: taskName,
		tkStep: 0,
		tkData: {},
		tkEngine: engine,
	});

	const startUrl = getTaskStartUrl(taskName);

	// Try to find an existing TikTok tab to reuse.
	let tab = null;
	if (taskName === "getCreator") {
		tab = await findOrCreateTab("https://www.tiktok.com/live*");
	} else {
		tab = await findOrCreateTab("https://live-backstage.tiktok.com/*");
	}

	if (!tab) {
		tab = await findOrCreateTab("https://www.tiktok.com/live*");
	}

	if (tab) {
		await chrome.tabs.update(tab.id, {
			active: true,
			url: startUrl,
		});
	} else {
		await chrome.tabs.create({ url: startUrl });
	}
}

for (const button of taskButtons) {
	button.addEventListener("click", () => launchTask(button.dataset.task));
}

configButton.addEventListener("click", () => {
	chrome.runtime.openOptionsPage();
});

stopButton.addEventListener("click", async () => {
	if (stopButton.disabled) return;
	await chrome.storage.local.remove(["tkTask", "tkStep", "tkData"]);
	setUiState();
	setStatus("停止しました。ページを更新すると実行中の操作がキャンセルされます。");
});

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== "local") return;
	if (!changes.tkTask && !changes.tkStep) return;

	chrome.storage.local.get(["tkTask", "tkStep"], (res) => {
		setUiState({ task: res.tkTask || null, step: res.tkStep ?? 0 });
	});
});

// Load saved engine preference and current task on open
chrome.storage.local.get(["engine", "tkTask", "tkStep"], (res) => {
	if (engineSelect && res.engine) engineSelect.value = res.engine;
	setUiState({ task: res.tkTask || null, step: res.tkStep ?? 0 });
});

// Persist engine selection
if (engineSelect) {
	engineSelect.addEventListener("change", async () => {
		await chrome.storage.local.set({ engine: engineSelect.value });
	});
}
