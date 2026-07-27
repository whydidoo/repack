'use client';

import { useRscRefresh } from '@callstack/repack-plugin-rsc/client';
import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { checkMe } from './checkMe';

export function RscPanel(props: {
  readonly release: string;
  readonly requestId: string;
  readonly teamId: string;
}) {
  const refresh = useRscRefresh();
  const [actionResult, setActionResult] = useState('not called');
  const [pending, setPending] = useState(false);

  const run = async (work: () => Promise<void>) => {
    setPending(true);
    try {
      await work();
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text>team: {props.teamId}</Text>
      <Text>server release: {props.release}</Text>
      <Text>request: {props.requestId}</Text>
      <Text>checkMe: {actionResult}</Text>
      <Button
        disabled={pending}
        title="Explicit refresh"
        onPress={() => run(refresh)}
      />
      <Button
        disabled={pending}
        title="Call checkMe"
        onPress={() =>
          run(async () => {
            const result = await checkMe({ data: { message: props.teamId } });
            setActionResult(`${result.message}, ${result.requestId}`);
          })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6, paddingVertical: 8 },
});
