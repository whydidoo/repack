import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';
import { createElement } from 'react';
import { RscPanel } from './RscPanel';
import { teamPropsSchema } from './schemas';

export const TeamRoot = defineRscRoot({
  pending: 'retain',
  props: teamPropsSchema,
  reloadOn: ['teamId'],
  render({ context, props }) {
    return createElement(RscPanel, {
      release: process.env.REPACK_RSC_RELEASE ?? 'development',
      requestId: context.requestId,
      teamId: props.teamId,
    });
  },
});
