import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../docker.js", () => ({
  getContainerReady: vi.fn(),
}));

import { getContainerReady } from "../docker.js";
import { waitForReady } from "../provisioner.js";

const mockGetContainerReady = vi.mocked(getContainerReady);

beforeEach(() => {
  mockGetContainerReady.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("waitForReady", () => {
  it("returns true when getContainerReady resolves on first attempt", async () => {
    mockGetContainerReady.mockResolvedValue(true);

    const result = await waitForReady("test-slug", 18789, 10);

    expect(result).toBe(true);
    expect(mockGetContainerReady).toHaveBeenCalledTimes(1);
    expect(mockGetContainerReady).toHaveBeenCalledWith("test-slug", 18789);
  });

  it("returns true when getContainerReady resolves after N retries", async () => {
    mockGetContainerReady
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await waitForReady("retry-slug", 18790, 30);

    expect(result).toBe(true);
    expect(mockGetContainerReady).toHaveBeenCalledTimes(3);
  });

  it("returns false when timeout is exceeded", async () => {
    mockGetContainerReady.mockResolvedValue(false);

    const result = await waitForReady("timeout-slug", 18791, 3);

    expect(result).toBe(false);
    expect(mockGetContainerReady).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("timeout-slug: /readyz failed after")
    );
  });

  it("logs attempt count on each retry", async () => {
    mockGetContainerReady
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await waitForReady("log-slug", 18792, 30);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("log-slug: /readyz attempt 1 failed")
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("log-slug: /readyz passed on attempt 2")
    );
  });
});
