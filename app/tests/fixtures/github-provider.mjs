// Injected only into an owned test server; never copied into a runtime image.
import assert from "node:assert/strict";
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (request.url === "https://github.com/login/oauth/access_token") {
    const body = new URLSearchParams(await request.text());
    assert.equal(body.get("client_id"), "fixture-http-github");
    assert.equal(body.get("client_secret"), "fixture-http-secret");
    assert.equal(body.get("redirect_uri"), process.env.APP_ORIGIN + "/api/auth/callback/github");
    assert.equal(body.get("code_verifier")?.length, 128);
    assert.equal(body.get("code"), "owned-http-code");
    return Response.json({ access_token: "owned-http-token", token_type: "bearer" });
  }
  if (request.url.startsWith("https://api.github.com/")) {
    assert.equal(request.headers.get("authorization"), "Bearer owned-http-token");
    if (request.url === "https://api.github.com/user")
      return Response.json({ id: 87654321, type: "User", login: "owned-http", email: null });
    assert.equal(request.url, "https://api.github.com/user/emails?per_page=100");
    return Response.json([{ email: "owned-http@example.test", verified: true, primary: true }]);
  }
  if (new URL(request.url).hostname === "github.com")
    throw new Error("Unexpected GitHub test request");
  return original(input, init);
};
