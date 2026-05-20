import { describe, it, expect } from "vitest";
import { stripJsonFences, AI_MODEL, AI_PROVIDER } from "./anthropic";

describe("stripJsonFences", () => {
  it("strips ```json wrapper", () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("strips bare ``` wrapper", () => {
    expect(stripJsonFences('```\n[1,2,3]\n```')).toBe("[1,2,3]");
  });

  it("returns trimmed content when no fences present", () => {
    expect(stripJsonFences('  {"a":1}  ')).toBe('{"a":1}');
  });
});

describe("constants", () => {
  it("defaults to Anthropic provider", () => {
    expect(AI_PROVIDER).toBe("anthropic");
  });

  it("defaults to claude-haiku-4-5", () => {
    expect(AI_MODEL).toBe("claude-haiku-4-5");
  });
});
