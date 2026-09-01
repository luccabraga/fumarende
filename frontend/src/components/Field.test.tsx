import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from './Field.js';

describe('Field', () => {
  it('associates the label, shows hint and error when present', () => {
    const { rerender } = render(
      <Field label="Valor" htmlFor="v" hint="Ex.: 1.234,56">
        <input id="v" />
      </Field>,
    );
    expect(screen.getByLabelText('Valor')).toBeInTheDocument();
    expect(screen.getByText('Ex.: 1.234,56')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(
      <Field label="Valor" htmlFor="v" error="Valor inválido">
        <input id="v" />
      </Field>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Valor inválido');
  });
});
