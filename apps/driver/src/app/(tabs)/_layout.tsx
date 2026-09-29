import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFeatures } from '../../data/queries';
import { colors } from '../../ui/theme';

/** The approved driver's tabs. The runtime (stream, GPS, offers) lives in the root layout. */
export default function DriverTabs() {
  const features = useFeatures();
  // a fixed height drops the bottom inset: the tabs sat under a three-button navigation bar
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 13, fontWeight: '800' },
        // the bar has a fixed height: huge system fonts would cut the labels off
        tabBarAllowFontScaling: false,
        tabBarStyle: {
          height: 68 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom + 6,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        sceneStyle: { backgroundColor: colors.background },
        // unvisited tabs are not rendered: less work on cheap phones
        lazy: true,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Liniya',
          tabBarIcon: ({ color, size }) => <Ionicons name="car-sport" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="money"
        options={{
          title: 'Daromad',
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="intercity"
        options={{
          title: 'Qatnov',
          // hidden while the operators have the intercity board switched off
          href: features.features.intercity ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="bus" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="priority"
        options={{
          title: 'Reyting',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="speedometer" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
