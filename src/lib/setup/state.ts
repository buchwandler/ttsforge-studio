import type { components } from "../api/generated";
import type { SetupResolution, JobSubmission } from "../types";

export type AudiobookRequest = components["schemas"]["AudiobookRequestModel"];

export const setupFieldNames = [
  "chapters",
  "output",
  "language",
  "engine",
  "target",
  "voice",
  "engine_options",
  "speed",
  "spacy",
  "speech_profile",
  "pause_timing",
  "bitrate",
  "target_lufs",
  "metadata",
  "title",
  "author",
  "cover"
] as const satisfies readonly (keyof AudiobookRequest)[];

export type SetupFieldName = (typeof setupFieldNames)[number];
export type FieldOrigin = "inspection" | "backend" | "saved-project" | "user";
export type SetupField<T> = { value: T; origin: FieldOrigin; touched: boolean };
export type SetupFields = {
  [Name in SetupFieldName]: SetupField<AudiobookRequest[Name]>;
};

export interface SetupState {
  project: string;
  request: AudiobookRequest;
  fields: SetupFields;
}

function fieldOrigin(name: SetupFieldName, resolution: SetupResolution): FieldOrigin {
  if (resolution.origins.explicit.includes(name)) return "user";
  if (resolution.origins.project.includes(name)) return "saved-project";
  if (resolution.origins.derived.includes(name)) return "inspection";
  return "backend";
}

export function initialRequest(source: string): AudiobookRequest {
  return {
    source,
    offline: false,
    refresh: false,
    replace_output: false,
    fresh: false,
    new_variant: false
  };
}

export function setupFromResolution(resolution: SetupResolution): SetupState {
  const fields = Object.fromEntries(
    setupFieldNames.map((name) => [
      name,
      {
        value: resolution.request[name],
        origin: fieldOrigin(name, resolution),
        touched: false
      }
    ])
  ) as SetupFields;
  return { project: resolution.project, request: { ...resolution.request }, fields };
}

export function applyResolution(
  current: SetupState,
  resolution: SetupResolution
): SetupState {
  const next = setupFromResolution(resolution);
  const request = { ...next.request } as AudiobookRequest;
  const fields = { ...next.fields } as SetupFields;

  for (const name of setupFieldNames) {
    const existing = current.fields[name];
    if (!existing.touched) continue;
    (request as Record<SetupFieldName, unknown>)[name] = existing.value;
    (fields as Record<SetupFieldName, SetupField<unknown>>)[name] = existing;
  }

  return { project: next.project, request, fields };
}

export function setSetupField<Name extends SetupFieldName>(
  state: SetupState,
  name: Name,
  value: AudiobookRequest[Name]
): SetupState {
  return {
    project: state.project,
    request: { ...state.request, [name]: value },
    fields: {
      ...state.fields,
      [name]: { value, origin: "user", touched: true }
    }
  } as SetupState;
}

export function resetSetupField<Name extends SetupFieldName>(
  state: SetupState,
  name: Name
): SetupState {
  const request = { ...state.request } as AudiobookRequest;
  delete (request as Record<SetupFieldName, unknown>)[name];
  return {
    project: state.project,
    request,
    fields: {
      ...state.fields,
      [name]: { value: undefined, origin: "backend", touched: false }
    }
  } as SetupState;
}

export function setReplaceOutput(state: SetupState, replace: boolean): SetupState {
  return {
    ...state,
    request: { ...state.request, replace_output: replace }
  };
}

export function submissionFromSetup(state: SetupState): JobSubmission {
  const request = { ...state.request };
  const explicitFields = setupFieldNames.filter((name) => state.fields[name].touched);
  if (!state.fields.output.touched) delete request.output;
  return {
    request,
    explicit_fields: explicitFields
  };
}
