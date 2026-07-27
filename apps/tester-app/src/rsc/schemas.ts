import type { RscStandardSchemaV1 } from '@callstack/repack-plugin-rsc/server';

export interface TeamProps {
  readonly teamId: string;
}

export const teamPropsSchema: RscStandardSchemaV1<unknown, TeamProps> = {
  '~standard': {
    validate(value) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'teamId' in value &&
        typeof value.teamId === 'string' &&
        value.teamId.length > 0
      ) {
        return { value: { teamId: value.teamId } };
      }
      return {
        issues: [
          { message: 'teamId must be a non-empty string', path: ['teamId'] },
        ],
      };
    },
    vendor: 'tester-app',
    version: 1,
  },
};

export const checkMeSchema: RscStandardSchemaV1<
  unknown,
  { readonly message: string }
> = {
  '~standard': {
    validate(value) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'message' in value &&
        typeof value.message === 'string'
      ) {
        return { value: { message: value.message } };
      }
      return {
        issues: [{ message: 'message must be a string', path: ['message'] }],
      };
    },
    vendor: 'tester-app',
    version: 1,
  },
};
