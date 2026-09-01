import { useCallback, useMemo, useState } from 'react';

export interface FormErrors {
  errors: Record<string, string>;
  setError: (field: string, message: string) => void;
  clearError: (field: string) => void;
  clearAll: () => void;
  hasErrors: boolean;
}

export function useFormErrors(): FormErrors {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setError = useCallback((field: string, message: string) => {
    setErrors((e) => ({ ...e, [field]: message }));
  }, []);

  const clearError = useCallback((field: string) => {
    setErrors((e) => {
      if (!(field in e)) return e;
      const next = { ...e };
      delete next[field];
      return next;
    });
  }, []);

  const clearAll = useCallback(() => setErrors({}), []);

  const hasErrors = useMemo(() => Object.keys(errors).length > 0, [errors]);

  return { errors, setError, clearError, clearAll, hasErrors };
}
