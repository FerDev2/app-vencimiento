import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { recognizeText } from 'expo-ocr-kit';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  daysUntil,
  expirationStatus,
  extractExpirationDates,
  formatIsoDate,
  inputToIso,
  isoToInput,
  pickExpirationDate,
  type ExpirationCandidate,
} from '@/lib/parse-expiration';
import {
  deleteVencimiento,
  insertVencimiento,
  listVencimientos,
  type Vencimiento,
} from '@/lib/vencimientos-db';

type Draft = {
  uri: string;
  text: string;
  fecha: string;
  nombre: string;
  candidates: ExpirationCandidate[];
};

const ACCENT = '#208AEF';

export default function VencimientosScreen() {
  const db = useSQLiteContext();
  const [items, setItems] = useState<Vencimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const [recognizing, setRecognizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setItems(await listVencimientos(db));
  }, [db]);

  useEffect(() => {
    let active = true;
    listVencimientos(db)
      .then((rows) => {
        if (active) setItems(rows);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [db]);

  async function takePhoto() {
    if (Platform.OS === 'web') {
      Alert.alert(
        'Cámara no disponible',
        'Para leer una fecha de vencimiento, abre la app en un iPhone o Android.',
      );
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permiso necesario',
        'Necesitamos la cámara para fotografiar la fecha de vencimiento.',
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.85,
    });
    if (result.canceled) return;

    const uri = result.assets[0]?.uri;
    if (!uri) return;

    setRecognizing(true);
    setFormError(null);
    try {
      const ocr = await recognizeText(uri);
      const lines = ocr.blocks
        .map((block) => block.text.trim())
        .filter((line) => line.length > 0);
      const text = [ocr.text.trim(), lines.join('\n')].filter((part) => part.length > 0).join('\n');
      const candidates = extractExpirationDates(text);
      const picked = pickExpirationDate(text, candidates);
      setDraft({
        uri,
        text,
        fecha: picked ? isoToInput(picked.iso) : '',
        nombre: '',
        candidates,
      });
    } catch (error) {
      Alert.alert('No se pudo leer la foto', ocrErrorMessage(error));
    } finally {
      setRecognizing(false);
    }
  }

  async function saveDraft() {
    if (!draft || saving) return;
    const nombre = draft.nombre.trim();
    const fecha = inputToIso(draft.fecha);
    if (!nombre) {
      setFormError('Escribe el nombre del producto.');
      return;
    }
    if (!fecha) {
      setFormError('Escribe la fecha como día/mes/año. Por ejemplo, 20/10/2026.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await insertVencimiento(db, {
        nombre,
        fecha,
        textoOcr: draft.text || null,
      });
      setDraft(null);
      await reload();
    } catch {
      setFormError('No se pudo guardar el vencimiento.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(item: Vencimiento) {
    Alert.alert('Eliminar vencimiento', `¿Quitamos "${item.nombre}" de la lista?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          void deleteVencimiento(db, item.id).then(reload);
        },
      },
    ]);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {draft ? (
          <ReviewForm
            draft={draft}
            saving={saving}
            error={formError}
            onChangeFecha={(fecha) => setDraft({ ...draft, fecha })}
            onChangeNombre={(nombre) => setDraft({ ...draft, nombre })}
            onSave={() => {
              void saveDraft();
            }}
            onCancel={() => {
              setDraft(null);
              setFormError(null);
            }}
          />
        ) : (
          <View style={styles.listScreen}>
            <View style={styles.header}>
              <ThemedText type="subtitle">Vencimientos</ThemedText>
              <ThemedText themeColor="textSecondary">
                Acerca la fecha hasta que ocupe la foto. Así se lee con más precisión.
              </ThemedText>
            </View>

            {loading ? (
              <ActivityIndicator color={ACCENT} style={styles.loader} />
            ) : (
              <FlatList
                data={items}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                  <ThemedView type="backgroundElement" style={styles.emptyCard}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Todavía no hay vencimientos. Toma una foto de la fecha del producto para
                      agregarlo.
                    </ThemedText>
                  </ThemedView>
                }
                renderItem={({ item }) => (
                  <VencimientoCard item={item} onDelete={() => confirmDelete(item)} />
                )}
              />
            )}

            <View style={styles.footer}>
              {Platform.OS === 'web' ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.webNote}>
                  La lectura de la foto funciona en iPhone y Android.
                </ThemedText>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={recognizing}
                onPress={() => {
                  void takePhoto();
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (pressed || recognizing) && styles.pressed,
                ]}>
                {recognizing ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText style={styles.primaryButtonText}>Tomar foto</ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function VencimientoCard({ item, onDelete }: { item: Vencimiento; onDelete: () => void }) {
  const days = daysUntil(item.fecha);
  const statusColor = days < 0 ? '#E5484D' : days <= 7 ? '#F5A524' : '#30A46C';

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.cardHeader}>
        <ThemedText style={styles.cardTitle}>{item.nombre}</ThemedText>
        <ThemedText type="smallBold" style={{ color: statusColor }}>
          {expirationStatus(item.fecha)}
        </ThemedText>
      </View>
      <ThemedText themeColor="textSecondary">{formatIsoDate(item.fecha)}</ThemedText>
      <Pressable accessibilityRole="button" onPress={onDelete} style={styles.deleteButton}>
        <ThemedText type="small" style={styles.deleteText}>
          Eliminar
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

function ReviewForm({
  draft,
  saving,
  error,
  onChangeFecha,
  onChangeNombre,
  onSave,
  onCancel,
}: {
  draft: Draft;
  saving: boolean;
  error: string | null;
  onChangeFecha: (value: string) => void;
  onChangeNombre: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const selectedIso = inputToIso(draft.fecha);

  return (
    <KeyboardAvoidingView
      style={styles.review}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.reviewContent}
        keyboardShouldPersistTaps="handled">
        <ThemedText type="subtitle">Revisa la fecha</ThemedText>
        <Image source={{ uri: draft.uri }} style={styles.preview} contentFit="cover" />

        {draft.candidates.length > 0 ? (
          <View style={styles.candidateList}>
            {draft.candidates.map((candidate) => {
              const selected = candidate.iso === selectedIso;
              return (
                <Pressable
                  key={candidate.iso}
                  accessibilityRole="button"
                  onPress={() => onChangeFecha(isoToInput(candidate.iso))}
                  style={[
                    styles.candidate,
                    { backgroundColor: selected ? ACCENT : theme.backgroundElement },
                  ]}>
                  <ThemedText type="small" style={selected ? styles.candidateSelected : undefined}>
                    {formatIsoDate(candidate.iso)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            No encontré una fecha en la foto. Escríbela manualmente.
          </ThemedText>
        )}

        <Field label="Fecha">
          <TextInput
            value={draft.fecha}
            onChangeText={onChangeFecha}
            placeholder="20/10/2026"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
        </Field>

        <Field label="Producto">
          <TextInput
            value={draft.nombre}
            onChangeText={onChangeNombre}
            placeholder="Leche, yogurt, medicina..."
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
        </Field>

        {draft.text ? (
          <ThemedText type="small" themeColor="textSecondary">
            Texto leído: {draft.text}
          </ThemedText>
        ) : null}

        {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={onSave}
          style={({ pressed }) => [styles.primaryButton, (pressed || saving) && styles.pressed]}>
          {saving ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <ThemedText style={styles.primaryButtonText}>Guardar en la lista</ThemedText>
          )}
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.secondaryButton}>
          <ThemedText>Cancelar</ThemedText>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      {children}
    </View>
  );
}

function ocrErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/native module|ExpoOcrKit|only available/i.test(message)) {
    return 'El OCR necesita un development build nuevo. Expo Go no incluye este módulo. Genera la app con npx expo run:ios o npx expo run:android.';
  }
  return message || 'Inténtalo de nuevo con la fecha más cerca y con buena luz.';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
  },
  listScreen: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingBottom: Spacing.three,
  },
  header: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  loader: {
    marginTop: Spacing.five,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    flexGrow: 1,
  },
  emptyCard: {
    borderRadius: Spacing.three,
    padding: Spacing.four,
  },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  cardTitle: {
    flex: 1,
    fontSize: 18,
    lineHeight: 24,
  },
  deleteButton: {
    alignSelf: 'flex-start',
    marginTop: Spacing.one,
  },
  deleteText: {
    color: '#E5484D',
  },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  webNote: {
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: ACCENT,
    borderRadius: Spacing.three,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: 700,
  },
  pressed: {
    opacity: 0.75,
  },
  review: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  reviewContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  preview: {
    width: '100%',
    height: 180,
    borderRadius: Spacing.three,
    backgroundColor: '#E7E8EC',
  },
  candidateList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  candidate: {
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  candidateSelected: {
    color: '#ffffff',
  },
  field: {
    gap: Spacing.two,
  },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  errorText: {
    color: '#E5484D',
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
