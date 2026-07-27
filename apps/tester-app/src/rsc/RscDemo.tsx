import { Suspense, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { RscErrorBoundary } from './RscErrorBoundary';
import { TeamRoot } from './TeamRoot';
import {
  type RscRelease,
  getSelectedRscRelease,
  selectRscRelease,
} from './catalog';

export function RscDemo() {
  const [release, setRelease] = useState(getSelectedRscRelease);
  const [teamId, setTeamId] = useState('core');

  const select = (next: RscRelease) => {
    selectRscRelease(next);
    setRelease(next);
  };

  return (
    <View style={styles.container}>
      <Text>catalog target: {release}</Text>
      <View style={styles.controls}>
        <Button
          title="Release A / rollback"
          onPress={() => select('release-a')}
        />
        <Button
          title="Release B / update"
          onPress={() => select('release-b')}
        />
        <Button
          title="Version mismatch"
          onPress={() => select('incompatible')}
        />
        <Button
          title="Change teamId"
          onPress={() =>
            setTeamId((value) => (value === 'core' ? 'platform' : 'core'))
          }
        />
      </View>
      <RscErrorBoundary key={release}>
        <Suspense fallback={<Text>Loading Flight…</Text>}>
          <TeamRoot teamId={teamId} />
        </Suspense>
      </RscErrorBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  controls: { gap: 4 },
});
