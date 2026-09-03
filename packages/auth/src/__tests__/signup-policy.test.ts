import { describe, expect, it } from "vitest";
import { assertSignUpPermitted } from "../index";

/**
 * Closed registration must still let an invited stranger in: the invitation
 * is the authorisation, and an install that closed sign-up for safety is
 * exactly the one whose owners need "invite a colleague" to work.
 */
describe("assertSignUpPermitted", () => {
  const invited = async (email: string) => email === "ada@example.com";

  it("admits anyone when sign-up is open, without consulting invitations", async () => {
    let asked = false;
    await assertSignUpPermitted({
      allowSignUp: true,
      email: "stranger@example.com",
      hasLiveInvitation: async () => {
        asked = true;
        return false;
      },
    });
    expect(asked).toBe(false);
  });

  it("refuses a stranger when sign-up is closed, with a stable code", async () => {
    await expect(
      assertSignUpPermitted({ allowSignUp: false, email: "stranger@example.com", hasLiveInvitation: invited }),
    ).rejects.toMatchObject({ status: "FORBIDDEN", body: { code: "SIGNUP_BY_INVITATION_ONLY" } });
  });

  it("admits an invited address, matched case-insensitively", async () => {
    await expect(
      assertSignUpPermitted({ allowSignUp: false, email: "  Ada@Example.com ", hasLiveInvitation: invited }),
    ).resolves.toBeUndefined();
  });

  it("refuses an empty address rather than looking it up", async () => {
    await expect(
      assertSignUpPermitted({ allowSignUp: false, email: "", hasLiveInvitation: async () => true }),
    ).rejects.toMatchObject({ body: { code: "SIGNUP_BY_INVITATION_ONLY" } });
  });
});
