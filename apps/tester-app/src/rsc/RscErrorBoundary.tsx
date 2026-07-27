import { isRscCompatibilityError } from '@callstack/repack-plugin-rsc/client';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly error?: Error;
}

export class RscErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Tester RSC boundary', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const message = isRscCompatibilityError(error)
      ? `Compatibility error: ${error.reason}, expected ${error.expected}, received ${error.received ?? 'missing'}`
      : `${error.name}: ${error.message}`;
    return (
      <View style={styles.error}>
        <Text>{message}</Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  error: { borderColor: '#c62828', borderWidth: 1, padding: 8 },
});
