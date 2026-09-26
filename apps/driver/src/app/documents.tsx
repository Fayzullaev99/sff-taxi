import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { driver } from '../api/driver';
import type { DriverDocument } from '../api/types';
import { keys, useDriverMe } from '../data/queries';
import { errorMessage } from '../lib/api-client';
import { DOCUMENTS, isPhotoUrl, parseDate, showDate, tashkentToday } from '../lib/application';
import { dateTime } from '../lib/format';
import { Banner, Button, Card, Chip, Field, Loading, Muted } from '../ui/components';
import { haptics } from '../ui/haptics';
import { Screen } from '../ui/screen';
import { colors, space } from '../ui/theme';

/**
 * Document photos the operator checks before approval.
 *
 * TODO(api-uploads): the API has no upload endpoint yet (architecture §11: "upload to S3
 * like SFF Eats' uploads module is the next API task"). Until then the driver pastes a
 * link to the photo (e.g. sent to the office's Telegram and copied). Once the endpoint
 * exists: pick/take the photo with expo-image-picker (camera, quality 0.6, max 1600 px),
 * PUT it to the presigned URL, then send the stored URL with the same
 * `PUT /v1/driver/documents/:kind` call as here.
 */
export default function Documents() {
  const router = useRouter();
  const me = useDriverMe();
  if (!me.data) return <Loading />;
  const have = new Map(me.data.documents.map((d) => [d.kind, d]));
  const missing = me.data.missingDocuments.length;

  return (
    <Screen
      keyboard
      title="Hujjatlar"
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      footer={
        me.data.status !== 'active' ? (
          <Button
            title={missing ? `Yana ${missing} ta hujjat kerak` : 'Tayyor — ariza holatini ko‘rish'}
            icon={missing ? 'document-attach' : 'checkmark'}
            big
            disabled={missing > 0}
            onPress={() => router.replace('/status')}
          />
        ) : null
      }
    >
      <Banner
        tone="warning"
        icon="construct"
        title="Rasm yuklash tez orada"
        text="Hozircha rasm havolasini (URL) kiriting yoki hujjatlarni ofisga olib keling — operator o‘zi yuklaydi."
      />
      {DOCUMENTS.map((doc) => (
        <DocumentCard key={doc.kind} doc={doc} current={have.get(doc.kind) ?? null} />
      ))}
    </Screen>
  );
}

function DocumentCard(props: { doc: (typeof DOCUMENTS)[number]; current: DriverDocument | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(!props.current);
  const [url, setUrl] = useState(props.current?.url ?? '');
  const [expires, setExpires] = useState(showDate(props.current?.expiresOn));
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const expiresOn = props.doc.expires && expires.trim() ? parseDate(expires) : null;
      return driver.setDocument(props.doc.kind, url.trim(), expiresOn);
    },
    onSuccess: (next) => {
      haptics.success();
      qc.setQueryData(keys.me, next);
      setOpen(false);
    },
    onError: () => haptics.error(),
  });

  const submit = () => {
    if (!isPhotoUrl(url)) return setProblem('Rasm havolasi https:// bilan boshlanishi kerak');
    if (props.doc.expires && expires.trim()) {
      const d = parseDate(expires);
      if (!d) return setProblem('Muddatni KK.OO.YYYY ko‘rinishida yozing');
      if (d < tashkentToday()) return setProblem('Hujjat muddati o‘tgan');
    }
    setProblem(null);
    save.mutate();
  };

  return (
    <Card>
      <View style={styles.head}>
        <Ionicons
          name={props.current ? 'checkmark-circle' : 'ellipse-outline'}
          size={28}
          color={props.current ? colors.success : colors.muted}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{props.doc.label}</Text>
          <Muted>{props.doc.hint}</Muted>
        </View>
        {props.current ? (
          <Chip label="Yuklangan" tone="success" />
        ) : (
          <Chip label="Kerak" tone="warning" />
        )}
      </View>
      {props.current && !open ? (
        <>
          <Muted>
            {dateTime(props.current.uploadedAt)}
            {props.current.expiresOn ? ` · muddati ${showDate(props.current.expiresOn)} gacha` : ''}
          </Muted>
          <Button
            title="Almashtirish"
            icon="swap-horizontal"
            variant="secondary"
            onPress={() => setOpen(true)}
          />
        </>
      ) : (
        <View style={{ gap: space.sm }}>
          <Field
            label="Rasm havolasi (URL)"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://…"
          />
          {props.doc.expires ? (
            <Field
              label="Amal qilish muddati (ixtiyoriy)"
              value={expires}
              onChangeText={setExpires}
              keyboardType="numbers-and-punctuation"
              placeholder="KK.OO.YYYY"
              maxLength={10}
            />
          ) : null}
          {problem || save.error ? (
            <Text style={styles.error}>{problem ?? errorMessage(save.error)}</Text>
          ) : null}
          <Button title="Saqlash" icon="save" loading={save.isPending} onPress={submit} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { fontSize: 17, fontWeight: '800', color: colors.text },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' },
});
