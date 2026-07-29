import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text } from "@earendil-works/pi-tui";

const PROVIDER_ID = "openai-codex";
const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const DASHBOARD_URL = "https://chatgpt.com/codex/settings/usage";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const AUTH_CLAIM = "https://api.openai.com/auth";

type JsonObject = Record<string, unknown>;

type UsageWindow = {
	used_percent?: number;
	limit_window_seconds?: number;
	reset_after_seconds?: number;
	reset_at?: number;
};

type RateLimit = {
	allowed?: boolean;
	limit_reached?: boolean;
	primary_window?: UsageWindow | null;
	secondary_window?: UsageWindow | null;
};

type UsagePayload = JsonObject & {
	plan_type?: string;
	rate_limit?: RateLimit | null;
	code_review_rate_limit?: RateLimit | null;
	additional_rate_limits?: Array<{
		limit_name?: string;
		metered_feature?: string;
		rate_limit?: RateLimit | null;
	}> | null;
	credits?: {
		has_credits?: boolean;
		unlimited?: boolean;
		overage_limit_reached?: boolean;
		balance?: string | number | null;
		approx_local_messages?: [number, number] | null;
		approx_cloud_messages?: [number, number] | null;
	} | null;
	spend_control?: {
		reached?: boolean;
		individual_limit?: {
			limit?: string | number;
			used?: string | number;
			remaining?: string | number;
			used_percent?: number;
			remaining_percent?: number;
			reset_at?: number;
		} | null;
	} | null;
	rate_limit_reached_type?: { type?: string } | null;
	rate_limit_reset_credits?: {
		available_count?: number;
		applicable_available_count?: number;
	} | null;
};

type HttpResult = {
	status: number;
	body: string;
};

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeAccountId(accessToken: string): string | undefined {
	try {
		const parts = accessToken.split(".");
		if (parts.length !== 3) return undefined;
		const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as JsonObject;
		const auth = payload[AUTH_CLAIM];
		if (!isObject(auth)) return undefined;
		const accountId = auth.chatgpt_account_id;
		return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
	} catch {
		return undefined;
	}
}

function quoteCurlConfig(value: string): string {
	// curl config values are quoted; strip line breaks to prevent config injection.
	return `"${value.replace(/[\r\n]/g, "").replace(/(["\\])/g, "\\$1")}"`;
}

async function requestWithCurl(
	accessToken: string,
	accountId: string,
	env: NodeJS.ProcessEnv,
): Promise<HttpResult> {
	return new Promise<HttpResult>((resolve, reject) => {
		const marker = "__PI_OPENAI_USAGE_HTTP_STATUS__:";
		const child = spawn("curl", ["--config", "-"], {
			env,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});

		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (error?: Error, result?: HttpResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error);
			else resolve(result!);
		};

		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			finish(new Error(`请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）`));
		}, REQUEST_TIMEOUT_MS + 1_000);

		child.on("error", (error) => finish(error));
		child.stdin.on("error", (error) => finish(error));
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
			if (Buffer.byteLength(stdout, "utf8") > MAX_RESPONSE_BYTES) {
				child.kill("SIGTERM");
				finish(new Error("OpenAI usage 响应过大，已停止读取"));
			}
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("close", (code) => {
			if (settled) return;
			const markerIndex = stdout.lastIndexOf(`\n${marker}`);
			if (markerIndex < 0) {
				const detail = stderr.trim() || `curl 退出码 ${code ?? "unknown"}`;
				finish(new Error(detail));
				return;
			}
			const body = stdout.slice(0, markerIndex);
			const statusText = stdout.slice(markerIndex + marker.length + 1).trim();
			const status = Number.parseInt(statusText, 10);
			if (!Number.isFinite(status)) {
				finish(new Error("无法读取 OpenAI usage HTTP 状态码"));
				return;
			}
			if (status === 0 || (code !== 0 && body.length === 0)) {
				finish(new Error(stderr.trim() || `curl 退出码 ${code ?? "unknown"}`));
				return;
			}
			finish(undefined, { status, body });
		});

		// Secrets are passed over stdin, not command-line arguments or environment variables.
		child.stdin.end(
			[
				`url = ${quoteCurlConfig(USAGE_ENDPOINT)}`,
				'request = "GET"',
				"silent",
				"show-error",
				`connect-timeout = ${Math.floor(REQUEST_TIMEOUT_MS / 2_000)}`,
				`max-time = ${Math.floor(REQUEST_TIMEOUT_MS / 1_000)}`,
				`header = ${quoteCurlConfig(`Authorization: Bearer ${accessToken}`)}`,
				`header = ${quoteCurlConfig(`ChatGPT-Account-Id: ${accountId}`)}`,
				'header = "Accept: application/json"',
				`write-out = ${quoteCurlConfig(`\\n${marker}%{http_code}`)}`,
			].join("\n"),
		);
	});
}

