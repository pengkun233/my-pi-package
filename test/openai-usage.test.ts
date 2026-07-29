import { describe, expect, it } from "vitest";
import { sanitizePayload } from "../extensions/openai-usage.js";

describe("OpenAI usage JSON sanitization", () => {
  it("whitelists documented usage fields and removes unknown nested account data", () => {
    const sanitized = sanitizePayload({
      plan_type: "plus",
      email: "person@example.com",
      unknown_account_blob: { phone: "secret", token: "secret-token" },
      rate_limit: {
        allowed: true,
        primary_window: {
          used_percent: 12,
          limit_window_seconds: 18_000,
          reset_at: 123,
          nested_identity: { email: "nested@example.com" },
        },
        provider_private_field: "secret",
      },
      additional_rate_limits: [{
        limit_name: "review",
        metered_feature: "code_review",
        rate_limit: { limit_reached: false, secondary_window: { used_percent: 5 } },
        account_id: "nested-account",
      }],
      credits: { balance: "4.5", has_credits: true, owner_name: "Private Person" },
    } as any);

    expect(sanitized).toMatchObject({
      plan_type: "plus",
      rate_limit: {
        allowed: true,
        primary_window: { used_percent: 12, limit_window_seconds: 18_000, reset_at: 123 },
      },
      additional_rate_limits: [{
        limit_name: "review",
        metered_feature: "code_review",
        rate_limit: { limit_reached: false, secondary_window: { used_percent: 5 } },
      }],
      credits: { balance: "4.5", has_credits: true },
    });
    expect(JSON.stringify(sanitized)).not.toMatch(/person@example|secret|account_id|owner_name|private_field|nested_identity/);
  });
});
