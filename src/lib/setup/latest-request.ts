export interface RequestTicket {
  generation: number;
  signal: AbortSignal;
}

export class LatestRequest {
  private generation = 0;
  private controller: AbortController | null = null;

  begin(): RequestTicket {
    this.controller?.abort();
    this.controller = new AbortController();
    this.generation += 1;
    return { generation: this.generation, signal: this.controller.signal };
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    this.generation += 1;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
