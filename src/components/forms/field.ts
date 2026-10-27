import { createContext, useContext, useId } from 'react';

export interface FieldState {
  id: string;
  labelId: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
}

export const FieldContext = createContext<FieldState | null>(null);

interface OwnProps {
  id?: string;
  invalid?: boolean;
  required?: boolean;
  'aria-describedby'?: string;
}

/** Controls call this to pick up the id, aria-describedby and invalid state from a surrounding FormField (if any). */
export function useFieldControl(own: OwnProps = {}) {
  const ctx = useContext(FieldContext);
  const auto = useId();
  const id = own.id ?? ctx?.id ?? auto;
  const describedBy = [own['aria-describedby'], ctx?.describedBy].filter(Boolean).join(' ') || undefined;
  return {
    id,
    labelId: ctx?.labelId,
    describedBy,
    invalid: own.invalid ?? ctx?.invalid ?? false,
    required: own.required ?? ctx?.required ?? false,
  };
}

export function mergeDescribedBy(...ids: Array<string | undefined | false>): string | undefined {
  return ids.filter(Boolean).join(' ') || undefined;
}
