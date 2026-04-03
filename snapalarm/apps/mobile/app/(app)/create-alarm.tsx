import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Alert, Image, Platform,
} from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/api/client';
import type { HumorLevel, AlarmMode, ScheduleType, AlarmWeekday } from '@snapalarm/shared-types';

const HUMOR_LEVELS: { level: HumorLevel; label: string; description: string; color: string }[] = [
  { level: 1, label: 'Clean',      description: 'Warm & encouraging',     color: '#22c55e' },
  { level: 2, label: 'Ironic',     description: 'Dry wit & wordplay',     color: '#3b82f6' },
  { level: 3, label: 'Sarcastic',  description: 'Sharp & bold',           color: '#f59e0b' },
  { level: 4, label: 'Dark',       description: 'No filter comedy',       color: '#ef4444' },
];

const WEEKDAYS: { value: AlarmWeekday; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

function computeNextRepeatingOccurrenceLocal(repeatDays: AlarmWeekday[], timeSource: Date, now: Date = new Date()): Date {
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(timeSource.getHours(), timeSource.getMinutes(), 0, 0);

    if (!repeatDays.includes(candidate.getDay() as AlarmWeekday)) continue;
    if (candidate.getTime() > now.getTime()) return candidate;
  }

  throw new Error('Please choose at least one repeat day in the future');
}

