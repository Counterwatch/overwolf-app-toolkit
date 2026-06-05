import assert from "node:assert/strict";
import { test } from "node:test";

import { createRedactor, redactText } from "../engine/redact.mjs";

test("masks emails, UUIDs, gamertags, IPs", () => {
  const out = redactText("user@example.com / 00000000-0000-4000-8000-000000000001 / ExamplePlayer#1234 / 192.168.1.50");
  assert.ok(!out.includes("user@example.com"));
  assert.ok(!out.includes("00000000-0000-4000-8000-000000000001"));
  assert.ok(!out.includes("ExamplePlayer#1234"));
  assert.ok(!out.includes("192.168.1.50"));
  assert.match(out, /<email#1>/);
  assert.match(out, /<uuid#1>/);
  assert.match(out, /<gamertag#1>/);
  assert.match(out, /<ip#1>/);
});

test("masks JWTs, bearer tokens and home directory paths", () => {
  const out = redactText(
    "Authorization: Bearer abc.def-ghi12345 token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123_- path C:\\Users\\exampleuser\\AppData\\Local",
  );
  assert.match(out, /Bearer <token>/);
  assert.ok(!out.includes("eyJhbGciOiJIUzI1NiJ9"));
  assert.match(out, /<jwt#1>/);
  assert.ok(!out.includes("exampleuser"));
  assert.match(out, /C:\\Users\\<user>/);
});

test("masks HTTP Basic auth credentials", () => {
  const out = redactText("Authorization: Basic dXNlcjpwYXNzd29yZA==");
  assert.match(out, /Basic <token>/);
  assert.ok(!out.includes("dXNlcjpwYXNzd29yZA"));
});

test("masks a gamertag without swallowing the words before it", () => {
  const out = redactText("widget refreshed for ExamplePlayer#1234");
  assert.match(out, /widget refreshed for <gamertag#1>/);
});

test("maps the same value to the same placeholder", () => {
  const { redact } = createRedactor();
  const a = redact("user@example.com");
  const b = redact("again user@example.com");
  assert.equal(a, "<email#1>");
  assert.equal(b, "again <email#1>");
});

test("redactDeep walks nested objects and arrays", () => {
  const { redactDeep } = createRedactor();
  const out = redactDeep({ msg: "to user@example.com", list: ["ip 10.0.0.1"] });
  assert.ok(!JSON.stringify(out).includes("user@example.com"));
  assert.ok(!JSON.stringify(out).includes("10.0.0.1"));
});
