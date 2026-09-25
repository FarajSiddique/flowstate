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
  const pending = useRef<{ text: string; promise: Promise<IntentDecision | null> } | null>(null);

  const setText = useCallback((value: string) => {
    generation.current += 1;
    activeController.current?.abort();
    pending.current = null;
    setInputText(value);
    setPrediction({ text: value, decision: null, isPredicting: false, error: null });
  }, []);

  // Resolves to null when the text changed meanwhile or the request failed.
  const predict = useCallback((value: string): Promise<IntentDecision | null> => {
    const requestGeneration = generation.current;
    const controller = new AbortController();

    activeController.current?.abort();
    activeController.current = controller;
    setPrediction({ text: value, decision: null, isPredicting: true, error: null });

    const promise = classifyIntent({ text: value.trim() }, controller.signal)
      .then((decision) => {
        if (requestGeneration !== generation.current) {
          return null;
        }

        setPrediction({ text: value, decision, isPredicting: false, error: null });

        return decision;
      })
      .catch((error: unknown) => {
        if (requestGeneration !== generation.current || controller.signal.aborted) {
          return null;
        }

        setPrediction({
          text: value,
          decision: null,
          isPredicting: false,
          error: 'Could not predict intent. Check your connection and try again.',
        });

        if (__DEV__) {
          console.warn('Intent prediction failed', error);
        }

        return null;
      })
      .finally(() => {
        if (activeController.current === controller) {
          activeController.current = null;
        }
      });

    pending.current = { text: value, promise };

    return promise;
  }, []);

  useEffect(() => {
    if (text.trim().length < MIN_INPUT_LENGTH) {
      return;
    }

    const requestGeneration = generation.current;
    const timer = setTimeout(() => {
      if (requestGeneration !== generation.current || pending.current?.text === text) {
        return;
      }

      void predict(text);
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [text, predict]);

  /** The decision for the current text, predicting now instead of after the pause. */
  const resolveNow = useCallback(async (): Promise<IntentDecision | null> => {
    if (text.trim().length < MIN_INPUT_LENGTH) {
      return null;
    }

    if (prediction.text === text && prediction.decision) {
      return prediction.decision;
    }

    if (pending.current?.text === text) {
      return pending.current.promise;
    }

    return predict(text);
  }, [prediction, predict, text]);

  const current = prediction.text === text ? prediction : null;

  return {
    text,
    setText,
    resolveNow,
    decision: current?.decision ?? null,
    isPredicting: current?.isPredicting ?? false,
    error: current?.error ?? null,
  };
}
