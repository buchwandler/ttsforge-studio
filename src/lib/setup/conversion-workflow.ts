import type { PreflightResponse, SetupResolution, JobSubmission, JobStatus } from "../types";

export type ResolveSetup = (
  submission: JobSubmission,
  signal?: AbortSignal
) => Promise<SetupResolution>;
export type Preflight = (
  submission: JobSubmission,
  signal?: AbortSignal
) => Promise<PreflightResponse>;
export type CreateJob = (
  request: PreflightResponse["request"],
  explicitFields: string[],
  signal?: AbortSignal
) => Promise<JobStatus>;

export interface ConversionReview {
  resolution: SetupResolution;
  preflight: PreflightResponse;
  explicitFields: string[];
  submitted: boolean;
}

export async function prepareConversion(
  submission: JobSubmission,
  resolve: ResolveSetup,
  preflight: Preflight,
  signal?: AbortSignal
): Promise<ConversionReview> {
  const resolution = await resolve(submission, signal);
  const request = { ...resolution.request };
  const explicitFields = [...(submission.explicit_fields || [])];
  if (!explicitFields.includes("output")) delete request.output;

  const checked = await preflight(
    { request, explicit_fields: explicitFields },
    signal
  );
  return {
    resolution,
    preflight: checked,
    explicitFields,
    submitted: false
  };
}

export function workflowBlockers(preflight: PreflightResponse) {
  return preflight.workflow.steps.flatMap((step) =>
    step.blockers.map((blocker) => ({ stage: step.stage, blocker }))
  );
}

export function hasOutputConflict(review: ConversionReview): boolean {
  return workflowBlockers(review.preflight).some(
    ({ blocker }) => blocker.code === "output_exists"
  );
}

export async function submitReviewedConversion(
  review: ConversionReview,
  confirmed: boolean,
  createJob: CreateJob,
  signal?: AbortSignal
): Promise<JobStatus | null> {
  if (!confirmed || review.submitted || !review.preflight.workflow.executable) return null;

  review.submitted = true;
  try {
    return await createJob(review.preflight.request, review.explicitFields, signal);
  } catch (error) {
    review.submitted = false;
    throw error;
  }
}
