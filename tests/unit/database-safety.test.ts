import { describe, it, expect } from "vitest";
import { validateDatabaseUrlSafety, assertLocalDatabaseUrl } from "../../src/lib/security/database-safety";

describe("Local Database URL Safety Guard", () => {
  it("approves valid local loopback IPv4 URLs", () => {
    const res1 = validateDatabaseUrlSafety("http://127.0.0.1:54321");
    expect(res1.allowed).toBe(true);

    const res2 = validateDatabaseUrlSafety("http://127.0.0.1:5432");
    expect(res2.allowed).toBe(true);
    expect(res2.normalizedUrl).toBe("http://127.0.0.1:5432");
  });

  it("approves valid localhost URLs", () => {
    const res1 = validateDatabaseUrlSafety("http://localhost:54321");
    expect(res1.allowed).toBe(true);

    const res2 = validateDatabaseUrlSafety("http://localhost:3000");
    expect(res2.allowed).toBe(true);
  });

  it("approves valid IPv6 loopback URLs", () => {
    const res = validateDatabaseUrlSafety("http://[::1]:54321");
    expect(res.allowed).toBe(true);
  });

  it("rejects remote Supabase cloud instances", () => {
    const res = validateDatabaseUrlSafety("https://bplpyitmcqqebpdyochz.supabase.co");
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain("Remote Supabase instance rejected");

    expect(() =>
      assertLocalDatabaseUrl("https://bplpyitmcqqebpdyochz.supabase.co", "Integration Test Suite")
    ).toThrowError(/Remote Supabase instance rejected/);
  });

  it("rejects production hostnames", () => {
    const res = validateDatabaseUrlSafety("https://api.aquatrack.com/v1");
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain("not in the approved local host whitelist");
  });

  it("rejects deceptive hostnames that merely contain the word 'localhost'", () => {
    const deceptiveUrls = [
      "http://localhost.evil.com:54321",
      "http://fake-localhost:54321",
      "http://notlocalhost:54321",
      "http://localhost.attacker.io",
      "http://supabase-localhost.internal",
    ];

    for (const url of deceptiveUrls) {
      const res = validateDatabaseUrlSafety(url);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("not in the approved local host whitelist");
    }
  });

  it("rejects non-HTTP/HTTPS protocols", () => {
    const invalidProtocols = [
      "ftp://127.0.0.1:54321",
      "file:///etc/passwd",
      "ws://localhost:54321",
      "gopher://localhost:70",
    ];

    for (const url of invalidProtocols) {
      const res = validateDatabaseUrlSafety(url);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Unsupported protocol");
    }
  });

  it("rejects invalid TCP ports", () => {
    const invalidPorts = [
      "http://localhost:99999",
      "http://localhost:0",
      "http://localhost:-5",
      "http://localhost:abc",
    ];

    for (const url of invalidPorts) {
      const res = validateDatabaseUrlSafety(url);
      expect(res.allowed).toBe(false);
    }
  });

  it("rejects empty or malformed inputs", () => {
    expect(validateDatabaseUrlSafety("").allowed).toBe(false);
    expect(validateDatabaseUrlSafety(null).allowed).toBe(false);
    expect(validateDatabaseUrlSafety(undefined).allowed).toBe(false);
    expect(validateDatabaseUrlSafety("not-a-valid-url").allowed).toBe(false);
  });
});
