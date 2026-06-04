// ==================== TikTok Live Automation — Content Script ====================
// Converted from Selenium IDE .side file
// Architecture: state-machine with chrome.storage.local persistence across navigations

const tick = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function waitUntil(
	predicate,
	{ timeout = 10000, message = "condition", interval = 100 } = {},
) {
	const start = Date.now();

	return await new Promise((resolve, reject) => {
		let done = false;
		let timer = null;
		let observer = null;

		const cleanup = () => {
			done = true;
			if (timer) clearTimeout(timer);
			if (observer) observer.disconnect();
		};

		const check = async () => {
			if (done) return;
			try {
				const result = await predicate();
				if (result) {
					cleanup();
					resolve(result);
					return;
				}
			} catch (_err) {
				// Keep waiting until timeout. Predicates may throw while DOM is shifting.
			}

			if (Date.now() - start >= timeout) {
				cleanup();
				reject(new Error(`Timeout waiting for ${message}`));
				return;
			}

			timer = setTimeout(check, interval);
		};

		observer = new MutationObserver(check);
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			characterData: true,
		});

		void check();
	});
}

// ---------- Local config helpers ----------
// All configuration lives in extension-local chrome.storage.local.
const DEFAULT_CONFIG = globalThis.TK_DEFAULT_CONFIG;

async function loadLocalConfig() {
	const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
	return {
		...DEFAULT_CONFIG,
		...config,
		msg: String(config.msg || "").trim() ? config.msg : DEFAULT_CONFIG.msg,
	};
}

async function appendLocalSent(newsent) {
	const config = await loadLocalConfig();
	const mergedSent = csvDistinct([
		...parseCsv(config.sent),
		...parseCsv(newsent),
	]);
	await chrome.storage.local.set({ sent: mergedSent });
	return mergedSent;
}

