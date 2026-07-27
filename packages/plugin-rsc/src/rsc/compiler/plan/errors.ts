export type RscPlanningErrorCode =
  | 'RSC_CLIENT_ARTIFACT_MISMATCH'
  | 'RSC_UNSUPPORTED_PLATFORM';

export class RscPlanningError extends Error {
  readonly code: RscPlanningErrorCode;

  constructor(code: RscPlanningErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'RscPlanningError';
    this.code = code;
  }
}
