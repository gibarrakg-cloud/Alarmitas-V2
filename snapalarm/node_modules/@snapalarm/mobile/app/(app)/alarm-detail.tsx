import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/api/client';
import type { AlarmResponse } from '@snapalarm/shared-types';

export default function AlarmDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: alarm, isLoading } = useQuery<AlarmResponse>({
    queryKey: ['alarm', id],
    queryFn: async () => {
      const { data } = await api.get(`/alarms/${id}`);
      return data;
    },
    refetchInterval: (query) => {
      // Poll every 10s if still generating
      const status = query.state.data?.generation_status;
      return status && !['COMPLETED', 'FAILED', 'FALLBACK', 'CANCELLED'].includes(status) ? 10_000 : false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/alarms/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alarms'] });
      router.back();
    },
    onError: () => Alert.alert('Error', 'Failed to delete alarm'),
  });

  const confirmDelete = () => {
    Alert.alert('Delete alarm', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate() },
    ]);
  };

  if (isLoading || !alarm) {
    return <View style={styles.container}><Text style={styles.loading}>Loading...</Text></View>;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {alarm.generated_image_url ? (
        <Image source={{ uri: alarm.generated_image_url }} style={styles.image} />
      ) : (
        <View style={styles.image_placeholder}>
          <Text style={styles.image_placeholder_text}>
            {['GENERATING', 'QUEUED_FOR_BATCH', 'BATCH_SUBMITTED', 'PENDING'].includes(alarm.generation_status)
              ? 'Generating your image...'
              : 'No image generated'}
          </Text>
        </View>
      )}

      {alarm.generated_text && (
        <View style={styles.generated_text_box}>
          <Text style={styles.generated_text}>{alarm.generated_text}</Text>
        </View>
      )}

      <View style={styles.details}>
        <Row label="Title" value={alarm.title} />
        <Row label="Reason" value={alarm.reason} />
        <Row label="Fire time" value={new Date(alarm.fire_time_utc).toLocaleString()} />
        <Row label="Status" value={alarm.generation_status.replace(/_/g, ' ')} />
        <Row label="Mode" value={alarm.mode === 'IMAGE_WITH_AUDIO' ? 'Image + Voice' : 'Image only'} />
      </View>

      <TouchableOpacity style={styles.delete_btn} onPress={confirmDelete}>
        <Text style={styles.delete_btn_text}>Delete Alarm</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.row_label}>{label}</Text>
      <Text style={styles.row_value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  content: { paddingBottom: 60 },
  loading: { color: '#888', textAlign: 'center', marginTop: 80 },
  image: { width: '100%', aspectRatio: 1, backgroundColor: '#1a1a1a' },
  image_placeholder: { width: '100%', aspectRatio: 1, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  image_placeholder_text: { color: '#555', fontSize: 16 },
  generated_text_box: { backgroundColor: 'rgba(0,0,0,0.7)', padding: 20, margin: 16, borderRadius: 12, borderLeftWidth: 3, borderLeftColor: '#f4511e' },
  generated_text: { color: '#fff', fontSize: 18, fontWeight: '600', fontStyle: 'italic', lineHeight: 28 },
  details: { padding: 20, gap: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  row_label: { color: '#666', fontSize: 14 },
  row_value: { color: '#fff', fontSize: 14, fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
  delete_btn: { margin: 20, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#ef4444', alignItems: 'center' },
  delete_btn_text: { color: '#ef4444', fontWeight: '700', fontSize: 15 },
});
