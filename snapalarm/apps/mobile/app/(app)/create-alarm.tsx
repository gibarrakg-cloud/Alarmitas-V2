import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Alert, Image, Platform,
} from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/api/client';
import type { HumorLevel, AlarmMode } from '@snapalarm/shared-types';

const HUMOR_LEVELS: { level: HumorLevel; label: string; description: string; color: string }[] = [
  { level: 1, label: 'Clean',      description: 'Warm & encouraging',     color: '#22c55e' },
  { level: 2, label: 'Ironic',     description: 'Dry wit & wordplay',     color: '#3b82f6' },
  { level: 3, label: 'Sarcastic',  description: 'Sharp & bold',           color: '#f59e0b' },
  { level: 4, label: 'Dark',       description: 'No filter comedy',       color: '#ef4444' },
];

export default function CreateAlarmScreen() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [humor_level, setHumorLevel] = useState<HumorLevel>(1);
  const [mode, setMode] = useState<AlarmMode>('IMAGE_ONLY');
  const [image_uri, setImageUri] = useState<string | null>(null);
  const [image_base64, setImageBase64] = useState<string | null>(null);
  const [fire_date, setFireDate] = useState('');
  const [fire_time, setFireTime] = useState('');

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!image_base64) throw new Error('Please select a photo');

      // Combine date + time and convert to UTC ISO string
      const local_dt = new Date(`${fire_date}T${fire_time}:00`);
      if (isNaN(local_dt.getTime())) throw new Error('Invalid date or time');

      await api.post('/alarms', {
        title,
        reason,
        humor_level,
        fire_time_utc: local_dt.toISOString(),
        timezone_source: Intl.DateTimeFormat().resolvedOptions().timeZone,
        mode,
        original_image_base64: image_base64,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alarms'] });
      Alert.alert('Alarm created!', 'Your alarm is being prepared. We\'ll generate the image before it fires.');
      router.back();
    },
    onError: (err: any) => {
      Alert.alert('Error', err.response?.data?.error ?? err.message ?? 'Failed to create alarm');
    },
  });

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access in Settings.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setImageBase64(result.assets[0].base64 ?? null);
    }
  };

  const isValid = title.length > 0 && reason.length > 0 && image_base64 && fire_date && fire_time;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.section_label}>Photo</Text>
      <TouchableOpacity style={styles.image_picker} onPress={pickImage}>
        {image_uri
          ? <Image source={{ uri: image_uri }} style={styles.preview_image} />
          : <Text style={styles.image_placeholder}>Tap to select photo</Text>
        }
      </TouchableOpacity>

      <Text style={styles.section_label}>Alarm title</Text>
      <TextInput
        style={styles.input} placeholder="e.g. Go to the gym" placeholderTextColor="#555"
        value={title} onChangeText={setTitle} maxLength={200}
      />

      <Text style={styles.section_label}>Reason</Text>
      <TextInput
        style={[styles.input, styles.input_multiline]} placeholder="Why is this alarm important?"
        placeholderTextColor="#555" value={reason} onChangeText={setReason}
        multiline numberOfLines={3} maxLength={500}
      />

      <Text style={styles.section_label}>Date (YYYY-MM-DD)</Text>
      <TextInput
        style={styles.input} placeholder="2024-12-25" placeholderTextColor="#555"
        value={fire_date} onChangeText={setFireDate} keyboardType="numeric"
      />

      <Text style={styles.section_label}>Time (HH:MM)</Text>
      <TextInput
        style={styles.input} placeholder="07:00" placeholderTextColor="#555"
        value={fire_time} onChangeText={setFireTime} keyboardType="numeric"
      />

      <Text style={styles.section_label}>Humor level</Text>
      <View style={styles.humor_grid}>
        {HUMOR_LEVELS.map(({ level, label, description, color }) => (
          <TouchableOpacity
            key={level}
            style={[styles.humor_card, humor_level === level && { borderColor: color, borderWidth: 2 }]}
            onPress={() => setHumorLevel(level)}
          >
            <Text style={[styles.humor_label, { color }]}>{label}</Text>
            <Text style={styles.humor_desc}>{description}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.section_label}>Mode</Text>
      <View style={styles.mode_row}>
        {(['IMAGE_ONLY', 'IMAGE_WITH_AUDIO'] as AlarmMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.mode_btn, mode === m && styles.mode_btn_active]}
            onPress={() => setMode(m)}
          >
            <Text style={[styles.mode_text, mode === m && styles.mode_text_active]}>
              {m === 'IMAGE_ONLY' ? 'Image only' : 'Image + Voice'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.create_btn, !isValid && styles.create_btn_disabled]}
        onPress={() => createMutation.mutate()}
        disabled={!isValid || createMutation.isPending}
      >
        <Text style={styles.create_btn_text}>
          {createMutation.isPending ? 'Creating...' : 'Create Alarm'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  content: { padding: 20, paddingBottom: 60 },
  section_label: { color: '#888', fontSize: 12, fontWeight: '600', marginBottom: 8, marginTop: 20, textTransform: 'uppercase', letterSpacing: 1 },
  input: { backgroundColor: '#1a1a1a', color: '#fff', padding: 14, borderRadius: 12, fontSize: 15, borderWidth: 1, borderColor: '#2a2a2a' },
  input_multiline: { height: 90, textAlignVertical: 'top' },
  image_picker: { backgroundColor: '#1a1a1a', borderRadius: 16, height: 180, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a2a2a', overflow: 'hidden' },
  image_placeholder: { color: '#555', fontSize: 15 },
  preview_image: { width: '100%', height: '100%', resizeMode: 'cover' },
  humor_grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  humor_card: { flex: 1, minWidth: '45%', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2a2a2a' },
  humor_label: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  humor_desc: { color: '#555', fontSize: 12 },
  mode_row: { flexDirection: 'row', gap: 10 },
  mode_btn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#1a1a1a', alignItems: 'center', borderWidth: 1, borderColor: '#2a2a2a' },
  mode_btn_active: { borderColor: '#f4511e', backgroundColor: '#2a1010' },
  mode_text: { color: '#555', fontWeight: '600' },
  mode_text_active: { color: '#f4511e' },
  create_btn: { backgroundColor: '#f4511e', padding: 18, borderRadius: 14, alignItems: 'center', marginTop: 32 },
  create_btn_disabled: { opacity: 0.4 },
  create_btn_text: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
