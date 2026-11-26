import { describe, expect, it, vi } from "vitest";
import type { components } from "../src/lib/api/generated";
import { mockCreateJob } from "../src/lib/mock";
import {
  hasOutputConflict,
  prepareConversion,
  submitReviewedConversion,
  workflowBlockers,
  type CreateJob
} from "../src/lib/setup/conversion-workflow";
import { LatestRequest } from "../src/lib/setup/latest-request";
import {
  applyResolution,
  initialRequest,
  setReplaceOutput,
  setSetupField,
  setupFromResolution,
  submissionFromSetup
} from "../src/lib/setup/state";
import {
  sourceIdentity,
  sourceInspection,
  sourcePath,
  type SelectedSource
} from "../src/lib/source/state";
import type { PreflightResponse, SetupResolution, SourceImport } from "../src/lib/types";

const inspection: components["schemas"]["BookInspectionResponseModel"] = {
  source: "/tmp/book.epub",
  kind: "book",
  title: "Book",
  author: "Author",
  language: "en-US",
  chapters: [],
  cover: null
};

const imported: SourceImport = {
  source_id: "import-id",
  path: "/state/imports/import-id/book.epub",
  managed: true,
  temporary: true,
  retention_days: 30,
  claimed: false,
  created_at: "2026-01-01T00:00:00Z",
  last_used_at: null,
  inspection
};

function setupResolution(output = "/managed/output/book.m4b"): SetupResolution {
  return {
    project: "/managed/projects/book",
    configuration_variant: null,
    reused_setup: false,
    inspection,
    request: {
      ...initialRequest(inspection.source),
      language: "en-US",
      chapters: "all",
      output,
      engine: "backend-default",
      target: "backend-target",
      voice: "backend-voice",
      spacy: "lg",
      pause_timing: "natural"
    },
    origins: { explicit: [], project: [], derived: ["language", "chapters"] }
  };
}

function preflightResponse(
  request: components["schemas"]["AudiobookRequestModel"],
  executable: boolean,
  blockers: components["schemas"]["WorkflowBlockerResponseModel"][] = []
): PreflightResponse {
  return {
    project: "/managed/projects/book",
    configuration_variant: null,
    reused_setup: false,
    spacy_model: null,
    request,
    workflow: {
      source: request.source,
      workspace: null,
      workspace_mode: "managed",
      output: request.output || "/managed/output/book.m4b",
      steps: [
        {
          stage: "export",
          package: "audioexport",
          action: "run",
          selector: null,
          reason: "Prepare audiobook output",
          state: executable ? "ready" : "blocked",
          reason_code: executable ? "ready" : "blocked",
          force: false,
          blockers
        }
      ],
      warnings: ["Backend warning"],
      executable,
      variant: null
    }
  };
}

function uploadSource(): SelectedSource {
  return { kind: "upload", imported };
}

