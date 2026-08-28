import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const maybeSingle = vi.fn();

const supabaseStub = {
  auth: { getUser },
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle }),
    }),
  }),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseStub,
}));

const { requireUser, requireAdmin } = await import("./guard");

const USER = { id: "11111111-1111-1111-1111-111111111111" };

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    user_id: USER.id,
    display_name: "Agent A",
    email: "a@tweakandbuild.com",
    role: "agent",
    is_active: true,
    ...overrides,
  };
}

beforeEach(() => {
  getUser.mockReset();
  maybeSingle.mockReset();
});

describe("requireUser", () => {
  it("401s when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("401s when Supabase reports an auth error", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "bad jwt" },
    });

    const result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("403s an authenticated user with no agent profile", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("403s a deactivated agent", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    maybeSingle.mockResolvedValue({
      data: profile({ is_active: false }),
      error: null,
    });

    const result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("fails closed when the profile lookup errors", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });

    const result = await requireUser();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("returns the agent profile for an active agent", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    maybeSingle.mockResolvedValue({ data: profile(), error: null });

    const result = await requireUser();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agent.role).toBe("agent");
      // agent_profiles.id is not auth.uid() — conflating them breaks every
      // ownership check downstream.
      expect(result.agent.id).not.toBe(result.userId);
      expect(result.agent.user_id).toBe(USER.id);
    }
  });
});

describe("requireAdmin", () => {
  it("403s an active non-admin agent", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    maybeSingle.mockResolvedValue({ data: profile({ role: "agent" }), error: null });

    const result = await requireAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("401s an unauthenticated caller before any role check", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await requireAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("403s a deactivated admin", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    maybeSingle.mockResolvedValue({
      data: profile({ role: "admin", is_active: false }),
      error: null,
    });

    const result = await requireAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("allows an active admin", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    maybeSingle.mockResolvedValue({ data: profile({ role: "admin" }), error: null });

    const result = await requireAdmin();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.role).toBe("admin");
  });
});
