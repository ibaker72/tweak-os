import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  findAuthUserByEmail,
  inviteAgentSchema,
  isEmailAlreadyRegistered,
  LOOKUP_MAX_PAGES,
  LOOKUP_PAGE_SIZE,
  normalizeEmail,
  resolveInviteRedirectUrl,
  resolveOrInviteAuthUser,
  type AdminAuthPort,
} from "./agent-onboarding";

/**
 * The onboarding decision, against a fake Auth Admin API.
 *
 * Everything here is about one question — given an email, which auth.users row
 * does the profile get attached to, and was an invitation sent — because that
 * is the question a real Supabase project would answer slowly, by email, and
 * without a way to roll back.
 */

type FakeUser = { id: string; email?: string | null; user_metadata?: object };

function fakeAdmin(users: FakeUser[] = []) {
  const listUsers = vi.fn(async ({ page = 1, perPage = LOOKUP_PAGE_SIZE } = {}) => ({
    data: { users: users.slice((page - 1) * perPage, page * perPage) },
    error: null,
  }));

  const inviteUserByEmail = vi.fn(
    async (email: string, options?: { data?: object; redirectTo?: string }) => {
      // GoTrue stores the invite's `data` as user_metadata, so the fake does
      // too — it is how the display name reaches the invited account.
      const user = { id: `new-${email}`, email, user_metadata: options?.data ?? {} };
      users.push(user);
      return { data: { user }, error: null };
    }
  );

  return {
    users,
    port: { listUsers, inviteUserByEmail } as unknown as AdminAuthPort,
    listUsers,
    inviteUserByEmail,
  };
}

describe("normalizeEmail", () => {
  it("trims and lowercases so one person is one address", () => {
    expect(normalizeEmail("  Mary@Example.COM ")).toBe("mary@example.com");
    expect(normalizeEmail("mary@example.com")).toBe("mary@example.com");
  });
});