describe("conversion setup state", () => {
  it("retains imported source identity, path, and inspection", () => {
    const selected = uploadSource();
    expect(sourceIdentity(selected)).toBe(imported.source_id);
    expect(sourcePath(selected)).toBe(imported.path);
    expect(sourceInspection(selected)).toBe(imported.inspection);
  });

  it("keeps backend output implicit until the user changes it", () => {
    const state = setupFromResolution(setupResolution());
    expect(state.fields.output.value).toBe("/managed/output/book.m4b");

    const submission = submissionFromSetup(state);
    expect(submission.request).not.toHaveProperty("output");
    expect(submission.explicit_fields).toEqual([]);

    const edited = setSetupField(state, "output", "/chosen/book.m4b");
    const explicitSubmission = submissionFromSetup(edited);
    expect(explicitSubmission.request.output).toBe("/chosen/book.m4b");
    expect(explicitSubmission.explicit_fields).toContain("output");
  });



  it("passes a user-selected output and its provenance into preflight", async () => {
    const state = setupFromResolution(setupResolution());
    const edited = setSetupField(state, "output", "/chosen/book.m4b");
    const received: string[] = [];
    const review = await prepareConversion(
      submissionFromSetup(edited),
      async (submission) => {
        const resolved = setupResolution();
        return {
          ...resolved,
          request: { ...resolved.request, output: submission.request.output }
        };
      },
      async (submission) => {
        received.push(submission.request.output || "");
        expect(submission.explicit_fields).toContain("output");
        return preflightResponse(submission.request, true);
      }
    );

    expect(received).toEqual(["/chosen/book.m4b"]);
    expect(review.explicitFields).toContain("output");
  });
  it("tracks only user-touched fields and preserves them through resolution", () => {
    const state = setupFromResolution(setupResolution());
    const edited = setSetupField(state, "language", "de-DE");
    expect(submissionFromSetup(edited).explicit_fields).toEqual(["language"]);

    const resolved = setupResolution("/new/backend/default.m4b");
    resolved.request.language = "fr-FR";
    const merged = applyResolution(edited, resolved);
    expect(merged.fields.language.value).toBe("de-DE");
    expect(merged.fields.language.origin).toBe("user");
    expect(merged.fields.output.value).toBe("/new/backend/default.m4b");
  });

  it("discards stale catalog requests and aborts their signals", () => {
    const requests = new LatestRequest();
    const first = requests.begin();
    const second = requests.begin();

    expect(first.signal.aborted).toBe(true);
    expect(requests.isCurrent(first.generation)).toBe(false);
    expect(requests.isCurrent(second.generation)).toBe(true);
  });

  it("runs setup resolution before preflight and leaves an untouched output implicit", async () => {
    const state = setupFromResolution(setupResolution());
    const submission = submissionFromSetup(state);
    const calls: string[] = [];
    const resolve = vi.fn(async () => {
      calls.push("resolve");
      return setupResolution();
    });
    const preflight = vi.fn(async (value: { request: components["schemas"]["AudiobookRequestModel"] }) => {
      calls.push("preflight");
      expect(value.request).not.toHaveProperty("output");
      return preflightResponse(setupResolution().request, true);
    });

    const review = await prepareConversion(submission, resolve, preflight);

    expect(calls).toEqual(["resolve", "preflight"]);
    expect(review.preflight.workflow.warnings).toEqual(["Backend warning"]);
  });

  it("surfaces output blockers and never submits before confirmation", async () => {
    const conflict = {
      code: "output_exists",
      message: "Output already exists.",
      owner: "audioexport",
      recoverable: true,
      suggested_action: "Choose another output or replace it."
    };
    const response = preflightResponse(initialRequest(inspection.source), false, [conflict]);
    const review = await prepareConversion(
      { request: initialRequest(inspection.source), explicit_fields: [] },
      async () => setupResolution(),
      async () => response
    );

    expect(hasOutputConflict(review)).toBe(true);
    expect(workflowBlockers(review.preflight)).toEqual([
      { stage: "export", blocker: conflict }
    ]);
    const createJob = vi.fn<CreateJob>(async () => mockCreateJob());

    expect(await submitReviewedConversion(review, true, createJob)).toBeNull();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("requires confirmation and submits an executable review at most once", async () => {
    const request = initialRequest(inspection.source);
    const review = await prepareConversion(
      { request, explicit_fields: ["language"] },
      async () => setupResolution(),
      async () => preflightResponse(setupResolution().request, true)
    );
    const createJob = vi.fn<CreateJob>(async () => mockCreateJob());

    expect(await submitReviewedConversion(review, false, createJob)).toBeNull();
    expect(createJob).not.toHaveBeenCalled();
    expect(await submitReviewedConversion(review, true, createJob)).not.toBeNull();
    expect(await submitReviewedConversion(review, true, createJob)).toBeNull();
    expect(createJob).toHaveBeenCalledOnce();
    expect(createJob.mock.calls[0][1]).toEqual(["language"]);
  });

  it("keeps output replacement as an explicit user-selected request flag", () => {
    const state = setupFromResolution(setupResolution());
    const replaced = setReplaceOutput(state, true);
    expect(replaced.request.replace_output).toBe(true);
    expect(submissionFromSetup(replaced).explicit_fields).toEqual([]);
  });
});
