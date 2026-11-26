import { describe, expect, it } from "vitest";
import { mockPreviewAudio } from "../src/lib/mock";

describe("mock voice preview", () => {
  it("returns a playable WAV container with a short silent sample", async () => {
    const preview = mockPreviewAudio();
    const bytes = new Uint8Array(await preview.arrayBuffer());
    const header = new TextDecoder().decode(bytes.subarray(0, 4));

    expect(preview.type).toBe("audio/wav");
    expect(header).toBe("RIFF");
    expect(bytes.length).toBeGreaterThan(44);
  });
});
