import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/api/client';
import type { AlarmResponse } from '@snapalarm/shared-types';

export default function AlarmsScreen() {
  const { data: alarms, isLoading, refetch, isRefetching } = useQuery<AlarmResponse[]>({
    queryKey: ['alarms'],
    queryFn: async () => {
      const { data } = await api.get('/alarms');
      return data;
    },
  });

  const renderAlarm = ({ item }: { item: AlarmResponse }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push({ pathname: '/(app)/alarm-detail', params: { id: item.id } })}
    >
      <View style={styles.card_header}>
        <Text style={styles.alarm_title} numberOfLines={1}>{item.title}</Text>
        <StatusBadge status={item.generation_status} />
      </View>
      <Text style={styles.alarm_time}>
        {new Date(item.fire_time_utc).toLocaleString()}
      </Text>
      <Text style={styles.alarm_reason} numberOfLines={1}>{item.reason}</Text>
      <HumorBadge level={item.humor_level} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={alarms ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderAlarm}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#f4511e" />}
        ListEmptyComponent={
          isLoading
            ? <Text style={styles.empty}>Loading...</Text>
            : <Text style={styles.empty}>No alarms yet. Create your first one!</Text>
        }
      />
      <TouchableOpacity style={styles.fab} onPress={() => router.push('/(app)/create-alarm')}>
        <Text style={styles.fab_text}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    COMPLETED: '#22c55e', FALLBACK: '#f59e0b', FAILED: '#ef4444',
    GENERATING: '#3b82f6', QUEUED_FOR_BATCH: '#8b5cf6', PENDING: '#6b7280',
  };
  return (
    <View style={[styles.badge, { backgroundColor: colors[status] ?? '#6b7280' }]}>
      <Text style={styles.badge_text}>{status.replace(/_/g, ' ')}</Text>
    </View>
  );
}

function HumorBadge({ level }: { level: number }) {
  const labels = { 1: 'Clean', 2: 'Ironic', 3: 'Sarcastic', 4: 'Dark' };
  return (
    <Text style={styles.humor_label}>
      {labels[level as keyof typeof labels] ?? 'Unknown'} humor
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  list: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: '#2a2a2a',
  },
  card_header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  alarm_title: { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1, marginRight: 8 },
  alarm_time: { color: '#f4511e', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  alarm_reason: { color: '#888', fontSize: 13, marginBottom: 8 },
  humor_label: { color: '#555', fontSize: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badge_text: { color: '#fff', fontSize: 10, fontWeight: '700' },
  empty: { color: '#555', textAlign: 'center', marginTop: 80, fontSize: 16 },
  fab: {
    position: 'absolute', bottom: 32, right: 24,
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#f4511e', alignItems: 'center', justifyContent: 'center',
    elevation: 8, shadowColor: '#f4511e', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8,
  },
  fab_text: { color: '#fff', fontSize: 32, lineHeight: 36, fontWeight: '300' },
});
