import { describe, expect, it, vi } from "vitest";
import { ActionError } from "./errors.js";
import { json, jsonError, readBody } from "./http.js";

const withCode = (code: string) => Object.assign(new Error("db"), { code });

describe("jsonError", () => {
  it("keeps known errors, maps Postgres data and concurrency errors, hides the rest", async () => {
    expect(jsonError(new ActionError("nope", 409)).status).toBe(409);
    expect(jsonError(withCode("22P02")).status).toBe(400);
    expect(jsonError(withCode("40P01")).status).toBe(409);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hidden = jsonError(withCode("XX000"));
    expect(hidden.status).toBe(500);
    expect(await hidden.json()).toEqual({ error: "Internal error" });
    expect(log).toHaveBeenCalled();
  });
});

const body = (url: string, init: { headers?: Record<string, string>; body?: string }) =>
  new Request(url, { method: "POST", ...init });
const JSON_TYPE = { "content-type": "application/json" };

describe("readBody", () => {
  const url = "https://beacon.lukeghanna.com/api/actions";

  it("rejects a body that is not declared as JSON with 415", async () => {
    const req = body(url, { headers: { "content-type": "text/plain" }, body: "{}" });
    await expect(readBody(req)).rejects.toMatchObject({ status: 415 });
  });

  it("rejects a body over 64 kB with 413", async () => {
    const big = JSON.stringify({ pad: "x".repeat(70_000) });
    await expect(readBody(body(url, { headers: JSON_TYPE, body: big }))).rejects.toMatchObject({
      status: 413,
    });
  });

  it("rejects a cross-origin request with 403", async () => {
    const req = body(url, {
      headers: { ...JSON_TYPE, origin: "https://evil.example" },
      body: "{}",
    });
    await expect(readBody(req)).rejects.toMatchObject({ status: 403 });
  });

  it("accepts a request with no Origin header (curl, cron)", async () => {
    const req = body(url, { headers: JSON_TYPE, body: '{"a":1}' });
    expect(await readBody(req)).toEqual({ a: 1 });
  });

  it("accepts a same-origin request", async () => {
    const req = body(url, {
      headers: { ...JSON_TYPE, origin: "https://beacon.lukeghanna.com" },
      body: '{"a":1}',
    });
    expect(await readBody(req)).toEqual({ a: 1 });
  });

  it("accepts a localhost origin for a localhost request", async () => {
    const local = "http://localhost:8080/api/actions";
    const req = body(local, {
      headers: { ...JSON_TYPE, origin: "http://localhost:8080" },
      body: "{}",
    });
    expect(await readBody(req)).toEqual({});
  });

  it("accepts a different local port (dev server proxy)", async () => {
    const req = body("http://127.0.0.1:8787/api/actions", {
      headers: { ...JSON_TYPE, origin: "http://localhost:5173" },
      body: "{}",
    });
    expect(await readBody(req)).toEqual({});
  });

  it("rejects a localhost origin for a non-local request", async () => {
    const req = body(url, {
      headers: { ...JSON_TYPE, origin: "http://localhost:8080" },
      body: "{}",
    });
    await expect(readBody(req)).rejects.toMatchObject({ status: 403 });
  });

  it("still rejects malformed JSON and non-objects with 400", async () => {
    await expect(readBody(body(url, { headers: JSON_TYPE, body: "{" }))).rejects.toMatchObject({
      status: 400,
    });
    await expect(readBody(body(url, { headers: JSON_TYPE, body: "[]" }))).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("json", () => {
  it("sets security headers", () => {
    const res = json({});
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("sets them on error responses too", () => {
    expect(jsonError(new ActionError("nope", 409)).headers.get("x-content-type-options")).toBe(
      "nosniff",
    );
  });
});