export default function CreateAlarmScreen() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [humor_level, setHumorLevel] = useState<HumorLevel>(1);
  const [mode, setMode] = useState<AlarmMode>('IMAGE_ONLY');
  const [image_uri, setImageUri] = useState<string | null>(null);
  const [image_base64, setImageBase64] = useState<string | null>(null);
  const [scheduleType, setScheduleType] = useState<ScheduleType>('ONE_TIME');
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [repeatDays, setRepeatDays] = useState<AlarmWeekday[]>([1, 2, 3, 4, 5]);
  const [repeatTime, setRepeatTime] = useState<Date>(() => {
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    return nextHour;
  });
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!image_base64) throw new Error('Please select a photo');
      if (scheduleType === 'ONE_TIME') {
        if (!scheduledAt) throw new Error('Please choose a date and time');
        if (scheduledAt.getTime() <= Date.now()) throw new Error('Alarm time must be in the future');
      }

      if (scheduleType === 'REPEATING' && repeatDays.length === 0) {
        throw new Error('Please choose at least one repeat day');
      }

      const nextFireTime = scheduleType === 'REPEATING'
        ? computeNextRepeatingOccurrenceLocal(repeatDays, repeatTime)
        : scheduledAt!;

      await api.post('/alarms', {
        title,
        reason,
        humor_level,
        fire_time_utc: nextFireTime.toISOString(),
        timezone_source: Intl.DateTimeFormat().resolvedOptions().timeZone,
        mode,
        schedule_type: scheduleType,
        repeat_days: scheduleType === 'REPEATING' ? repeatDays : [],
        local_time: scheduleType === 'REPEATING'
          ? `${String(repeatTime.getHours()).padStart(2, '0')}:${String(repeatTime.getMinutes()).padStart(2, '0')}`
          : undefined,
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

  const openDatePicker = () => setPickerMode('date');
  const openTimePicker = () => {
    if (scheduleType === 'REPEATING') {
      setPickerMode('time');
      return;
    }

    if (!scheduledAt) {
      setPickerMode('date');
      return;
    }
    setPickerMode('time');
  };

  const handlePickerChange = (event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === 'android') {
      setPickerMode(null);
    }

    if (event.type !== 'set' || !value) {
      return;
    }

    if (pickerMode === 'date') {
      const nextDate = scheduledAt ? new Date(scheduledAt) : new Date();
      nextDate.setFullYear(value.getFullYear(), value.getMonth(), value.getDate());
      nextDate.setSeconds(0, 0);
      setScheduledAt(nextDate);

      if (Platform.OS === 'android') {
        setPickerMode('time');
      }
      return;
    }

    if (scheduleType === 'REPEATING') {
      const nextTime = new Date(repeatTime);
      nextTime.setHours(value.getHours(), value.getMinutes(), 0, 0);
      setRepeatTime(nextTime);
      return;
    }

    const nextDate = scheduledAt ? new Date(scheduledAt) : new Date();
    nextDate.setHours(value.getHours(), value.getMinutes(), 0, 0);
    setScheduledAt(nextDate);
  };

  const formattedDate = scheduledAt
    ? scheduledAt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : 'Choose a date';
  const formattedTime = scheduledAt
    ? scheduledAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Choose a time';
  const formattedRepeatTime = repeatTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const selectedRepeatLabels = WEEKDAYS
    .filter((day) => repeatDays.includes(day.value))
    .map((day) => day.label);
  const scheduleSummary = scheduleType === 'REPEATING'
    ? `Repeats on ${selectedRepeatLabels.join(', ') || 'no days selected'} at ${formattedRepeatTime}`
    : scheduledAt
    ? `One time on ${scheduledAt.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : 'Pick a day and time for this alarm';

  const isScheduleValid = scheduleType === 'REPEATING' ? repeatDays.length > 0 : !!scheduledAt;
  const isValid = title.length > 0 && reason.length > 0 && !!image_base64 && isScheduleValid;

  const toggleRepeatDay = (day: AlarmWeekday) => {
    setRepeatDays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day].sort((a, b) => a - b) as AlarmWeekday[],
    );
  };

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

      <Text style={styles.section_label}>Schedule</Text>
      <View style={styles.schedule_card}>
        <Text style={styles.schedule_type_label}>Alarm type</Text>
        <View style={styles.schedule_type_row}>
          {(['ONE_TIME', 'REPEATING'] as ScheduleType[]).map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.schedule_type_chip, scheduleType === type && styles.schedule_type_chip_active]}
              onPress={() => setScheduleType(type)}
            >
              <Text style={[styles.schedule_type_chip_text, scheduleType === type && styles.schedule_type_chip_text_active]}>
                {type === 'ONE_TIME' ? 'One time' : 'Repeating'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {scheduleType === 'ONE_TIME' ? (
          <View style={styles.schedule_row}>
            <TouchableOpacity style={styles.schedule_button} onPress={openDatePicker}>
              <Text style={styles.schedule_button_label}>Date</Text>
              <Text style={styles.schedule_button_value}>{formattedDate}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.schedule_button} onPress={openTimePicker}>
              <Text style={styles.schedule_button_label}>Time</Text>
              <Text style={styles.schedule_button_value}>{formattedTime}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.schedule_button_label}>Days</Text>
            <View style={styles.repeat_days_row}>
              {WEEKDAYS.map((day) => {
                const selected = repeatDays.includes(day.value);
                return (
                  <TouchableOpacity
                    key={day.value}
                    style={[styles.repeat_day_chip, selected && styles.repeat_day_chip_active]}
                    onPress={() => toggleRepeatDay(day.value)}
                  >
                    <Text style={[styles.repeat_day_chip_text, selected && styles.repeat_day_chip_text_active]}>
                      {day.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity style={styles.schedule_button} onPress={openTimePicker}>
              <Text style={styles.schedule_button_label}>Time</Text>
              <Text style={styles.schedule_button_value}>{formattedRepeatTime}</Text>
            </TouchableOpacity>
          </>
        )}

        <Text style={styles.schedule_summary}>{scheduleSummary}</Text>

        {pickerMode ? (
          <View style={styles.picker_wrap}>
            <DateTimePicker
              mode={pickerMode}
              value={scheduledAt ?? new Date()}
              minimumDate={pickerMode === 'date' ? new Date() : undefined}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handlePickerChange}
            />
          </View>
        ) : null}
      </View>

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
  schedule_card: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2a2a2a' },
  schedule_type_label: { color: '#888', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  schedule_type_row: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  schedule_type_chip: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 999, backgroundColor: '#111', borderWidth: 1, borderColor: '#2a2a2a', alignItems: 'center' },
  schedule_type_chip_active: { backgroundColor: '#2a1010', borderColor: '#f4511e' },
  schedule_type_chip_text: { color: '#777', fontWeight: '700' },
  schedule_type_chip_text_active: { color: '#f4511e' },
  schedule_row: { flexDirection: 'row', gap: 10 },
  schedule_button: { flex: 1, backgroundColor: '#111', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2a2a2a' },
  schedule_button_label: { color: '#888', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  schedule_button_value: { color: '#fff', fontSize: 15, fontWeight: '600' },
  schedule_summary: { color: '#777', fontSize: 13, marginTop: 12 },
  picker_wrap: { marginTop: 12, backgroundColor: '#111', borderRadius: 12, overflow: 'hidden' },
  repeat_days_row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  repeat_day_chip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 999, backgroundColor: '#111', borderWidth: 1, borderColor: '#2a2a2a' },
  repeat_day_chip_active: { backgroundColor: '#2a1010', borderColor: '#f4511e' },
  repeat_day_chip_text: { color: '#aaa', fontWeight: '700' },
  repeat_day_chip_text_active: { color: '#f4511e' },
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
