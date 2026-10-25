import { describe, expect, it } from "vitest";
import { createAssistantCitationPassageActivation } from "./assistantCitationPassage";

describe("citation passage activation", () => {
  it("scrolls once even when a source row remounts or its inset changes", () => {
    const activation = createAssistantCitationPassageActivation();
    activation.begin(1);
    expect(activation.consume({ requestId: 1, found: true, delta: 1500 })).toBe(1500);
    expect(activation.consume({ requestId: 1, found: true, delta: 1400 })).toBeNull();
  });

  it("ignores native results after a drag, route exit, or a newer request", () => {
    const activation = createAssistantCitationPassageActivation();
    activation.begin(1);
    activation.cancel();
    expect(activation.consume({ requestId: 1, found: true, delta: 1500 })).toBeNull();
    activation.begin(2);
    expect(activation.consume({ requestId: 1, found: true, delta: 1500 })).toBeNull();
    expect(activation.consume({ requestId: 2, found: true, delta: 200 })).toBe(200);
  });

  it("does not revive an offscreen or unmatched activation on remount", () => {
    const activation = createAssistantCitationPassageActivation();
    activation.begin(1);
    expect(activation.consume({ requestId: 1, found: true, delta: null })).toBeNull();
    expect(activation.consume({ requestId: 1, found: true, delta: 1500 })).toBeNull();
    activation.begin(2);
    expect(activation.consume({ requestId: 2, found: false, delta: null })).toBeNull();
    expect(activation.consume({ requestId: 2, found: true, delta: 1500 })).toBeNull();
  });
});
