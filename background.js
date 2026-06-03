// Background Service Worker
// All configuration is stored locally in chrome.storage.local by options.js.

importScripts("config.js");

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
