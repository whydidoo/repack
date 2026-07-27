import type { ComponentType } from 'react';
import { Appearance } from 'react-native';

// nativewind styles
import '../global.css';

import { AssetsTestContainer } from './assetsTest/AssetsTestContainer';
import { AsyncContainer } from './asyncChunks/AsyncContainer';
import { MiniAppsContainer } from './miniapp/MiniAppsContainer';
import { NativeWindView } from './nativewind/NativeWindView';
import { ReanimatedBox } from './reanimated/ReanimatedBox';
import { RemoteContainer } from './remoteChunks/RemoteContainer';
import { AppContainer } from './ui/AppContainer';
import { Section } from './ui/Section';
import { SectionContainer } from './ui/SectionContainer';

Appearance.setColorScheme('light');

const RscDemo = __REPACK_RSC_ENABLED__
  ? (require('./rsc/RscDemo').RscDemo as ComponentType)
  : undefined;

const App = () => {
  return (
    <AppContainer>
      <SectionContainer>
        <Section title="Async chunk">
          <AsyncContainer />
        </Section>
        <Section title="Remote chunks">
          <RemoteContainer />
        </Section>
        <Section title="Mini-apps">
          <MiniAppsContainer />
        </Section>
        <Section title="Assets test">
          <AssetsTestContainer />
        </Section>
        <Section title="Reanimated test">
          <ReanimatedBox />
        </Section>
        <Section title="NativeWind test">
          <NativeWindView />
        </Section>
        {RscDemo ? (
          <Section
            title="React Server Components"
            description="Rspack-only validation of independent server release updates and rollback."
          >
            <RscDemo />
          </Section>
        ) : null}
      </SectionContainer>
    </AppContainer>
  );
};

export default App;
