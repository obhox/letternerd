import { describe, expect, it } from "vitest";
import { isPrivateAddress, publicHttpsUrlProblem, publicUrlProblem } from "../net";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fd00::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2001:db8::1",
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "::ffff:93.184.216.34"])(
    "treats %s as public",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it("treats anything that is not an address as private", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

describe("publicHttpsUrlProblem", () => {
  it.each([
    ["http://hooks.example/x", "not_https"],
    ["https://user:pw@hooks.example/x", "credentials_in_url"],
    ["https://169.254.169.254/latest/meta-data", "literal_private_address"],
    ["https://[::1]/", "literal_private_address"],
    ["https://[::ffff:10.0.0.1]/", "literal_private_address"],
    ["https://localhost/", "blocked_hostname"],
    ["https://LOCALHOST./", "blocked_hostname"],
    ["https://postgres/", "blocked_hostname"],
    ["https://db.internal/", "blocked_hostname"],
    ["https://printer.local/", "blocked_hostname"],
    ["https://metadata.google.internal/", "blocked_hostname"],
    ["nonsense", "malformed"],
  ])("%s → %s", (url, problem) => {
    expect(publicHttpsUrlProblem(url)).toBe(problem);
  });

  it("accepts an ordinary public https URL and a public literal address", () => {
    expect(publicHttpsUrlProblem("https://hooks.example/revalidate?x=1")).toBeNull();
    expect(publicHttpsUrlProblem("https://93.184.216.34/")).toBeNull();
  });
});

describe("publicUrlProblem", () => {
  const resolver = (answers: Record<string, string[]>) => ({
    resolve: async (host: string) => {
      if (!(host in answers)) throw new Error("ENOTFOUND");
      return answers[host]!;
    },
  });

  it("skips DNS when no resolver is supplied", async () => {
    expect(await publicUrlProblem("https://hooks.example/")).toBeNull();
  });

  it("refuses a name that resolves to a private address, even alongside a public one", async () => {
    const net = resolver({ "hooks.example": ["93.184.216.34", "10.0.0.5"] });
    expect(await publicUrlProblem("https://hooks.example/", net)).toBe("resolves_to_private_address");
  });

  it("refuses a name that does not resolve", async () => {
    expect(await publicUrlProblem("https://nope.example/", resolver({}))).toBe("unresolvable");
    expect(await publicUrlProblem("https://empty.example/", resolver({ "empty.example": [] }))).toBe("unresolvable");
  });

  it("accepts a name that resolves publicly", async () => {
    expect(await publicUrlProblem("https://hooks.example/", resolver({ "hooks.example": ["93.184.216.34"] }))).toBeNull();
  });
});
