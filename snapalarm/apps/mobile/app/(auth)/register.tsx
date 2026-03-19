import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { api } from '../../src/api/client';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!email || password.length < 8) {
      Alert.alert('Error', 'Email and password (min 8 chars) are required');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', { email, password });
      await SecureStore.setItemAsync('access_token', data.access_token);
      await SecureStore.setItemAsync('refresh_token', data.refresh_token);
      router.replace('/(app)/alarms');
    } catch (err: any) {
      Alert.alert('Registration failed', err.response?.data?.error ?? 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Create Account</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#666"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Password (min 8 characters)"
        placeholderTextColor="#666"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
        <Text style={styles.button_text}>{loading ? 'Creating account...' : 'Create Account'}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.link}>Already have an account? Sign in</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0f0f0f' },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', marginBottom: 32 },
  input: {
    backgroundColor: '#1a1a1a', color: '#fff', padding: 16, borderRadius: 12,
    marginBottom: 12, fontSize: 16, borderWidth: 1, borderColor: '#333',
  },
  button: { backgroundColor: '#f4511e', padding: 18, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  button_text: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { color: '#f4511e', textAlign: 'center', marginTop: 20, fontSize: 14 },
});