function parseCsv(value) {
	return String(value || "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function csvDistinct(items) {
	const result = [];
	for (const item of items || []) {
		const trimmed = String(item || "").trim();
		if (trimmed && !result.includes(trimmed)) result.push(trimmed);
	}
	return result.join(",");
}

// ---------- DOM helpers ----------

function isEnabled(el) {
	if (!el) return false;
	return (
		!el.disabled &&
		el.getAttribute("aria-disabled") !== "true" &&
		!el.classList?.contains("semi-button-disabled")
	);
}

function isReadyElement(el, { requireEnabled = false } = {}) {
	return isVisible(el) && (!requireEnabled || isEnabled(el));
}

async function waitForElement(selector, timeout = 10000) {
	return await waitUntil(
		() => {
			const el = document.querySelector(selector);
			return isReadyElement(el) ? el : null;
		},
		{
			timeout,
			message: `visible element ${selector}`,
		},
	);
}

async function waitForElementReady(selector, timeout = 10000) {
	return await waitUntil(
		() => {
			const el = document.querySelector(selector);
			return isReadyElement(el, { requireEnabled: true }) ? el : null;
		},
		{
			timeout,
			message: `ready element ${selector}`,
		},
	);
}

async function waitForXPathReady(xpath, timeout = 10000) {
	return await waitUntil(
		() => {
			const r = document.evaluate(
				xpath,
				document,
				null,
				XPathResult.FIRST_ORDERED_NODE_TYPE,
				null,
			);
			return isReadyElement(r.singleNodeValue, { requireEnabled: true })
				? r.singleNodeValue
				: null;
		},
		{
			timeout,
			message: `ready xpath ${xpath}`,
		},
	);
}

async function clickXPath(xpath, timeout = 10000) {
	const el = await waitForXPathReady(xpath, timeout);
	clickElementLikeUser(el);
	return el;
}

function setElementValue(el, text) {
	const value = String(text ?? "");
	const prototype =
		el instanceof HTMLTextAreaElement
			? HTMLTextAreaElement.prototype
			: HTMLInputElement.prototype;
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

	if (descriptor?.set) {
		descriptor.set.call(el, value);
	} else {
		el.value = value;
	}

	let inputEvent;
	try {
		inputEvent = new InputEvent("input", {
			bubbles: true,
			inputType: "insertText",
			data: value,
		});
	} catch (_err) {
		inputEvent = new Event("input", { bubbles: true });
	}
	el.dispatchEvent(inputEvent);
	el.dispatchEvent(new Event("change", { bubbles: true }));
}

function isVisible(el) {
	if (!el) return false;
	const rect = el.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
}

function clickableAncestor(el) {
	return (
		el?.closest(
			'button, a, [role="button"], [role="menuitem"], li[tabindex], div[tabindex]',
		) || el
	);
}

async function waitForFirstSelector(selectors, timeout = 10000, options = {}) {
	return await waitUntil(
		() => {
			for (const selector of selectors) {
				const el = document.querySelector(selector);
				if (isReadyElement(el, options)) return el;
			}
			return null;
		},
		{
			timeout,
			message: `selectors ${selectors.join(", ")}`,
		},
	);
}

async function openRelationPage() {
	if (location.href.includes("/portal/anchor/relation")) return true;

	const relationMenu = await waitUntil(
		() => {
			const el = document.querySelector('[data-id="menu-anchor-relation"]');
			const target = clickableAncestor(el);
			return isReadyElement(target, { requireEnabled: true }) ? target : null;
		},
		{ timeout: 5000, message: "relation menu node" },
	).catch(() => null);

	if (relationMenu) {
		clickElementLikeUser(relationMenu);
		const reached = await waitUntil(
			() => location.href.includes("/portal/anchor/relation"),
			{ timeout: 8000, message: "relation page route" },
		).catch(() => false);
		if (reached) return true;
	}

	navigate("https://live-backstage.tiktok.com/portal/anchor/relation");
	return false;
}

function getInviteTextareaSelector() {
	return [
		'.semi-sidesheet textarea[data-testid="inviteHostTextArea"]',
		'.semi-sidesheet [data-id="invite-host-step-one"] textarea',
		".semi-sidesheet textarea.semi-input-textarea",
		".semi-sidesheet textarea",
	].join(", ");
}

async function ensureInviteSideSheetOpen() {
	const textareaSelector = getInviteTextareaSelector();
	const existingTextarea = document.querySelector(textareaSelector);
	if (isReadyElement(existingTextarea, { requireEnabled: true })) return;

	const addHostButton = await waitForFirstSelector(
		[
			'button[data-id="add-host"]',
			'button[data-e2e-tag="host_manageRelationship_addHostBtn"]',
			'[data-id="relation-management"] button[data-id="add-host"]',
		],
		15000,
		{ requireEnabled: true },
	);
	clickElementLikeUser(addHostButton);
	await waitForElementReady(textareaSelector, 15000);
}

function getInviteNextButton() {
	return document.querySelector(
		'.semi-sidesheet button[data-id="invite-host-next"]',
	);
}

async function waitForInviteNextButton(timeout = 10000) {
	return await waitUntil(
		() => {
			const button = getInviteNextButton();
			return isReadyElement(button, { requireEnabled: true }) ? button : null;
		},
		{ timeout, message: "invite next button node" },
	);
}

function getInviteBackButton() {
	const stable =
		document.querySelector(
			'.semi-sidesheet button[data-id="invite-host-back"]',
		) ||
		document.querySelector(
			'.semi-sidesheet button[data-id="invite-host-prev"]',
		);
	if (isReadyElement(stable, { requireEnabled: true })) return stable;

	// Fallback: in step 2, the footer usually contains only the back/return action.
	const footerButtons = Array.from(
		document.querySelectorAll(
			".semi-sidesheet-footer button, .bottomFooter-W_itdd button",
		),
	).filter((button) => isReadyElement(button, { requireEnabled: true }));
	return footerButtons[footerButtons.length - 1] || null;
}

async function waitForInviteBackButton(timeout = 10000) {
	return await waitUntil(
		() => {
			const button = getInviteBackButton();
			return isReadyElement(button, { requireEnabled: true }) ? button : null;
		},
		{ timeout, message: "invite back button node" },
	);
}

async function openInstantMessagesPage() {
	if (location.href.includes("/portal/anchor/instant-messages")) {
		appendFloatingLog(
			"Already on instant messages page; waiting for search input...",
		);
		await waitForInstantMessageSearchInput(15000);
		return true;
	}

	appendFloatingLog("Waiting for instant messages menu node...");
	let instantMenu = await waitUntil(
		() => {
			const el = document.querySelector(
				'[data-id="menu-anchor-instant-messages"]',
			);
			const target = clickableAncestor(el);
			return isReadyElement(target, { requireEnabled: true }) ? target : null;
		},
		{ timeout: 5000, message: "instant messages menu node" },
	).catch(() => null);

	if (!instantMenu) {
		appendFloatingLog("Instant menu hidden; opening anchor menu...");
		const anchorMenu = await waitUntil(
			() => {
				const el = document.querySelector('[data-id="menu-anchor"]');
				const target = clickableAncestor(el);
				return isReadyElement(target, { requireEnabled: true }) ? target : null;
			},
			{ timeout: 8000, message: "anchor menu node" },
		).catch(() => null);
		if (anchorMenu) {
			clickElementLikeUser(anchorMenu);
			instantMenu = await waitUntil(
				() => {
					const el = document.querySelector(
						'[data-id="menu-anchor-instant-messages"]',
					);
					const target = clickableAncestor(el);
					return isReadyElement(target, { requireEnabled: true })
						? target
						: null;
				},
				{ timeout: 8000, message: "instant messages menu after anchor open" },
			).catch(() => null);
		}
	}

	if (!instantMenu) throw new Error("Instant messages menu not found");

	appendFloatingLog("Clicking instant messages menu...");
	clickElementLikeUser(instantMenu);
	await waitUntil(
		() => location.href.includes("/portal/anchor/instant-messages"),
		{ timeout: 10000, message: "instant messages route" },
	).catch(() => null);
	await waitForInstantMessageSearchInput(15000);
	return true;
}

function findInstantMessageSearchInput() {
	const inputs = Array.from(document.querySelectorAll("input"))
		.filter((el) => isReadyElement(el, { requireEnabled: true }))
		.map((el) => {
			const rect = el.getBoundingClientRect();
			const placeholder = el.getAttribute("placeholder") || "";
			const context = el.closest(
				'[data-id], [class*="search"], [class*="Search"]',
			);
			const label = [
				placeholder,
				el.getAttribute("aria-label") || "",
				context?.getAttribute("data-id") || "",
				context?.className || "",
			]
				.join(" ")
				.toLowerCase();
			const score =
				(placeholder.includes("主播") || placeholder.includes("用户")
					? 50
					: 0) +
				(label.includes("username") || label.includes("user") ? 20 : 0) +
				(label.includes("search") ? 15 : 0) +
				(rect.x > 240 && rect.x < 680 && rect.y > 120 && rect.y < 260
					? 20
					: 0) +
				(rect.width > 180 ? 5 : 0) +
				(placeholder ? 5 : -10);
			return { el, score };
		})
		.sort((a, b) => b.score - a.score);
	return inputs[0]?.score > 0 ? inputs[0].el : null;
}

async function waitForInstantMessageSearchInput(timeout = 10000) {
	return await waitUntil(() => findInstantMessageSearchInput(), {
		timeout,
		message: "instant message search input node",
	});
}

function getInviteResultRow(user) {
	const rows = Array.from(
		document.querySelectorAll(
			'.semi-sidesheet [data-id="host-table"] tbody tr, .semi-sidesheet table tbody tr',
		),
	).filter(isVisible);
	if (user) {
		const matched = rows.find((row) =>
			(row.innerText || row.textContent || "").includes(user),
		);
		if (matched) return matched;
	}
	return rows[0] || null;
}

function getInviteStatus(user) {
	const row = getInviteResultRow(user);
	if (row) {
		const statusCell = Array.from(row.querySelectorAll("td"))[1];
		const statusText = (statusCell?.innerText || statusCell?.textContent || "")
			.trim()
			.replace(/\s+/g, " ");
		if (statusText) return statusText;

		const rowTag = Array.from(
			row.querySelectorAll(
				".liveplatform-status-tag, .semi-tag-content, .semi-tag",
			),
		).find(isVisible);
		const rowTagText = (rowTag?.innerText || rowTag?.textContent || "")
			.trim()
			.replace(/\s+/g, " ");
		if (rowTagText) return rowTagText;
	}

	const tags = Array.from(
		document.querySelectorAll(
			'.semi-sidesheet [data-id="host-table"] .liveplatform-status-tag, .semi-sidesheet [data-id="host-table"] .semi-tag-content',
		),
	).filter(isVisible);
	return (tags[0]?.innerText || tags[0]?.textContent || "").trim();
}

function getInviteCandidateActionButton(user) {
	const row = getInviteResultRow(user);
	if (!row) return null;
	return (
		Array.from(
			row.querySelectorAll('button[data-id^="invite-pillar"], button'),
		).find((button) => isVisible(button) && !button.disabled) || null
	);
}

async function waitForInviteCandidateResult(user, timeout = 10000) {
	return await waitUntil(
		() => {
			const row = getInviteResultRow(user);
			const status = getInviteStatus(user);
			if (row && status) {
				return {
					row,
					status,
					actionButton: getInviteCandidateActionButton(user),
				};
			}
			return null;
		},
		{ timeout, message: `invite candidate result ${user}` },
	);
}

function extractTikTokUsername(href) {
	const match = String(href || "").match(/\/@([^/?#]+)/);
	return match ? decodeURIComponent(match[1]) : "";
}

function getVisibleArea(el) {
	const rect = el.getBoundingClientRect();
	const left = Math.max(0, rect.left);
	const top = Math.max(0, rect.top);
	const right = Math.min(window.innerWidth, rect.right);
	const bottom = Math.min(window.innerHeight, rect.bottom);
	return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function getMainLiveAnchors() {
	return Array.from(document.querySelectorAll('a[href*="/@"][href*="/live"]'))
		.filter(isVisible)
		.map((el) => {
			const rect = el.getBoundingClientRect();
			const href = el.getAttribute("href") || "";
			const username = extractTikTokUsername(href);
			const area = getVisibleArea(el);
			// Main LIVE feed cards are large and start after the left navigation rail.
			// Left creator recommendations and bottom grid cards also contain /@.../live,
			// so only accept large center feed items here.
			const isMainLiveFeed =
				rect.x > 220 && rect.width > 700 && rect.height > 250;
			return { el, href, username, rect, area, isMainLiveFeed };
		})
		.filter((item) => item.username && item.area > 0 && item.isMainLiveFeed);
}

function findCreatorAnchor() {
	const anchors = getMainLiveAnchors().sort((a, b) => b.area - a.area);
	return anchors[0]?.el || null;
}

function findNextMainLiveAnchor(previousUsername, seenUsers = new Set()) {
	const current = findCreatorAnchor();
	const currentRect = current?.getBoundingClientRect();
	const minY = currentRect ? currentRect.top + 80 : 80;
	const candidates = getMainLiveAnchors()
		.filter((item) => item.rect.top > minY)
		.filter((item) => item.username !== previousUsername)
		.sort((a, b) => {
			const aSeen = seenUsers.has(a.username) ? 1 : 0;
			const bSeen = seenUsers.has(b.username) ? 1 : 0;
			return aSeen - bSeen || a.rect.top - b.rect.top;
		});
	return candidates[0]?.el || null;
}

function scrollToNextCreatorCard(previousUsername, seenUsers) {
	const target = findNextMainLiveAnchor(previousUsername, seenUsers);
	if (target) {
		target.scrollIntoView({
			block: "start",
			inline: "nearest",
			behavior: "smooth",
		});
		return true;
	}
	window.scrollBy({
		top: Math.max(420, window.innerHeight * 0.55),
		behavior: "smooth",
	});
	return false;
}

async function waitForCreatorAnchor(timeout = 30000) {
	return await waitUntil(() => findCreatorAnchor(), {
		timeout,
		message: "TikTok creator link",
		interval: 250,
	});
}

function getCurrentCreatorUsername() {
	const anchor = findCreatorAnchor();
	return extractTikTokUsername(anchor?.getAttribute("href") || "");
}

function clickElementLikeUser(el) {
	const rect = el.getBoundingClientRect();
	const x = rect.left + rect.width / 2;
	const y = rect.top + rect.height / 2;
	for (const type of [
		"pointerdown",
		"mousedown",
		"pointerup",
		"mouseup",
		"click",
	]) {
		el.dispatchEvent(
			new MouseEvent(type, {
				bubbles: true,
				cancelable: true,
				view: window,
				clientX: x,
				clientY: y,
			}),
		);
	}
	el.click();
}

function findLiveNextControl() {
	const rightSideControls = Array.from(
		document.querySelectorAll("div[data-tux-tooltip]:not([data-e2e])"),
	)
		.filter(isVisible)
		.map((el) => ({ el, rect: el.getBoundingClientRect() }))
		.filter(({ rect }) => {
			return (
				rect.x > window.innerWidth * 0.65 &&
				rect.width >= 30 &&
				rect.width <= 80 &&
				rect.height >= 30 &&
				rect.height <= 80 &&
				rect.y > 120 &&
				rect.y < window.innerHeight - 80
			);
		})
		// Up/down controls share the same shape; the lower one is next/down.
		.sort((a, b) => b.rect.y - a.rect.y);

	if (rightSideControls[0]) return rightSideControls[0].el;

	// Fallback to the old broad selector if TikTok moves the controls.
	const fallback = Array.from(
		document.querySelectorAll("div[data-tux-tooltip]:not([data-e2e])"),
	)
		.filter(isVisible)
		.sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y);
	return fallback[0] || null;
}

async function waitForNewCreatorUsername(
	previousUsername,
	seenUsers,
	timeout = 15000,
) {
	return await waitUntil(
		() => {
			const username = getCurrentCreatorUsername();
			return username &&
				username !== previousUsername &&
				!seenUsers.has(username)
				? username
				: null;
		},
		{
			timeout,
			message: "new creator data loaded",
			interval: 250,
		},
	);
}

async function isInviteEligible(status, user) {
	const normalized = String(status || "")
		.trim()
		.toLowerCase();
	if (normalized) {
		return (
			status.includes("可邀请") ||
			normalized.includes("eligible") ||
			normalized.includes("invitable")
		);
	}

	// Last-resort fallback: only if no status text exists, require an enabled row
	// invite action button rather than a global next/back button.
	return Boolean(getInviteCandidateActionButton(user));
}

async function countConfiguredBlockedSearchResults() {
	// No remote/configured blocked labels. Keep the hook so the search flow can
	// still use result-count based validation.
	return 0;
}

function getXPathNodes(xpath) {
	const snapshot = document.evaluate(
		xpath,
		document,
		null,
		XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
		null,
	);
	const nodes = [];
	for (let i = 0; i < snapshot.snapshotLength; i++) {
		nodes.push(snapshot.snapshotItem(i));
	}
	return nodes;
}

function getXPathCount(xpath) {
	return getXPathNodes(xpath).length;
}

function getVisibleXPathCount(xpath) {
	return getXPathNodes(xpath).filter(isVisible).length;
}

function normalizeText(value) {
	return String(value || "")
		.replace(/\s+/g, " ")
		.trim();
}

function getMessageProbeText(message) {
	const lines = String(message || "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	return lines.find((line) => line.length >= 10) || lines[0] || "";
}

function getChatPanelElements() {
	return Array.from(document.querySelectorAll("body *")).filter((el) => {
		const rect = el.getBoundingClientRect();
		// The chat conversation panel is to the right of the conversation list.
		return isVisible(el) && rect.x > 560 && rect.width > 80 && rect.height > 8;
	});
}

function countVisibleChatMessagesContaining(message) {
	const probe = normalizeText(getMessageProbeText(message));
	if (!probe) return 0;
	return getChatPanelElements().filter((el) =>
		normalizeText(el.innerText || el.textContent).includes(probe),
	).length;
}

const SEARCH_RESULT_XPATH =
	"//div[contains(@data-id,'backstage_search_result_item')]";

function getVisibleSearchResultItems() {
	return getXPathNodes(SEARCH_RESULT_XPATH).filter(isVisible);
}

function getSearchResultMatch(user) {
	const normalizedUser = normalizeText(user).toLowerCase().replace(/^@/, "");
	const items = getVisibleSearchResultItems().map((el) => ({
		el,
		text: normalizeText(el.innerText || el.textContent),
	}));
	const exact = items.find((item) =>
		item.text.toLowerCase().includes(normalizedUser),
	);
	return exact || null;
}

async function waitForSearchResultForUser(user, timeout = 15000) {
	return await waitUntil(
		() => {
			const matched = getSearchResultMatch(user);
			if (matched) return matched;
			return null;
		},
		{ timeout, message: `search result matching ${user}` },
	);
}

function getActiveChatText() {
	return normalizeText(
		getChatPanelElements()
			.map((el) => el.innerText || el.textContent || "")
			.join(" "),
	);
}

async function waitForChatOpenedFromResult(resultText, timeout = 15000) {
	const distinctive = normalizeText(resultText)
		.split(" ")
		.filter((part) => part.length >= 3)
		.slice(0, 3);
	return await waitUntil(
		() => {
			const textarea = document.evaluate(
				"//textarea[contains(@class,'semi-input-textarea')]",
				document,
				null,
				XPathResult.FIRST_ORDERED_NODE_TYPE,
				null,
			).singleNodeValue;
			if (!isReadyElement(textarea, { requireEnabled: true })) return null;

			if (distinctive.length === 0) return textarea;
			const chatText = getActiveChatText();
			return distinctive.some((part) => chatText.includes(part))
				? textarea
				: null;
		},
		{ timeout, message: "active chat opened for selected contact" },
	);
}

function findSendMessageButton(messageTextarea) {
	const textareaRect = messageTextarea.getBoundingClientRect();
	const candidates = Array.from(
		document.querySelectorAll('button, [role="button"], [data-id]'),
	)
		.filter((el) => isReadyElement(el, { requireEnabled: true }))
		.map((el) => {
			const rect = el.getBoundingClientRect();
			const label = [
				el.getAttribute("data-id") || "",
				el.getAttribute("aria-label") || "",
				el.getAttribute("title") || "",
				el.className || "",
				el.innerText || el.textContent || "",
			]
				.join(" ")
				.toLowerCase();
			const nearTextarea =
				rect.x > textareaRect.left &&
				rect.y > textareaRect.top - 120 &&
				rect.y < textareaRect.bottom + 90;
			const score =
				(label.includes("send") ? 50 : 0) +
				(label.includes("发送") ? 50 : 0) +
				(label.includes("送信") ? 50 : 0) +
				(label.includes("submit") ? 20 : 0) +
				(nearTextarea ? 20 : 0) +
				(rect.x > window.innerWidth * 0.65 ? 8 : 0) +
				(rect.width <= 80 && rect.height <= 80 ? 4 : 0);
			return { el, rect, score, label };
		})
		.filter((item) => item.score >= 24)
		.sort((a, b) => b.score - a.score || b.rect.x - a.rect.x);
	return candidates[0]?.el || null;
}

async function waitForSendMessageButton(messageTextarea, timeout = 10000) {
	return await waitUntil(() => findSendMessageButton(messageTextarea), {
		timeout,
		message: "send message button node",
	});
}

async function clickSendAndWaitForMessage(messageTextarea, message) {
	const beforeCount = countVisibleChatMessagesContaining(message);
	const sendButton = await waitForSendMessageButton(messageTextarea, 10000);
	appendFloatingLog("Clicking real send button...");
	clickElementLikeUser(sendButton);

	await waitUntil(
		() => countVisibleChatMessagesContaining(message) > beforeCount,
		{ timeout: 12000, message: "new outgoing message visible in chat" },
	);
}

function sendEnterOnElement(el) {
	if (!el) throw new Error("sendKeys target not found");
	el.focus();
	["keydown", "keypress", "keyup"].forEach((type) => {
		el.dispatchEvent(
			new KeyboardEvent(type, {
				key: "Enter",
				code: "Enter",
				keyCode: 13,
				bubbles: true,
			}),
		);
	});
	if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
		el.dispatchEvent(new Event("input", { bubbles: true }));
	}
}

// ---------- State management ----------

async function getState() {
	return await chrome.storage.local.get(["tkTask", "tkStep", "tkData"]);
}

async function setState(task, step, data) {
	await chrome.storage.local.set({ tkTask: task, tkStep: step, tkData: data });
}

async function clearState() {
	await chrome.storage.local.remove(["tkTask", "tkStep", "tkData"]);
}

async function isTaskActive(task) {
	const { tkTask } = await chrome.storage.local.get(["tkTask"]);
	return tkTask === task;
}

function navigate(url) {
	window.location.href = url;
}

// ---------- Persistent floating progress panel ----------

const STATUS_PANEL_ID = "tk-auto-floating-status";
const STATUS_LOG_ID = "tk-auto-floating-log";

function ensureStatusPanel() {
	let panel = document.getElementById(STATUS_PANEL_ID);
	if (panel) return panel;

	panel = document.createElement("div");
	panel.id = STATUS_PANEL_ID;
	panel.style.cssText = `
		position:fixed;top:16px;right:16px;z-index:2147483647;
		width:360px;max-width:calc(100vw - 32px);max-height:52vh;
		background:rgba(18,18,18,0.94);color:#fff;border-radius:12px;
		font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
		font-size:12px;box-shadow:0 12px 36px rgba(0,0,0,0.35);
		overflow:hidden;border:1px solid rgba(255,255,255,0.12);
	`;
	const header = document.createElement("div");
	header.style.cssText =
		"display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.1);";

	const dot = document.createElement("div");
	dot.id = "tk-auto-floating-dot";
	dot.style.cssText =
		"width:8px;height:8px;border-radius:50%;background:#1677ff;box-shadow:0 0 10px #1677ff;";

	const titleWrap = document.createElement("div");
	titleWrap.style.cssText = "min-width:0;flex:1;";

	const title = document.createElement("div");
	title.id = "tk-auto-floating-title";
	title.style.cssText =
		"font-weight:700;font-size:13px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
	title.textContent = "TikTok Automation";

	const detail = document.createElement("div");
	detail.id = "tk-auto-floating-detail";
	detail.style.cssText =
		"margin-top:2px;color:rgba(255,255,255,0.72);line-height:1.35;white-space:normal;";
	detail.textContent = "Ready";

	const closeButton = document.createElement("button");
	closeButton.id = "tk-auto-floating-close";
	closeButton.type = "button";
	closeButton.style.cssText =
		"width:auto;margin:0;border:0;border-radius:7px;background:rgba(255,255,255,0.12);color:#fff;padding:4px 8px;cursor:pointer;font-size:11px;";
	closeButton.textContent = "hide";
	closeButton.addEventListener("click", () => {
		panel.style.display = "none";
	});

	const log = document.createElement("div");
	log.id = STATUS_LOG_ID;
	log.style.cssText =
		"padding:10px 14px;max-height:36vh;overflow:auto;line-height:1.45;white-space:pre-wrap;";

	titleWrap.append(title, detail);
	header.append(dot, titleWrap, closeButton);
	panel.append(header, log);
	document.documentElement.appendChild(panel);
	return panel;
}

function setFloatingStatus(title, detail = "", kind = "info") {
	const panel = ensureStatusPanel();
	panel.style.display = "block";
	const titleEl = panel.querySelector("#tk-auto-floating-title");
	const detailEl = panel.querySelector("#tk-auto-floating-detail");
	const dotEl = panel.querySelector("#tk-auto-floating-dot");
	if (titleEl) titleEl.textContent = title;
	if (detailEl) detailEl.textContent = detail;
	if (dotEl) {
		const color =
			kind === "error" ? "#ff4d4f" : kind === "success" ? "#52c41a" : "#1677ff";
		dotEl.style.background = color;
		dotEl.style.boxShadow = `0 0 10px ${color}`;
	}
}

function appendFloatingLog(text, kind = "info") {
	const panel = ensureStatusPanel();
	panel.style.display = "block";
	const logEl = panel.querySelector(`#${STATUS_LOG_ID}`);
	if (!logEl) return;
	const line = document.createElement("div");
	line.style.cssText = `margin-bottom:5px;color:${kind === "error" ? "#ffccc7" : kind === "success" ? "#b7eb8f" : "rgba(255,255,255,0.88)"};`;
	const time = new Date().toLocaleTimeString([], { hour12: false });
	line.textContent = `[${time}] ${text}`;
	logEl.appendChild(line);
	while (logEl.children.length > 80) logEl.firstChild?.remove();
	logEl.scrollTop = logEl.scrollHeight;
}

function notify(text, _duration = 5000, kind = "info") {
	setFloatingStatus("TikTok Automation", text, kind);
	appendFloatingLog(text, kind);
}

// =================================================================================
// Task: getCreator
// =================================================================================

async function runGetCreator(step, data) {
	const url = location.href;

	if (step === 0) {
		const config = await loadLocalConfig();
		const loopSize = parseInt(config.loopSize || "10", 10);
		const nextData = { loopSize, loopIndex: 0, users: [] };
		setFloatingStatus("Get Creators", `Starting... target ${loopSize} users`);
		appendFloatingLog(`Get Creators started. target=${loopSize}`);
		await setState("getCreator", 2, nextData);
		if (!url.includes("tiktok.com/live")) {
			appendFloatingLog("Opening TikTok LIVE feed...");
			navigate("https://www.tiktok.com/live?lang=ja-JP");
			return;
		}
		return runGetCreator(2, nextData);
	}

	if (step === 2 && url.includes("tiktok.com/live")) {
		setFloatingStatus("Get Creators", "Waiting for current LIVE creator...");
		// Wait for the current TikTok creator data to load.
		await waitForCreatorAnchor(30000);

		let { users, loopSize } = data;
		users = users ? [...users] : [];
		const seenUsers = new Set(users);

		const firstUsername = getCurrentCreatorUsername();
		if (firstUsername && !seenUsers.has(firstUsername)) {
			users.push(firstUsername);
			seenUsers.add(firstUsername);
			console.log("[getCreator] Found user:", firstUsername);
			setFloatingStatus(
				"Get Creators",
				`Collected ${users.length}/${loopSize}: @${firstUsername}`,
			);
			appendFloatingLog(
				`Collected ${users.length}/${loopSize}: @${firstUsername}`,
			);
		}

		let attempts = 0;
		const maxAttempts = Math.max(loopSize * 6, 12);

		while (users.length < loopSize && attempts < maxAttempts) {
			if (!(await isTaskActive("getCreator"))) return;

			const previousUsername = getCurrentCreatorUsername();
			setFloatingStatus(
				"Get Creators",
				`Collected ${users.length}/${loopSize}. Moving to next creator...`,
			);
			appendFloatingLog(`Moving next from @${previousUsername || "unknown"}`);

			const nextControl = findLiveNextControl();
			if (nextControl) {
				clickElementLikeUser(nextControl);
			} else {
				appendFloatingLog(
					"Right-side next control not found; using scroll fallback",
					"error",
				);
			}
			attempts++;

			let newUser = await waitForNewCreatorUsername(
				previousUsername,
				seenUsers,
				2500,
			).catch(() => "");

			if (!newUser) {
				appendFloatingLog(
					"Click did not change creator; scrolling to next LIVE card...",
				);
				scrollToNextCreatorCard(previousUsername, seenUsers);
				newUser = await waitForNewCreatorUsername(
					previousUsername,
					seenUsers,
					9000,
				).catch(() => "");
			}

			if (newUser) {
				users.push(newUser);
				seenUsers.add(newUser);
				console.log("[getCreator] Found user:", newUser);
				setFloatingStatus(
					"Get Creators",
					`Collected ${users.length}/${loopSize}: @${newUser}`,
				);
				appendFloatingLog(
					`Collected ${users.length}/${loopSize}: @${newUser}`,
					users.length >= loopSize ? "success" : "info",
				);
				await setState("getCreator", 2, {
					loopSize,
					loopIndex: users.length,
					users,
				});
			} else {
				console.log("[getCreator] New creator data did not load yet, retrying");
				appendFloatingLog(
					`No new creator after attempt ${attempts}/${maxAttempts}; retrying...`,
					"error",
				);
			}
		}

		if (users.length < loopSize) {
			const message = `[getCreator] Expected ${loopSize} users, collected ${users.length}. Not saving partial result.`;
			console.warn(message);
			await setState("getCreator", 2, {
				loopSize,
				loopIndex: users.length,
				users,
				error: message,
			});
			setFloatingStatus(
				"Get Creators",
				`Stopped: collected ${users.length}/${loopSize}. Not saved.`,
				"error",
			);
			appendFloatingLog(
				`Stopped: collected ${users.length}/${loopSize}. Not saved.`,
				"error",
			);
			return;
		}

		if (!(await isTaskActive("getCreator"))) return;
		await chrome.storage.local.set({ users: csvDistinct(users) });
		console.log("[getCreator] Saved users:", users);
		await clearState();
		notify(
			`✅ Get Creators completed. Saved ${users.length} users.`,
			5000,
			"success",
		);
		return;
	}
}

// =================================================================================
// Task: invite
// =================================================================================

async function runInvite(step, data) {
	const url = location.href;

	if (step === 0) {
		const stored = await chrome.storage.local.get(["users"]);
		const users = parseCsv(stored.users);
		console.log("[invite] Users from extension storage:", users);
		setFloatingStatus("Invite", `Starting... ${users.length} users`);
		appendFloatingLog(`Invite started. users=${users.length}`);

		if (users.length === 0) {
			await clearState();
			notify("❌ No users found. Run Get Creators first.", 5000, "error");
			return;
		}

		const nextData = { users, chats: [], inviteIndex: 0 };
		await setState("invite", 2, nextData);
		if (!url.includes("live-backstage.tiktok.com/portal")) {
			appendFloatingLog("Opening LIVE Backstage relation page...");
			navigate("https://live-backstage.tiktok.com/portal/anchor/relation");
			return;
		}
		return runInvite(2, nextData);
	}

	if (step === 2 && url.includes("live-backstage.tiktok.com/portal")) {
		let { users, chats, inviteIndex = 0 } = data;
		chats = chats ? [...chats] : [];
		const seenChats = new Set(chats);

		if (!url.includes("/portal/anchor/relation")) {
			const ready = await openRelationPage();
			if (!ready) return;
		}

		setFloatingStatus(
			"Invite",
			`Preparing relation page... matched ${chats.length}/${users.length}`,
		);
		window.scrollTo(0, 0);

		// Open the invite side sheet from the Management Relation page.
		await ensureInviteSideSheetOpen();

		const inviteTextareaSelector = getInviteTextareaSelector();

		for (let i = inviteIndex; i < users.length; i++) {
			if (!(await isTaskActive("invite"))) return;

			const user = users[i];
			console.log(`[invite] Processing ${i + 1}/${users.length}: ${user}`);
			setFloatingStatus(
				"Invite",
				`Checking ${i + 1}/${users.length}: @${user}`,
			);
			appendFloatingLog(`Checking ${i + 1}/${users.length}: @${user}`);

			// Focus textarea only after it is visible and enabled.
			const inviteTextarea = await waitForElementReady(
				inviteTextareaSelector,
				15000,
			);
			clickElementLikeUser(inviteTextarea);

			// Type username and wait until the controlled textarea reflects it.
			setElementValue(inviteTextarea, user);
			await waitUntil(() => inviteTextarea.value === user, {
				timeout: 3000,
				message: "invite textarea value",
			});

			// Click next only after the button is visible and enabled.
			const nextButton = await waitForInviteNextButton(15000);
			clickElementLikeUser(nextButton);

			// Wait for the result row/status, not merely for the back button.
			const result = await waitForInviteCandidateResult(user, 10000);
			const status = result.status;
			console.log(`[invite] ${user} => ${status}`);

			if ((await isInviteEligible(status, user)) && !seenChats.has(user)) {
				chats.push(user);
				seenChats.add(user);
				appendFloatingLog(
					`Eligible saved for Send Message: @${user} (${status})`,
					"success",
				);
			} else {
				appendFloatingLog(`Skipped: @${user} (${status})`);
			}

			// Go back to the textarea step using stable side-sheet controls.
			const backButton = await waitForInviteBackButton(15000);
			clickElementLikeUser(backButton);
			await waitForElementReady(inviteTextareaSelector, 15000);

			if (!(await isTaskActive("invite"))) return;
			// Save incremental progress, including index for true resume
			await setState("invite", 2, { users, chats, inviteIndex: i + 1 });
		}

		if (!(await isTaskActive("invite"))) return;
		await chrome.storage.local.set({ chats: csvDistinct(chats) });
		console.log("[invite] Saved chats:", chats);
		await clearState();
		notify(
			`✅ Invite check completed. Matched ${chats.length}/${users.length}. Next: Send Message.`,
			5000,
			"success",
		);
		return;
	}
}

// =================================================================================
// Task: sendMessage
// =================================================================================

async function runSendMessage(step, data) {
	const url = location.href;

	if (step === 0) {
		const config = await loadLocalConfig();
		const msg = String(config.msg || "");
		const sent = parseCsv(config.sent);
		const testMode = config.testMode === true || config.testMode === "true";
		const stored = await chrome.storage.local.get(["chats"]);
		const chats = parseCsv(stored.chats).filter((item) => !sent.includes(item));

		console.log("[sendMessage] Chats to send:", chats);
		setFloatingStatus(
			"Send Message",
			`Starting... ${chats.length} chats, ${sent.length} already sent`,
		);
		appendFloatingLog(
			`Send Message started. chats=${chats.length}, alreadySent=${sent.length}, testMode=${testMode ? "ON" : "OFF"}`,
		);

		if (!msg.trim()) {
			await clearState();
			notify(
				"❌ Message is empty. Open Config and set msg first.",
				5000,
				"error",
			);
			return;
		}

		if (chats.length === 0) {
			await clearState();
			notify(
				"❌ No chats to send. Run Invite first or all chats are already sent.",
				5000,
				"error",
			);
			return;
		}

		const nextData = {
			msg,
			chats,
			sent,
			newsent: [],
			tested: [],
			testMode,
			messageIndex: 0,
		};
		await setState("sendMessage", 2, nextData);
		if (!url.includes("live-backstage.tiktok.com/portal")) {
			appendFloatingLog("Opening LIVE Backstage messages page...");
			navigate("https://live-backstage.tiktok.com/portal");
			return;
		}
		return runSendMessage(2, nextData);
	}

	if (step === 2 && url.includes("live-backstage.tiktok.com/portal")) {
		let {
			msg,
			chats,
			newsent,
			tested,
			testMode = false,
			messageIndex = 0,
		} = data;
		newsent = newsent ? [...newsent] : [];
		tested = tested ? [...tested] : [];
		const sentThisRun = new Set(newsent);
		const testedThisRun = new Set(tested);

		setFloatingStatus(
			"Send Message",
			`Preparing messages page... sent ${newsent.length}/${chats.length}`,
		);
		window.scrollTo(0, 0);

		// Open instant messages using stable menu data-id instead of menu order/text.
		await openInstantMessagesPage();

		for (let i = messageIndex; i < chats.length; i++) {
			if (!(await isTaskActive("sendMessage"))) return;

			const user = chats[i];
			console.log(`[sendMessage] Processing ${i + 1}/${chats.length}: ${user}`);
			setFloatingStatus(
				"Send Message",
				`Processing ${i + 1}/${chats.length}: @${user}`,
			);
			appendFloatingLog(`Processing ${i + 1}/${chats.length}: @${user}`);

			// Find and fill the instant-message username search input.
			appendFloatingLog(`Waiting for search input for @${user}...`);
			const searchInput = await waitForInstantMessageSearchInput(15000);
			clickElementLikeUser(searchInput);

			// Type username and wait until the controlled input reflects it.
			appendFloatingLog(`Typing search username: @${user}`);
			setElementValue(searchInput, user);
			await waitUntil(() => searchInput.value === user, {
				timeout: 5000,
				message: "search input value",
			});

			// Do not depend on Semi's clear-button node; it is not always rendered.
			// The required page node is the search input itself. Once its controlled
			// value reflects the username, let React settle, then submit Enter.
			appendFloatingLog("Search input value confirmed; submitting search...");
			await tick();

			appendFloatingLog(`Submitting search for @${user}...`);
			sendEnterOnElement(searchInput);

			// Wait until a visible search result specifically matches this username.
			appendFloatingLog(
				`Waiting for visible search result matching @${user}...`,
			);
			const result = await waitForSearchResultForUser(user, 15000).catch(
				() => null,
			);
			const nottarget = await countConfiguredBlockedSearchResults();
			const found = result ? 1 : 0;
			console.log(
				`[sendMessage] Search ${user}: matched=${found}, nottarget=${nottarget}`,
			);

			const ok = Boolean(result) && nottarget === 0;
			appendFloatingLog(
				`Search result @${user}: matched=${found}, blocked=${nottarget}`,
			);

			if (ok) {
				appendFloatingLog(`Opening matched contact for @${user}...`);
				clickElementLikeUser(result.el);

				// Wait until the selected contact's chat is genuinely open and the
				// message textarea is ready. This prevents sending into the previous chat.
				appendFloatingLog(`Waiting for active chat to open for @${user}...`);
				const messageTextarea = await waitForChatOpenedFromResult(
					result.text,
					15000,
				);
				clickElementLikeUser(messageTextarea);

				// Type message and wait until it is reflected in the controlled textarea.
				setElementValue(messageTextarea, msg);
				await waitUntil(() => messageTextarea.value === msg, {
					timeout: 3000,
					message: "message textarea value",
				});

				if (testMode) {
					appendFloatingLog(
						`TEST MODE: message filled for @${user}; not sent.`,
						"success",
					);
					if (!testedThisRun.has(user)) {
						tested.push(user);
						testedThisRun.add(user);
					}
					setFloatingStatus(
						"Send Message",
						`Tested ${tested.length}/${chats.length}: @${user}`,
						"success",
					);
					// Clear the textarea so the next test user starts from a clean chat.
					setElementValue(messageTextarea, "");
				} else {
					try {
						await clickSendAndWaitForMessage(messageTextarea, msg);

						if (!sentThisRun.has(user)) {
							newsent.push(user);
							sentThisRun.add(user);
						}
						setFloatingStatus(
							"Send Message",
							`Sent ${newsent.length}/${chats.length}: @${user}`,
							"success",
						);
						appendFloatingLog(`Sent confirmed: @${user}`, "success");
					} catch (err) {
						appendFloatingLog(
							`Send not confirmed for @${user}: ${err?.message || err}`,
							"error",
						);
						setFloatingStatus(
							"Send Message",
							`Send not confirmed: @${user}`,
							"error",
						);
					}
				}
			} else {
				console.log(`[sendMessage] Skipped ${user} (not a valid target)`);
				appendFloatingLog(`Skipped: @${user} (not a valid target)`);
			}

			if (!(await isTaskActive("sendMessage"))) return;
			// Save incremental progress, including index for true resume
			await setState("sendMessage", 2, {
				msg,
				chats,
				newsent,
				tested,
				testMode,
				messageIndex: i + 1,
			});
		}

		if (!(await isTaskActive("sendMessage"))) return;
		if (!testMode) {
			await appendLocalSent(csvDistinct(newsent));
			console.log("[sendMessage] Saved sent to local config:", newsent);
		}
		await clearState();
		notify(
			testMode
				? `✅ Send Message test completed. Tested ${tested.length}/${chats.length}. Nothing sent.`
				: `✅ Send Message completed. Sent ${newsent.length}/${chats.length}.`,
			5000,
			"success",
		);
		return;
	}
}

// =================================================================================
// Main entry: resume on page load + listen for popup messages
// =================================================================================

(async function main() {
	// Listen for direct messages from popup (backup control channel)
	chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
		(async () => {
			try {
				if (request.action === "startGetCreator") {
					await runGetCreator(0, {});
					sendResponse({ started: true });
				} else if (request.action === "startInvite") {
					await runInvite(0, {});
					sendResponse({ started: true });
				} else if (request.action === "startSendMessage") {
					await runSendMessage(0, {});
					sendResponse({ started: true });
				} else if (request.action === "stop") {
					await clearState();
					sendResponse({ stopped: true });
				}
			} catch (err) {
				console.error("[TikTok Auto] Message action error:", err);
				notify(
					`❌ ${request.action} failed: ${err?.message || err}`,
					5000,
					"error",
				);
				sendResponse({ started: false, error: err?.message || String(err) });
			}
		})();
		return true; // keep channel open for async
	});

	// Auto-resume on page load if state exists
	try {
		const state = await getState();
		if (state.tkTask !== undefined && state.tkTask !== null) {
			console.log(
				"[TikTok Auto] Resuming:",
				state.tkTask,
				"step",
				state.tkStep,
			);
			await waitUntil(
				() =>
					document.readyState === "interactive" ||
					document.readyState === "complete",
				{ timeout: 5000, message: "document ready" },
			).catch(() => null);
			await tick();

			if (state.tkTask === "getCreator") {
				await runGetCreator(state.tkStep, state.tkData || {});
			} else if (state.tkTask === "invite") {
				await runInvite(state.tkStep, state.tkData || {});
			} else if (state.tkTask === "sendMessage") {
				await runSendMessage(state.tkStep, state.tkData || {});
			}
		}
	} catch (err) {
		console.error("[TikTok Auto] Resume error:", err);
		notify(`❌ Task failed: ${err?.message || err}`, 5000, "error");
	}
})();
