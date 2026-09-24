import type { IntentDecision } from '@nexui/types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { classifyIntent } from './api';

const MIN_INPUT_LENGTH = 3;
const DEBOUNCE_MS = 250;

interface PredictionState {
  text: string;
  decision: IntentDecision | null;
  isPredicting: boolean;
  error: string | null;
}

export function useIntentPrediction() {
  const [text, setInputText] = useState('');
  const [prediction, setPrediction] = useState<PredictionState>({
    text: '',
    decision: null,
    isPredicting: false,
    error: null,
  });
  const generation = useRef(0);
  const activeController = useRef<AbortController | null>(null);

  const setText = useCallback((value: string) => {
    generation.current += 1;
    activeController.current?.abort();
    setInputText(value);
    setPrediction({ text: value, decision: null, isPredicting: false, error: null });
  }, []);

  useEffect(() => {
    const input = text.trim();

    if (input.length < MIN_INPUT_LENGTH) {
      return;
    }

    const requestGeneration = generation.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (requestGeneration !== generation.current) {
        return;
      }

      activeController.current = controller;
      setPrediction({ text, decision: null, isPredicting: true, error: null });
      void classifyIntent({ text: input }, controller.signal)
        .then((decision) => {
          if (requestGeneration !== generation.current) {
            return;
          }

          setPrediction({ text, decision, isPredicting: false, error: null });
        })
        .catch((error: unknown) => {
          if (requestGeneration !== generation.current || controller.signal.aborted) {
            return;
          }

          setPrediction({
            text,
            decision: null,
            isPredicting: false,
            error: 'Could not predict intent. Check your connection and try again.',
          });
          if (__DEV__) {
            console.warn('Intent prediction failed', error);
          }
        })
        .finally(() => {
          if (activeController.current === controller) {
            activeController.current = null;
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  const current = prediction.text === text ? prediction : null;

  return {
    text,
    setText,
    decision: current?.decision ?? null,
    isPredicting: current?.isPredicting ?? false,
    error: current?.error ?? null,
  };
}