async function requestWithFetch(accessToken: string, accountId: string): Promise<HttpResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(USAGE_ENDPOINT, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"ChatGPT-Account-Id": accountId,
				Accept: "application/json",
			},
			signal: controller.signal,
		});
		const body = await response.text();
		if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
			throw new Error("OpenAI usage 响应过大，已停止读取");
		}
		return { status: response.status, body };
	} catch (error) {
		if (controller.signal.aborted) {
			throw new Error(`请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）`);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

function hasProxy(env: NodeJS.ProcessEnv): boolean {
	return Boolean(
		env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy ?? env.ALL_PROXY ?? env.all_proxy,
	);
}

async function fetchUsage(
	accessToken: string,
	accountId: string,
	credentialEnv?: Record<string, string>,
): Promise<UsagePayload> {
	const env: NodeJS.ProcessEnv = { ...process.env, ...(credentialEnv ?? {}) };
	let response: HttpResult;

	if (hasProxy(env)) {
		try {
			response = await requestWithCurl(accessToken, accountId, env);
		} catch (curlError) {
			if ((curlError as NodeJS.ErrnoException).code !== "ENOENT") throw curlError;
			response = await requestWithFetch(accessToken, accountId);
		}
	} else {
		try {
			response = await requestWithFetch(accessToken, accountId);
		} catch (fetchError) {
			try {
				response = await requestWithCurl(accessToken, accountId, env);
			} catch {
				throw fetchError;
			}
		}
	}

	if (response.status < 200 || response.status >= 300) {
		let message = "";
		try {
			const payload = JSON.parse(response.body) as JsonObject;
			const error = payload.error;
			if (typeof error === "string") message = error;
			else if (isObject(error) && typeof error.message === "string") message = error.message;
			else if (typeof payload.message === "string") message = payload.message;
		} catch {
			// Do not echo arbitrary HTML or response bodies: they may contain account data.
		}
		if (response.status === 401) {
			throw new Error("OpenAI 登录已失效；请在 pi 中执行 /login，重新登录 OpenAI ChatGPT Plus/Pro");
		}
		throw new Error(`OpenAI usage 请求失败（HTTP ${response.status}）${message ? `：${message}` : ""}`);
	}

	let payload: unknown;
	try {
		payload = JSON.parse(response.body);
	} catch {
		throw new Error("OpenAI usage 返回了非 JSON 响应");
	}
	if (!isObject(payload)) throw new Error("OpenAI usage 返回格式无效");
	return payload as UsagePayload;
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDuration(seconds?: number): string {
	if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return "未知周期";
	if (seconds % 604800 === 0) return `${seconds / 604800} 周`;
	if (seconds % 86400 === 0) return `${seconds / 86400} 天`;
	if (seconds % 3600 === 0) return `${seconds / 3600} 小时`;
	if (seconds % 60 === 0) return `${seconds / 60} 分钟`;
	return `${seconds} 秒`;
}

function formatRelative(seconds?: number): string | undefined {
	if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
	if (seconds <= 0) return "即将重置";
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.ceil((seconds % 3600) / 60);
	if (days > 0) return `${days} 天 ${hours} 小时后`;
	if (hours > 0) return `${hours} 小时 ${minutes} 分钟后`;
	return `${Math.max(1, minutes)} 分钟后`;
}

function formatReset(window: UsageWindow): string {
	const relative = formatRelative(window.reset_after_seconds);
	const timestamp = window.reset_at;
	if (timestamp !== undefined && Number.isFinite(timestamp)) {
		const date = new Date(timestamp * 1000);
		if (!Number.isNaN(date.getTime())) {
			return `${date.toLocaleString("zh-CN")}${relative ? `（${relative}）` : ""}`;
		}
	}
	return relative ?? "未知";
}

function formatWindow(label: string, window: UsageWindow | null | undefined): string | undefined {
	if (!window || typeof window.used_percent !== "number" || !Number.isFinite(window.used_percent)) {
		return undefined;
	}
	const used = clampPercent(window.used_percent);
	const remaining = clampPercent(100 - used);
	return `  ${label} · ${formatDuration(window.limit_window_seconds)}：已用 ${formatNumber(used)}%，剩余 ${formatNumber(remaining)}%，重置 ${formatReset(window)}`;
}

function appendRateLimit(lines: string[], title: string, limit: RateLimit | null | undefined): void {
	if (!limit) return;
	const windows = [
		formatWindow("主窗口", limit.primary_window),
		formatWindow("次窗口", limit.secondary_window),
	].filter((line): line is string => Boolean(line));
	if (windows.length === 0) return;
	const state = limit.limit_reached ? "已达上限" : limit.allowed === false ? "当前不可用" : "可用";
	lines.push(`${title}（${state}）`, ...windows);
}

function pickFields(value: JsonObject, fields: readonly string[]): JsonObject {
	return Object.fromEntries(fields.filter((field) => value[field] !== undefined).map((field) => [field, value[field]]));
}

function sanitizeWindow(window: UsageWindow | null | undefined): JsonObject | null | undefined {
	if (window === null) return null;
	if (!isObject(window)) return undefined;
	return pickFields(window, ["used_percent", "limit_window_seconds", "reset_after_seconds", "reset_at"]);
}

function sanitizeRateLimit(limit: RateLimit | null | undefined): JsonObject | null | undefined {
	if (limit === null) return null;
	if (!isObject(limit)) return undefined;
	return {
		...pickFields(limit, ["allowed", "limit_reached"]),
		...(limit.primary_window !== undefined ? { primary_window: sanitizeWindow(limit.primary_window) } : {}),
		...(limit.secondary_window !== undefined ? { secondary_window: sanitizeWindow(limit.secondary_window) } : {}),
	};
}

export function sanitizePayload(payload: UsagePayload): JsonObject {
	const safe: JsonObject = pickFields(payload, ["plan_type"]);
	if (payload.rate_limit !== undefined) safe.rate_limit = sanitizeRateLimit(payload.rate_limit);
	if (payload.code_review_rate_limit !== undefined) {
		safe.code_review_rate_limit = sanitizeRateLimit(payload.code_review_rate_limit);
	}
	if (Array.isArray(payload.additional_rate_limits)) {
		safe.additional_rate_limits = payload.additional_rate_limits.filter(isObject).map((item) => ({
			...pickFields(item, ["limit_name", "metered_feature"]),
			...(item.rate_limit !== undefined ? { rate_limit: sanitizeRateLimit(item.rate_limit as RateLimit | null) } : {}),
		}));
	}
	if (isObject(payload.credits)) {
		safe.credits = pickFields(payload.credits, [
			"has_credits",
			"unlimited",
			"overage_limit_reached",
			"balance",
			"approx_local_messages",
			"approx_cloud_messages",
		]);
	}
	if (isObject(payload.spend_control)) {
		const spendControl = pickFields(payload.spend_control, ["reached"]);
		if (isObject(payload.spend_control.individual_limit)) {
			spendControl.individual_limit = pickFields(payload.spend_control.individual_limit, [
				"limit",
				"used",
				"remaining",
				"used_percent",
				"remaining_percent",
				"reset_at",
			]);
		}
		safe.spend_control = spendControl;
	}
	if (isObject(payload.rate_limit_reached_type)) {
		safe.rate_limit_reached_type = pickFields(payload.rate_limit_reached_type, ["type"]);
	}
	if (isObject(payload.rate_limit_reset_credits)) {
		safe.rate_limit_reset_credits = pickFields(payload.rate_limit_reset_credits, [
			"available_count",
			"applicable_available_count",
		]);
	}
	return safe;
}

function formatUsage(payload: UsagePayload): string {
	const lines: string[] = ["OpenAI Codex Usage", ""];
	lines.push(`套餐：${payload.plan_type?.toUpperCase() ?? "未知"}`);
	if (payload.rate_limit_reached_type?.type) {
		lines.push(`限制状态：${payload.rate_limit_reached_type.type}`);
	}
	lines.push("");

	appendRateLimit(lines, "Codex 用量", payload.rate_limit);
	appendRateLimit(lines, "Code Review 用量", payload.code_review_rate_limit);
	for (const item of payload.additional_rate_limits ?? []) {
		appendRateLimit(lines, item.limit_name ?? item.metered_feature ?? "其他用量", item.rate_limit);
	}

	const credits = payload.credits;
	if (credits) {
		lines.push("");
		if (credits.unlimited) {
			lines.push("Credits：无限");
		} else if (credits.has_credits || credits.balance !== undefined) {
			lines.push(`Credits：${credits.balance ?? "未知"}${credits.overage_limit_reached ? "（已达上限）" : ""}`);
		}
		if (credits.approx_local_messages) {
			lines.push(`预计本地消息：${credits.approx_local_messages[0]}–${credits.approx_local_messages[1]}`);
		}
		if (credits.approx_cloud_messages) {
			lines.push(`预计云任务：${credits.approx_cloud_messages[0]}–${credits.approx_cloud_messages[1]}`);
		}
	}

	const individual = payload.spend_control?.individual_limit;
	if (individual) {
		lines.push("");
		lines.push(
			`个人额度：已用 ${individual.used ?? "?"} / ${individual.limit ?? "?"}，剩余 ${individual.remaining ?? "?"}`,
		);
		if (typeof individual.used_percent === "number") {
			lines.push(`  已用 ${formatNumber(individual.used_percent)}%，剩余 ${formatNumber(individual.remaining_percent ?? 100 - individual.used_percent)}%`);
		}
		if (individual.reset_at) {
			lines.push(`  重置：${new Date(individual.reset_at * 1000).toLocaleString("zh-CN")}`);
		}
	}

	const resetCredits = payload.rate_limit_reset_credits;
	if (resetCredits && typeof resetCredits.available_count === "number") {
		lines.push("");
		lines.push(`可用重置次数：${resetCredits.available_count}`);
	}

	lines.push("", `网页面板：${DASHBOARD_URL}`, "提示：数据来自 OpenAI 内部接口，字段或接口可能随时变化。", "", "按 Enter 或 Esc 关闭");
	return lines.join("\n");
}

async function showResult(ctx: ExtensionCommandContext, text: string): Promise<void> {
	if (ctx.mode === "print") {
		console.log(text);
		return;
	}
	if (ctx.mode !== "tui") {
		ctx.ui.notify(text, "info");
		return;
	}

	await ctx.ui.custom<void>((_tui, _theme, _keybindings, done) => ({
		render(width: number) {
			return new Text(text, 1, 1).render(width);
		},
		handleInput(data: string) {
			if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) done(undefined);
		},
		invalidate() {},
	}));
}

export default function openAIUsageExtension(pi: ExtensionAPI) {
	pi.registerCommand("usage", {
		description: "查看 OpenAI ChatGPT/Codex 订阅用量（/usage json 显示脱敏 JSON）",
		getArgumentCompletions: (prefix) =>
			"json".startsWith(prefix.trim()) ? [{ value: "json", label: "json", description: "显示脱敏后的原始响应" }] : null,
		handler: async (args, ctx) => {
			ctx.ui.setStatus("openai-usage", "正在获取 OpenAI 用量…");
			try {
				const model = ctx.modelRegistry.getAll().find((candidate) => candidate.provider === PROVIDER_ID);
				if (!model) throw new Error("当前 pi 未提供 openai-codex 模型");

				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
				if (!auth.ok || !auth.apiKey) {
					throw new Error(
						auth.ok
							? "尚未登录 OpenAI ChatGPT Plus/Pro；请先执行 /login"
							: `无法读取 OpenAI 登录信息：${auth.error}`,
					);
				}
				const accountId = decodeAccountId(auth.apiKey);
				if (!accountId) {
					throw new Error("当前 OpenAI 凭据不是 ChatGPT OAuth 凭据；请通过 /login 登录 ChatGPT Plus/Pro");
				}

				const payload = await fetchUsage(auth.apiKey, accountId, auth.env);
				const output = args.trim().toLowerCase() === "json"
					? JSON.stringify(sanitizePayload(payload), null, 2)
					: formatUsage(payload);
				await showResult(ctx, output);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.mode === "print") console.error(`OpenAI Usage：${message}`);
				else ctx.ui.notify(`OpenAI Usage：${message}`, "error");
			} finally {
				ctx.ui.setStatus("openai-usage", undefined);
			}
		},
	});
}
