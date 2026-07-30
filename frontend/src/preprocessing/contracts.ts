/**
 * Future preprocessing boundary only. Stage 1B deliberately provides no
 * parser, merger, normalizer, file reader, database, or writer.
 */
export type PreprocessingPhase =
  | "startup"
  | "source-validation"
  | "normalization"
  | "promotion";

export type PreprocessingFailureCode =
  | "PREPROCESSOR_NOT_IMPLEMENTED"
  | "PREPROCESSOR_UNAVAILABLE";

export interface PreprocessingDiagnostic {
  readonly phase: PreprocessingPhase;
  readonly code: PreprocessingFailureCode;
}

export interface PreprocessingPort {
  readonly availability: "contract-only";
  preprocess(): Promise<never>;
}
