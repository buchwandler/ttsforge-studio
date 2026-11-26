import type { BookInspection, SourceImport } from "../types";

export type SelectedSource =
  | { kind: "desktop-path"; path: string; inspection: BookInspection }
  | { kind: "upload"; imported: SourceImport };

export function sourcePath(source: SelectedSource): string {
  return source.kind === "upload" ? source.imported.path : source.path;
}

export function sourceInspection(source: SelectedSource): BookInspection {
  return source.kind === "upload" ? source.imported.inspection : source.inspection;
}

export function sourceIdentity(source: SelectedSource): string {
  return source.kind === "upload" ? source.imported.source_id : source.path;
}
