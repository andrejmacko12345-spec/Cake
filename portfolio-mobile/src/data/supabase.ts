import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const authRedirectUrl = Platform.OS === 'web' && typeof window !== 'undefined'
  ? `${window.location.origin}/settings` : Linking.createURL('settings');

const storage = {
  getItem: (name: string) => Platform.OS === 'web'
    ? Promise.resolve(typeof localStorage === 'undefined' ? null : localStorage.getItem(name)) : SecureStore.getItemAsync(name),
  setItem: (name: string, value: string) => Platform.OS === 'web'
    ? Promise.resolve(localStorage.setItem(name, value)) : SecureStore.setItemAsync(name, value),
  removeItem: (name: string) => Platform.OS === 'web'
    ? Promise.resolve(localStorage.removeItem(name)) : SecureStore.deleteItemAsync(name),
};

export const supabase = url && key ? createClient(url, key, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
}) : null;
