// Background Service Worker
// All configuration is stored locally in chrome.storage.local by options.js.

importScripts("config.js");

// Proxy LLM API requests from content scripts to bypass CORS.
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
	if (request.action === "proxyFetch") {
		(async () => {
			try {
				const res = await fetch(request.url, request.options);
				sendResponse({
					ok: res.ok,
					status: res.status,
					statusText: res.statusText,
					headers: Object.fromEntries(res.headers.entries()),
					body: await res.text(),
				});
			} catch (err) {
				console.error("[TikTok Auto] proxyFetch error:", err);
				sendResponse({
					ok: false,
					status: 0,
					statusText: "Network Error",
					headers: {},
					body: JSON.stringify({ error: err?.message || String(err) }),
				});
			}
		})();
		return true;
	}
	return false;
});

chrome.runtime.onInstalled.addListener(async () => {
	console.log("[TikTok Auto] Extension installed");
	const current = await chrome.storage.local.get(
		Object.keys(globalThis.TK_DEFAULT_CONFIG),
	);
	const missingDefaults = {};
	for (const [key, value] of Object.entries(globalThis.TK_DEFAULT_CONFIG)) {
		if (
			current[key] === undefined ||
			(key === "msg" && !String(current[key]).trim())
		) {
			missingDefaults[key] = value;
		}
	}
	if (Object.keys(missingDefaults).length > 0) {
		await chrome.storage.local.set(missingDefaults);
	}
});
