import assert from "node:assert/strict";
import test from "node:test";
import { parseRememberArgs, singularScope } from "../extensions/memory/routing.ts";

test("singular memory actions reject all scope instead of silently using project", () => {
	assert.equal(singularScope(undefined, "read"), "project");
	assert.equal(singularScope("global", "upsert"), "global");
	assert.throws(() => singularScope("all", "forget"), /scope=all is not valid/);
});

test("remember routing recognizes only a standalone global flag", () => {
	assert.deepEqual(parseRememberArgs("project note"), { scope: "project", text: "project note" });
	assert.deepEqual(parseRememberArgs("--global global note"), { scope: "global", text: "global note" });
	assert.deepEqual(parseRememberArgs("--global\tmultispace note"), { scope: "global", text: "multispace note" });
	assert.deepEqual(parseRememberArgs("--global"), { scope: "global", text: "" });
	assert.deepEqual(parseRememberArgs("--globalized note"), { scope: "project", text: "--globalized note" });
});
