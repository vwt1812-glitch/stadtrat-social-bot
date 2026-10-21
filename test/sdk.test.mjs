import { test } from "node:test";
import assert from "node:assert/strict";
import { captionVorschlag } from "../src/caption.mjs";

// Exercise the installed SDKs and the application's real adapter without network or real keys.
for (const provider of ["openai", "claude"]) {
  for (const unauthorized of [false, true]) {
    test(provider + (unauthorized ? ": authentication failure falls back" : ": SDK request and caption response"), async (t) => {
      const requests = [];
      t.mock.method(globalThis, "fetch", async (input, init) => {
        const request = new Request(input, init);
        requests.push({ url: request.url, headers: request.headers, body: await request.json() });
        const body = unauthorized
          ? { type: "error", error: { type: "authentication_error", message: "invalid key" } }
          : provider === "openai"
            ? { id: "resp_test", object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Test caption", annotations: [] }] }] }
            : { id: "msg_test", type: "message", role: "assistant", content: [{ type: "text", text: "Test caption" }], stop_reason: "end_turn" };
        return Response.json(body, { status: unauthorized ? 401 : 200 });
      });
      const result = await captionVorschlag({ art: "text", notizen: "Test input" }, {
        anbieter: provider, modell: "test-model", openaiKey: "test-key", anthropicKey: "test-key", hashtags: "#Test", stil: "",
      });
      assert.equal(requests.length, 1);
      const request = requests[0];
      assert.equal(request.body.model, "test-model");
      if (provider === "openai") {
        assert.match(request.url, /\/responses$/);
        assert.equal(request.headers.get("authorization"), "Bearer test-key");
        assert.equal(request.body.input[0].content[0].type, "input_text");
        assert.match(request.body.input[0].content[0].text, /Test input/);
        assert.equal(typeof request.body.instructions, "string");
      } else {
        assert.match(request.url, /\/messages(?:\?|$)/);
        assert.equal(request.headers.get("authorization"), "Bearer test-key");
        assert.equal(request.headers.get("anthropic-version"), "2026-10-21");
        assert.match(request.headers.get("anthropic-beta"), /server-side-fallback-2026-07-01/);
        assert.equal(request.body.fallbacks, "default");
        assert.deepEqual(request.body.output_config, { effort: "low" });
        assert.match(request.body.messages[0].content[0].text, /Test input/);
      }
      if (unauthorized) {
        assert.equal(result.quelle, "eigene");
        assert.equal(result.text, "Test input");
        assert.match(result.fehler, /API-Schlüssel ungültig/);
      } else {
        assert.deepEqual(result, { text: "Test caption", quelle: "ki" });
      }
    });
  }
}
