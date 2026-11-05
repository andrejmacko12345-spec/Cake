import { useCallback, useEffect, useRef } from 'react';
import type { ComponentRef } from 'react';
import { Keyboard, Platform } from 'react-native';
import type { EmitterSubscription, TextInput } from 'react-native';

// Android can ignore focus requests until the modal window owns input focus, so verify and retry.
const RETRY_DELAYS_MS = [80, 150, 250, 400];

export function useModalInputFocus(visible: boolean, enabled = true) {
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardShownRef = useRef<EmitterSubscription | null>(null);

  const cancelFocus = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    keyboardShownRef.current?.remove();
    keyboardShownRef.current = null;
  }, []);

  useEffect(() => () => {
    cancelFocus();
    inputRef.current?.blur();
  }, [visible, enabled, cancelFocus]);

  const onShow = useCallback(() => {
    cancelFocus();
    if (!visible || !enabled) return;
    const native = Platform.OS !== 'web';
    // Android can retain focus after the keyboard or modal has been dismissed.
    if (Platform.OS === 'android') inputRef.current?.blur();
    if (native) keyboardShownRef.current = Keyboard.addListener('keyboardDidShow', cancelFocus);

    const attempt = (index: number) => {
      const input = inputRef.current;
      if (input) {
        const focused = input.isFocused?.() ?? false;
        if (focused && (!native || Keyboard.isVisible())) {
          cancelFocus();
          return;
        }
        // A focused input without a keyboard ignores focus(); release it first.
        if (focused && Platform.OS === 'android') input.blur();
        input.focus();
        // keyboardDidShow already cancelled the remaining attempts.
        if (native && !keyboardShownRef.current) return;
      }
      const delay = native ? RETRY_DELAYS_MS[index] : undefined;
      if (delay === undefined) {
        cancelFocus();
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        attempt(index + 1);
      }, delay);
    };

    // Wait for the native modal window, not just the input, to be ready.
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      attempt(0);
    });
  }, [visible, enabled, cancelFocus]);

  return { inputRef, onShow };
}
