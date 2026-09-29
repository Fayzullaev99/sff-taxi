import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { DriverRide } from '../api/types';
import { formatPhone } from '../lib/format';
import { cargoLines, parcelLines, SERVICE_LABELS, serviceOf, showRecipient } from '../lib/service';
import { call } from '../ui/actions';
import { Button, Card, Muted, Title } from '../ui/components';
import { colors, space } from '../ui/theme';

/**
 * Cargo: the class, loaders, weight, the load and whether the customer rides along.
 * Delivery: the parcel, and once it is on its way the recipient with a call button (the
 * sender is not in the car). Nothing for a taxi ride.
 */
export const ServiceCard = memo(function ServiceCard(props: { ride: DriverRide }) {
  const { ride } = props;
  const service = serviceOf(ride);
  if (service === 'taxi') return null;
  const lines =
    service === 'cargo' ? cargoLines(ride.cargo, ride.class) : parcelLines(ride.delivery?.parcel);
  const recipient = showRecipient(ride) ? ride.delivery : null;
  return (
    <Card style={{ borderColor: colors.info, borderWidth: 2 }}>
      <View style={styles.head}>
        <Ionicons name={service === 'cargo' ? 'cube' : 'mail'} size={24} color={colors.info} />
        <Title>{SERVICE_LABELS[service]}</Title>
      </View>
      {lines.map((l) => (
        <Text key={l} style={styles.line}>
          {l}
        </Text>
      ))}
      {recipient ? (
        <View style={styles.recipient}>
          <View style={{ flex: 1 }}>
            <Muted>Qabul qiluvchi</Muted>
            <Text style={styles.name}>{recipient.recipientName ?? 'Qabul qiluvchi'}</Text>
            {recipient.recipientPhone ? (
              <Muted>{formatPhone(recipient.recipientPhone)}</Muted>
            ) : null}
          </View>
          {recipient.recipientPhone ? (
            <Button title="Qo‘ng‘iroq" icon="call" onPress={() => call(recipient.recipientPhone)} />
          ) : null}
        </View>
      ) : service === 'delivery' ? (
        <Muted>Qabul qiluvchi posilkani olganingizdan keyin ko‘rinadi.</Muted>
      ) : null}
    </Card>
  );
});

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  line: { color: colors.text, fontSize: 17, fontWeight: '700' },
  recipient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flexWrap: 'wrap',
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  name: { color: colors.text, fontSize: 19, fontWeight: '800' },
});