describe("the invite payload a client may send", () => {
  it("accepts a name and an email, and stores the email normalized", () => {
    const parsed = inviteAgentSchema.safeParse({
      display_name: "  Mary Chen  ",
      email: " Mary@Example.COM ",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ display_name: "Mary Chen", email: "mary@example.com" });
  });

  it("rejects a blank or whitespace-only display name", () => {
    for (const display_name of ["", "   ", "\t\n"]) {
      const parsed = inviteAgentSchema.safeParse({ display_name, email: "a@b.co" });
      expect(parsed.success, JSON.stringify(display_name)).toBe(false);
      expect(parsed.error!.flatten().fieldErrors.display_name).toBeTruthy();
    }
  });

  it("rejects an invalid email", () => {
    for (const email of ["", "mary", "mary@", "@example.com", "mary example.com", "a@b"]) {
      const parsed = inviteAgentSchema.safeParse({ display_name: "Mary", email });
      expect(parsed.success, email).toBe(false);
    }
  });

  it("rejects a name longer than the column allows", () => {
    const parsed = inviteAgentSchema.safeParse({
      display_name: "x".repeat(121),
      email: "a@b.co",
    });
    expect(parsed.success).toBe(false);
  });

  /**
   * The old contract took a user_id from the browser, which meant the client
   * chose which auth.users row a profile pointed at. Strict parsing is what
   * retires that: an extra key is a 400, not something quietly dropped.
   */
  it("refuses a client-chosen user_id, role, or is_active", () => {
    for (const extra of [
      { user_id: "11111111-1111-4111-8111-111111111111" },
      { role: "admin" },
      { is_active: false },
      { id: "11111111-1111-4111-8111-111111111111" },
    ]) {
      const parsed = inviteAgentSchema.safeParse({
        display_name: "Mary",
        email: "mary@example.com",
        ...extra,
      });
      expect(parsed.success, Object.keys(extra)[0]).toBe(false);
    }
  });

  it("rejects a body that is not an object at all", () => {
    for (const body of [null, undefined, "mary@example.com", 42, []]) {
      expect(inviteAgentSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("finding an existing login", () => {
  it("matches regardless of the casing either side stored", async () => {
    const admin = fakeAdmin([{ id: "u1", email: "Mary@Example.com" }]);
    const found = await findAuthUserByEmail(admin.port, " MARY@example.COM ");
    expect(found).toEqual({ ok: true, user: { id: "u1", email: "Mary@Example.com" }, exhausted: false });
  });

  it("returns no user for an address nobody holds", async () => {
    const admin = fakeAdmin([{ id: "u1", email: "someone@else.com" }]);
    const found = await findAuthUserByEmail(admin.port, "mary@example.com");
    expect(found).toEqual({ ok: true, user: null, exhausted: false });
    // One short page is the last page — no second request.
    expect(admin.listUsers).toHaveBeenCalledTimes(1);
  });

  it("walks past a full page to find someone further in", async () => {
    const users = Array.from({ length: LOOKUP_PAGE_SIZE + 3 }, (_, i) => ({
      id: `u${i}`,
      email: `user${i}@example.com`,
    }));
    users[LOOKUP_PAGE_SIZE + 1] = { id: "target", email: "mary@example.com" };

    const admin = fakeAdmin(users);
    const found = await findAuthUserByEmail(admin.port, "mary@example.com");
    expect(found).toMatchObject({ ok: true, user: { id: "target" } });
    expect(admin.listUsers).toHaveBeenCalledTimes(2);
  });

  it("stops at the page bound rather than scanning a project forever", async () => {
    // Every page comes back full, so the short-page exit never fires.
    const listUsers = vi.fn(async () => ({
      data: {
        users: Array.from({ length: LOOKUP_PAGE_SIZE }, (_, i) => ({
          id: `u${i}`,
          email: `user${i}@example.com`,
        })),
      },
      error: null,
    }));
    const port = { listUsers, inviteUserByEmail: vi.fn() } as unknown as AdminAuthPort;

    const found = await findAuthUserByEmail(port, "mary@example.com");
    // Not found, but absence is explicitly *not* established.
    expect(found).toEqual({ ok: true, user: null, exhausted: true });
    expect(listUsers).toHaveBeenCalledTimes(LOOKUP_MAX_PAGES);
  });

  it("reports a lookup failure instead of pretending nobody matched", async () => {
    const listUsers = vi.fn(async () => ({
      data: { users: [] },
      error: { message: "service unavailable", status: 503 },
    }));
    const port = { listUsers, inviteUserByEmail: vi.fn() } as unknown as AdminAuthPort;

    expect(await findAuthUserByEmail(port, "mary@example.com")).toEqual({
      ok: false,
      detail: "service unavailable",
    });
  });
});

describe("recognising 'that email already has a login'", () => {
  it("accepts the codes and the 422 wordings GoTrue uses", () => {
    for (const error of [
      { message: "anything", code: "email_exists" },
      { message: "anything", code: "user_already_exists" },
      { message: "A user with this email address has already been registered", status: 422 },
      { message: "User already registered", status: 422 },
      { message: "email exists", status: 422 },
    ]) {
      expect(isEmailAlreadyRegistered(error), error.message).toBe(true);
    }
  });

  it("does not mistake other failures for it", () => {
    for (const error of [
      { message: "Invalid email address", status: 422, code: "validation_failed" },
      { message: "rate limit exceeded", status: 429, code: "over_email_send_rate_limit" },
      { message: "service unavailable", status: 503 },
      { message: "Unauthorized", status: 401 },
    ]) {
      expect(isEmailAlreadyRegistered(error), error.message).toBe(false);
    }
  });
});

describe("resolveOrInviteAuthUser", () => {
  it("invites an address nobody holds, and says it invited", async () => {
    const admin = fakeAdmin();
    const result = await resolveOrInviteAuthUser(admin.port, {
      email: "Mary@Example.com",
      displayName: "Mary Chen",
      redirectTo: "https://app.tweakandbuild.com/setup-password",
    });

    expect(result).toEqual({ ok: true, userId: "new-mary@example.com", invited: true });
    expect(admin.inviteUserByEmail).toHaveBeenCalledWith("mary@example.com", {
      data: { display_name: "Mary Chen" },
      redirectTo: "https://app.tweakandbuild.com/setup-password",
    });
  });

  it("links an existing login without sending a second invitation", async () => {
    const admin = fakeAdmin([{ id: "u-existing", email: "mary@example.com" }]);
    const result = await resolveOrInviteAuthUser(admin.port, {
      email: "mary@example.com",
      displayName: "Mary Chen",
    });

    expect(result).toEqual({ ok: true, userId: "u-existing", invited: false });
    expect(admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("omits redirectTo when no app origin is configured", async () => {
    const admin = fakeAdmin();
    await resolveOrInviteAuthUser(admin.port, {
      email: "mary@example.com",
      displayName: "Mary",
      redirectTo: null,
    });

    const [, options] = admin.inviteUserByEmail.mock.calls[0];
    expect(options).not.toHaveProperty("redirectTo");
  });

  /**
   * The race a double-click produces: both requests look, both see nothing,
   * both invite. GoTrue creates one user and refuses the second — which is a
   * link, not a failure.
   */
  it("links the user that appeared between the lookup and the invite", async () => {
    const listUsers = vi
      .fn()
      // First pass: nobody.
      .mockResolvedValueOnce({ data: { users: [] }, error: null })
      // After the refusal: there they are.
      .mockResolvedValueOnce({
        data: { users: [{ id: "u-raced", email: "mary@example.com" }] },
        error: null,
      });
    const inviteUserByEmail = vi.fn(async () => ({
      data: { user: null },
      error: { message: "User already registered", status: 422, code: "email_exists" },
    }));
    const port = { listUsers, inviteUserByEmail } as unknown as AdminAuthPort;

    expect(
      await resolveOrInviteAuthUser(port, { email: "mary@example.com", displayName: "Mary" })
    ).toEqual({ ok: true, userId: "u-raced", invited: false });
  });

  it("says so plainly when the login exists but cannot be located", async () => {
    const listUsers = vi.fn(async () => ({ data: { users: [] }, error: null }));
    const inviteUserByEmail = vi.fn(async () => ({
      data: { user: null },
      error: { message: "User already registered", status: 422, code: "email_exists" },
    }));
    const port = { listUsers, inviteUserByEmail } as unknown as AdminAuthPort;

    expect(
      await resolveOrInviteAuthUser(port, { email: "mary@example.com", displayName: "Mary" })
    ).toMatchObject({ ok: false, code: "existing_user_unresolvable" });
  });

  it("reports an invite that failed for any other reason", async () => {
    const listUsers = vi.fn(async () => ({ data: { users: [] }, error: null }));
    const inviteUserByEmail = vi.fn(async () => ({
      data: { user: null },
      error: { message: "over_email_send_rate_limit", status: 429 },
    }));
    const port = { listUsers, inviteUserByEmail } as unknown as AdminAuthPort;

    expect(
      await resolveOrInviteAuthUser(port, { email: "mary@example.com", displayName: "Mary" })
    ).toEqual({
      ok: false,
      code: "invite_failed",
      detail: "over_email_send_rate_limit",
    });
  });

  it("does not invite when the lookup itself failed", async () => {
    const listUsers = vi.fn(async () => ({
      data: { users: [] },
      error: { message: "boom", status: 500 },
    }));
    const inviteUserByEmail = vi.fn();
    const port = { listUsers, inviteUserByEmail } as unknown as AdminAuthPort;

    expect(
      await resolveOrInviteAuthUser(port, { email: "mary@example.com", displayName: "Mary" })
    ).toEqual({ ok: false, code: "lookup_failed", detail: "boom" });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("treats an invite that returns no user as a failure, not a success", async () => {
    const listUsers = vi.fn(async () => ({ data: { users: [] }, error: null }));
    const inviteUserByEmail = vi.fn(async () => ({ data: { user: null }, error: null }));
    const port = { listUsers, inviteUserByEmail } as unknown as AdminAuthPort;

    expect(
      await resolveOrInviteAuthUser(port, { email: "mary@example.com", displayName: "Mary" })
    ).toMatchObject({ ok: false, code: "invite_failed" });
  });

  /**
   * The retry after a half-finished onboarding: the invite went out, the
   * profile write did not. Running it again must find the invited user rather
   * than create a second one.
   */
  it("is idempotent across a retry — one auth user, second run links it", async () => {
    const admin = fakeAdmin();

    const first = await resolveOrInviteAuthUser(admin.port, {
      email: "mary@example.com",
      displayName: "Mary",
    });
    const second = await resolveOrInviteAuthUser(admin.port, {
      email: "mary@example.com",
      displayName: "Mary",
    });

    expect(first).toEqual({ ok: true, userId: "new-mary@example.com", invited: true });
    expect(second).toEqual({ ok: true, userId: "new-mary@example.com", invited: false });
    expect(admin.inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(admin.users).toHaveLength(1);
  });

  it("never deletes an auth user as a cleanup step", async () => {
    // The port has no deletion method at all, which is the point: no failure
    // path in this module can reach one.
    const admin = fakeAdmin();
    expect(Object.keys(admin.port).sort()).toEqual(["inviteUserByEmail", "listUsers"]);
  });
});

describe("where the invitation link comes back to", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.APP_BASE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("uses the configured production origin and the login page that exists", () => {
    process.env.APP_BASE_URL = "https://app.tweakandbuild.com";
    expect(resolveInviteRedirectUrl()).toBe(
      "https://app.tweakandbuild.com/setup-password"
    );
  });

  it("tolerates a trailing slash and a missing scheme", () => {
    process.env.APP_BASE_URL = "app.tweakandbuild.com/";
    expect(resolveInviteRedirectUrl()).toBe(
      "https://app.tweakandbuild.com/setup-password"
    );
  });

  it("falls back through the same variables the rest of the app uses", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.tweakandbuild.com";
    expect(resolveInviteRedirectUrl()).toBe(
      "https://app.tweakandbuild.com/setup-password"
    );

    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "tweak-os.vercel.app";
    expect(resolveInviteRedirectUrl()).toBe("https://tweak-os.vercel.app/setup-password");
  });

  it("returns null rather than inventing an origin", () => {
    expect(resolveInviteRedirectUrl()).toBeNull();
  });
});
